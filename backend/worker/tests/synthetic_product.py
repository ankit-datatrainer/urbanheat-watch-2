"""SYNTHETIC TEST FIXTURE — NOT REAL SATELLITE DATA.

Builds small NetCDF files that mimic the documented structure of a Sentinel-3
SLSTR SL_2_LST product (LST_in.nc, geodetic_in.nc, flags_in.nc): packed integer
LST in Kelvin with scale_factor/add_offset/_FillValue, packed lat/lon, and a
confidence_in bit-flag variable described by flag_meanings/flag_masks.

Used only by unit tests to exercise decoding, masking, regridding and tiling
deterministically. Real-product verification is the opt-in live test.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import netCDF4

CONFIDENCE_MEANINGS = (
    "coastline ocean tidal land inland_water unfilled spare spare cosmetic duplicate "
    "day twilight sun_glint snow summary_cloud summary_pointing"
)
CONFIDENCE_MASKS = np.array([1 << i for i in range(16)], dtype=np.uint16)
FLAG = {name: int(1 << i) for i, name in enumerate(CONFIDENCE_MEANINGS.split()) if name != "spare"}

LST_SCALE = 0.002
LST_OFFSET = 290.0
LST_FILL = np.int16(-32768)


def pack_lst_kelvin(kelvin: np.ndarray) -> np.ndarray:
    return np.round((np.nan_to_num(kelvin, nan=LST_OFFSET) - LST_OFFSET) / LST_SCALE).astype(np.int16)


@dataclass
class SyntheticProduct:
    lst_path: Path
    geodetic_path: Path
    flags_path: Path
    lat: np.ndarray
    lon: np.ndarray


def make_product(
    tmp: Path,
    *,
    center_lat: float = 1.30,
    center_lon: float = 103.85,
    rows: int = 80,
    cols: int = 80,
    spacing_deg: float = 0.009,
    rotation_deg: float = 12.0,
    lst_kelvin: np.ndarray | None = None,
    confidence: np.ndarray | None = None,
    lst_units: str = "K",
    include_cloud_flag: bool = True,
) -> SyntheticProduct:
    r = np.arange(rows) - rows / 2
    c = np.arange(cols) - cols / 2
    cc, rr = np.meshgrid(c, r)
    theta = np.radians(rotation_deg)
    # Rotated grid emulates the oblique orientation of a satellite swath.
    lat = center_lat - (rr * np.cos(theta) - cc * np.sin(theta)) * spacing_deg
    lon = center_lon + (rr * np.sin(theta) + cc * np.cos(theta)) * spacing_deg
    lon = ((lon + 180.0) % 360.0) - 180.0

    if lst_kelvin is None:
        lst_kelvin = np.full((rows, cols), 305.0)
    packed = pack_lst_kelvin(lst_kelvin)
    packed = np.where(np.isnan(lst_kelvin), LST_FILL, packed).astype(np.int16)
    if confidence is None:
        confidence = np.full((rows, cols), FLAG["land"] | FLAG["day"], dtype=np.uint16)

    meanings = CONFIDENCE_MEANINGS if include_cloud_flag else CONFIDENCE_MEANINGS.replace("summary_cloud", "spare")
    int32_fill = np.int32(-2147483648)
    files = {
        "LST_in": [("LST", packed, LST_FILL, {
            "units": lst_units, "scale_factor": LST_SCALE, "add_offset": LST_OFFSET,
            "standard_name": "surface_temperature"})],
        "geodetic_in": [
            ("latitude_in", np.round(lat / 1e-6).astype(np.int32), int32_fill,
             {"units": "degrees_north", "scale_factor": 1e-6}),
            ("longitude_in", np.round(lon / 1e-6).astype(np.int32), int32_fill,
             {"units": "degrees_east", "scale_factor": 1e-6}),
        ],
        "flags_in": [("confidence_in", confidence.astype(np.uint16), None,
                      {"flag_masks": CONFIDENCE_MASKS, "flag_meanings": meanings})],
    }
    paths = []
    for name, variables in files.items():
        p = tmp / f"{name}.nc"
        with netCDF4.Dataset(p, "w") as nc:
            nc.createDimension("rows", rows)
            nc.createDimension("columns", cols)
            for var_name, data, fill, attrs in variables:
                v = nc.createVariable(var_name, data.dtype, ("rows", "columns"), fill_value=fill)
                v.set_auto_maskandscale(False)  # store packed values verbatim
                v.setncatts(attrs)
                v[:] = data
        paths.append(p)
    return SyntheticProduct(paths[0], paths[1], paths[2], lat, lon)
