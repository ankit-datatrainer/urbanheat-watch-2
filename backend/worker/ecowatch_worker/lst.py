"""Sentinel-3 SLSTR Level-2 LST decoding, quality masking and regridding.

Processing rules:
- Variables are read raw (no automatic CF decoding) and unpacked exactly once by
  `decode_packed`, applying _FillValue / valid range on the packed values first.
- Quality flags are resolved by *name* from each flag variable's `flag_meanings`
  and `flag_masks` attributes. No bit positions are hard-coded; if a required flag
  name is missing the product is rejected rather than processed unmasked.
- Swath pixels are placed on a city-centred AEQD grid by nearest neighbour with a
  maximum search distance: no interpolation, no smoothing, gaps stay empty.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import xarray as xr
from affine import Affine
from scipy.spatial import cKDTree

from .aoi import Aoi, lonlat_to_aeqd
from .config import QaConfig

# Per-pixel quality codes stored in band 2 of the output raster.
Q_NO_OBSERVATION = 0
Q_VALID = 1
Q_CLOUD = 2
Q_WATER = 3
Q_INVALID = 4
Q_EXCLUDED_DAY_NIGHT = 5
Q_OUTSIDE_AREA = 255

QUALITY_LABELS = {
    Q_NO_OBSERVATION: "no_observation",
    Q_VALID: "valid",
    Q_CLOUD: "cloud",
    Q_WATER: "water",
    Q_INVALID: "invalid_retrieval",
    Q_EXCLUDED_DAY_NIGHT: "excluded_mixed_day_night",
    Q_OUTSIDE_AREA: "outside_area",
}

KELVIN_UNITS = {"k", "kelvin", "kelvins"}
CELSIUS_UNITS = {"degc", "celsius", "degree_celsius", "degrees_celsius", "°c", "c"}


class ProductFormatError(ValueError):
    """The product does not have the documented structure; processing is refused."""


# --------------------------------------------------------------------------- decoding


def decode_packed(raw: np.ndarray, attrs: Mapping[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    """Unpack a CF-packed variable exactly once.

    Returns (values as float64, validity mask). Fill values and valid_min/max/range
    are evaluated on the *packed* values, as CF specifies.
    """
    packed = np.asarray(raw)
    valid = np.ones(packed.shape, dtype=bool)
    for key in ("_FillValue", "missing_value"):
        if key in attrs:
            for fill in np.atleast_1d(attrs[key]):
                if np.issubdtype(packed.dtype, np.floating) and np.isnan(fill):
                    valid &= ~np.isnan(packed)
                else:
                    valid &= packed != np.asarray(fill, dtype=packed.dtype)
    if "valid_range" in attrs:
        lo, hi = np.asarray(attrs["valid_range"]).tolist()
        valid &= (packed >= lo) & (packed <= hi)
    if "valid_min" in attrs:
        valid &= packed >= attrs["valid_min"]
    if "valid_max" in attrs:
        valid &= packed <= attrs["valid_max"]
    if np.issubdtype(packed.dtype, np.floating):
        valid &= np.isfinite(packed)

    values = packed.astype(np.float64)
    scale = attrs.get("scale_factor")
    offset = attrs.get("add_offset")
    if scale is not None:
        values = values * float(np.asarray(scale))
    if offset is not None:
        values = values + float(np.asarray(offset))
    values = np.where(valid, values, np.nan)
    return values, valid


def to_celsius(values: np.ndarray, units: str | None) -> np.ndarray:
    """Convert to °C only when the source units say Kelvin."""
    if units is None:
        raise ProductFormatError("LST variable has no units attribute")
    u = units.strip().lower()
    if u in KELVIN_UNITS:
        return values - 273.15
    if u in CELSIUS_UNITS:
        return values
    raise ProductFormatError(f"Unsupported LST units {units!r}")


# --------------------------------------------------------------------------- flags


def parse_flag_masks(attrs: Mapping[str, Any]) -> dict[str, int]:
    """Map flag name -> bit mask from CF `flag_meanings` + `flag_masks`."""
    meanings = attrs.get("flag_meanings")
    masks = attrs.get("flag_masks")
    if meanings is None or masks is None:
        raise ProductFormatError("Flag variable lacks flag_meanings/flag_masks attributes")
    names = str(meanings).split()
    mask_values = [int(m) for m in np.atleast_1d(masks).tolist()]
    if len(names) != len(mask_values):
        raise ProductFormatError("flag_meanings and flag_masks lengths differ")
    return dict(zip(names, mask_values))


def flags_set(raw: np.ndarray, flag_map: Mapping[str, int], names: tuple[str, ...], *, required: bool) -> np.ndarray:
    out = np.zeros(np.shape(raw), dtype=bool)
    as_int = np.asarray(raw).astype(np.int64)
    for name in names:
        if name not in flag_map:
            if required:
                raise ProductFormatError(f"Required quality flag {name!r} not present in product")
            continue
        out |= (as_int & flag_map[name]) != 0
    return out


# --------------------------------------------------------------------------- reading


@dataclass
class Swath:
    lst_c: np.ndarray  # float64, NaN where not valid
    lat: np.ndarray
    lon: np.ndarray
    quality: np.ndarray  # uint8 quality codes
    day_night: np.ndarray  # int8: 1 day, 0 night, 2 twilight, -1 unknown
    metadata: dict[str, Any] = field(default_factory=dict)


def _var(ds: xr.Dataset, name: str, path: Path) -> xr.DataArray:
    if name not in ds.variables:
        raise ProductFormatError(f"Variable {name!r} not found in {path.name}; found {sorted(ds.variables)}")
    return ds[name]


def read_swath(lst_path: Path, geodetic_path: Path, flags_path: Path, qa: QaConfig) -> Swath:
    with (
        xr.open_dataset(lst_path, decode_cf=False, mask_and_scale=False, decode_times=False) as lst_ds,
        xr.open_dataset(geodetic_path, decode_cf=False, mask_and_scale=False, decode_times=False) as geo_ds,
        xr.open_dataset(flags_path, decode_cf=False, mask_and_scale=False, decode_times=False) as flag_ds,
    ):
        lst_var = _var(lst_ds, "LST", lst_path)
        lat_var = _var(geo_ds, "latitude_in", geodetic_path)
        lon_var = _var(geo_ds, "longitude_in", geodetic_path)
        conf_var = _var(flag_ds, "confidence_in", flags_path)

        shape = lst_var.shape
        if lst_var.ndim != 2 or lat_var.shape != shape or lon_var.shape != shape or conf_var.shape != shape:
            raise ProductFormatError(
                f"Grid shape mismatch: LST {shape}, lat {lat_var.shape}, lon {lon_var.shape}, flags {conf_var.shape}"
            )

        lst_values, lst_valid = decode_packed(lst_var.values, lst_var.attrs)
        lst_c = to_celsius(lst_values, lst_var.attrs.get("units"))
        lat, lat_ok = decode_packed(lat_var.values, lat_var.attrs)
        lon, lon_ok = decode_packed(lon_var.values, lon_var.attrs)
        geo_ok = lat_ok & lon_ok & (np.abs(lat) <= 90) & (np.abs(lon) <= 360)

        conf_raw = conf_var.values
        conf_flags = parse_flag_masks(conf_var.attrs)
        cloud = flags_set(conf_raw, conf_flags, qa.cloud_confidence_flags, required=True)
        water_names = qa.water_confidence_flags + (("tidal",) if qa.mask_tidal_as_water else ())
        water = flags_set(conf_raw, conf_flags, qa.water_confidence_flags, required=True)
        water |= flags_set(conf_raw, conf_flags, water_names, required=False)
        invalid = flags_set(conf_raw, conf_flags, qa.invalid_confidence_flags, required=False)

        exception_note = "not present"
        if "exception" in lst_ds.variables:
            exc = lst_ds["exception"]
            if exc.shape == shape:
                # Any set exception bit marks a failed or degraded retrieval.
                invalid |= np.asarray(exc.values).astype(np.int64) != 0
                exception_note = "any set bit treated as invalid"

        day_night = np.full(shape, -1, dtype=np.int8)
        if "day" in conf_flags:
            is_day = flags_set(conf_raw, conf_flags, ("day",), required=True)
            day_night = np.where(is_day, 1, 0).astype(np.int8)
            if "twilight" in conf_flags:
                twilight = flags_set(conf_raw, conf_flags, ("twilight",), required=True)
                day_night = np.where(twilight, 2, day_night).astype(np.int8)

        quality = np.full(shape, Q_VALID, dtype=np.uint8)
        quality[~lst_valid | invalid] = Q_INVALID
        quality[cloud] = Q_CLOUD
        quality[water] = Q_WATER
        lst_c = np.where(quality == Q_VALID, lst_c, np.nan)

        keep = geo_ok
        metadata = {
            "lstVariable": "LST",
            "lstUnits": lst_var.attrs.get("units"),
            "lstScaleFactor": _scalar(lst_var.attrs.get("scale_factor")),
            "lstAddOffset": _scalar(lst_var.attrs.get("add_offset")),
            "lstFillValue": _scalar(lst_var.attrs.get("_FillValue")),
            "geolocation": "geodetic_in.nc latitude_in/longitude_in",
            "qualityFlags": {
                "variable": "flags_in.nc confidence_in",
                "cloud": list(qa.cloud_confidence_flags),
                "water": list(water_names),
                "invalid": [n for n in qa.invalid_confidence_flags if n in conf_flags],
                "exception": exception_note,
            },
            "swathShape": list(shape),
        }
        return Swath(
            lst_c=lst_c[keep],
            lat=lat[keep],
            lon=lon[keep],
            quality=quality[keep],
            day_night=day_night[keep],
            metadata=metadata,
        )


def _scalar(value: Any) -> Any:
    if value is None:
        return None
    arr = np.asarray(value)
    return arr.item() if arr.size == 1 else arr.tolist()


# --------------------------------------------------------------------------- regridding


@dataclass
class Grid:
    lst_c: np.ndarray  # float32 (rows, cols), NaN unless valid
    quality: np.ndarray  # uint8 (rows, cols)
    transform: Affine
    crs_wkt: str
    resolution_m: float
    in_area: np.ndarray  # bool
    day_night: str  # "day" | "night" | "twilight" | "unknown"
    day_night_note: str | None


def build_grid(aoi: Aoi, resolution_m: float, max_pixels: int) -> tuple[Affine, int, np.ndarray, np.ndarray]:
    half_cells = int(np.ceil(aoi.radius_m / resolution_m))
    n = 2 * half_cells + 1
    if n * n > max_pixels:
        raise ValueError(f"Requested grid {n}x{n} exceeds limit of {max_pixels} pixels")
    origin = -(n / 2.0) * resolution_m  # cell (half_cells, half_cells) is centred on the city
    transform = Affine(resolution_m, 0.0, origin, 0.0, -resolution_m, -origin)
    centres = origin + (np.arange(n) + 0.5) * resolution_m
    xs, ys = np.meshgrid(centres, -centres)
    return transform, n, xs, ys


def regrid(swath: Swath, aoi: Aoi, resolution_m: float, max_distance_m: float, max_pixels: int) -> Grid:
    transform, n, xs, ys = build_grid(aoi, resolution_m, max_pixels)
    in_area = np.hypot(xs, ys) <= aoi.radius_m

    quality = np.full((n, n), Q_NO_OBSERVATION, dtype=np.uint8)
    lst = np.full((n, n), np.nan, dtype=np.float32)
    dn = np.full((n, n), -1, dtype=np.int8)

    sx, sy = lonlat_to_aeqd(aoi, swath.lon, swath.lat)
    sx = np.asarray(sx)
    sy = np.asarray(sy)
    near = np.isfinite(sx) & np.isfinite(sy) & (np.hypot(sx, sy) <= aoi.radius_m + max_distance_m + resolution_m)
    if near.any():
        tree = cKDTree(np.column_stack([sx[near], sy[near]]))
        dist, idx = tree.query(np.column_stack([xs.ravel(), ys.ravel()]), k=1, distance_upper_bound=max_distance_m)
        hit = np.isfinite(dist)
        src_q = swath.quality[near]
        src_v = swath.lst_c[near]
        src_dn = swath.day_night[near]
        flat_q = quality.ravel()
        flat_v = lst.ravel()
        flat_dn = dn.ravel()
        flat_q[hit] = src_q[idx[hit]]
        flat_v[hit] = src_v[idx[hit]]
        flat_dn[hit] = src_dn[idx[hit]]
        quality = flat_q.reshape(n, n)
        lst = flat_v.reshape(n, n)
        dn = flat_dn.reshape(n, n)

    quality[~in_area] = Q_OUTSIDE_AREA
    label, note = _resolve_day_night(quality, dn)
    lst = np.where(quality == Q_VALID, lst, np.nan).astype(np.float32)
    return Grid(
        lst_c=lst,
        quality=quality,
        transform=transform,
        crs_wkt=aoi.crs().to_wkt(),
        resolution_m=resolution_m,
        in_area=in_area,
        day_night=label,
        day_night_note=note,
    )


def _resolve_day_night(quality: np.ndarray, dn: np.ndarray) -> tuple[str, str | None]:
    """Never mix day and night pixels in one summary: keep the dominant class only."""
    valid = quality == Q_VALID
    names = {1: "day", 0: "night", 2: "twilight", -1: "unknown"}
    classes, counts = np.unique(dn[valid], return_counts=True)
    if classes.size == 0:
        return "unknown", None
    if classes.size == 1:
        return names[int(classes[0])], None
    dominant = int(classes[np.argmax(counts)])
    quality[valid & (dn != dominant)] = Q_EXCLUDED_DAY_NIGHT
    return names[dominant], (
        f"Observation mixed day/night/twilight pixels; only {names[dominant]} pixels were kept."
    )


# --------------------------------------------------------------------------- statistics


def summarize(grid: Grid, min_valid_land_percent: float) -> dict[str, Any]:
    area = grid.in_area
    q = grid.quality
    area_pixels = int(area.sum())
    valid = area & (q == Q_VALID)
    water = area & (q == Q_WATER)
    observed_land = area & np.isin(q, (Q_VALID, Q_CLOUD, Q_INVALID, Q_EXCLUDED_DAY_NIGHT))
    valid_count = int(valid.sum())
    non_water = area_pixels - int(water.sum())
    pixel_area_km2 = (grid.resolution_m / 1000.0) ** 2

    def pct(num: int, den: int) -> float | None:
        return round(100.0 * num / den, 1) if den > 0 else None

    coverage = {
        "targetAreaPixels": area_pixels,
        "targetAreaKm2": round(area_pixels * pixel_area_km2, 1),
        "validPixelCount": valid_count,
        # Share of the whole target area (land + water + unobserved) with valid LST.
        "validAreaPercent": pct(valid_count, area_pixels),
        # Share of the target area not flagged as water with valid LST (unobserved
        # pixels count against coverage). The minimum-coverage rule uses this value.
        "validLandAreaPercent": pct(valid_count, non_water),
        # Share of observed land pixels that passed quality checks.
        "landQaPassPercent": pct(valid_count, int(observed_land.sum())),
        "waterPercent": pct(int(water.sum()), area_pixels),
        "cloudPercent": pct(int((area & (q == Q_CLOUD)).sum()), area_pixels),
        "noObservationPercent": pct(int((area & (q == Q_NO_OBSERVATION)).sum()), area_pixels),
        "minimumValidLandPercent": min_valid_land_percent,
    }
    values = grid.lst_c[valid].astype(np.float64)
    if valid_count == 0:
        return {"status": "unavailable", "coverage": coverage, "summary": None, "partialSummary": None}

    # Pixels are equal-area on the AEQD grid, so unweighted statistics are area-weighted.
    stats = {
        "minC": round(float(values.min()), 2),
        "meanC": round(float(values.mean()), 2),
        "medianC": round(float(np.median(values)), 2),
        "maxC": round(float(values.max()), 2),
        "p90C": round(float(np.percentile(values, 90)), 2),
        "areaWeighting": "equal-area pixels (azimuthal equidistant grid, <0.1% scale error)",
    }
    if (coverage["validLandAreaPercent"] or 0.0) >= min_valid_land_percent:
        return {"status": "available", "coverage": coverage, "summary": stats, "partialSummary": None}
    # Below minimum coverage: never publish an unqualified area summary.
    stats["scope"] = "Observed pixels only; not representative of the whole area."
    return {"status": "partial_coverage", "coverage": coverage, "summary": None, "partialSummary": stats}
