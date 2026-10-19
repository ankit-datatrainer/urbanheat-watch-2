"""Cloud Optimized GeoTIFF output, XYZ tile rendering and pixel queries."""

from __future__ import annotations

import io
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.io import MemoryFile
from rasterio.shutil import copy as rio_copy
from rasterio.warp import Resampling, reproject, transform_bounds

from .lst import QUALITY_LABELS, Grid

TILE_SIZE = 256
WEB_MERCATOR_HALF = 20037508.342789244
MAX_TILE_ZOOM = 16

# Fixed, documented Celsius legend so views of different cities/dates are comparable.
# Colours between stops are interpolated linearly in RGB; values outside the range
# are clamped to the end colours (the legend marks the ends as "≤" / "≥").
LEGEND_STOPS: list[tuple[float, str]] = [
    (-10.0, "#313695"),
    (0.0, "#4575b4"),
    (10.0, "#74add1"),
    (20.0, "#abd9e9"),
    (30.0, "#fee090"),
    (40.0, "#fdae61"),
    (50.0, "#f46d43"),
    (60.0, "#a50026"),
]


def legend_json() -> dict[str, Any]:
    return {
        "units": "°C",
        "scale": "fixed",
        "min": LEGEND_STOPS[0][0],
        "max": LEGEND_STOPS[-1][0],
        "clampedAtEnds": True,
        "stops": [{"valueC": v, "color": c} for v, c in LEGEND_STOPS],
        "noData": {"color": "transparent", "label": "No valid observation (cloud, water, invalid or outside swath)"},
    }


def _hex(c: str) -> tuple[int, int, int]:
    return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)


_STOP_VALUES = np.array([v for v, _ in LEGEND_STOPS])
_STOP_RGB = np.array([_hex(c) for _, c in LEGEND_STOPS], dtype=np.float64)


def colorize(values: np.ndarray) -> np.ndarray:
    """Map °C values to RGBA. NaN -> fully transparent."""
    v = np.clip(np.nan_to_num(values, nan=_STOP_VALUES[0]), _STOP_VALUES[0], _STOP_VALUES[-1])
    rgba = np.zeros(values.shape + (4,), dtype=np.uint8)
    for ch in range(3):
        rgba[..., ch] = np.round(np.interp(v, _STOP_VALUES, _STOP_RGB[:, ch])).astype(np.uint8)
    rgba[..., 3] = np.where(np.isfinite(values), 200, 0)
    rgba[~np.isfinite(values), :3] = 0
    return rgba


# --------------------------------------------------------------------------- COG


def write_cog(grid: Grid, path: Path, tags: dict[str, str]) -> None:
    """Band 1: LST °C (NaN = no valid data). Band 2: quality code (see QUALITY_LABELS)."""
    rows, cols = grid.lst_c.shape
    profile = {
        "driver": "GTiff",
        "width": cols,
        "height": rows,
        "count": 2,
        "dtype": "float32",
        "crs": CRS.from_wkt(grid.crs_wkt),
        "transform": grid.transform,
        "nodata": float("nan"),
    }
    with MemoryFile() as mem:
        with mem.open(**profile) as dst:
            dst.write(grid.lst_c.astype(np.float32), 1)
            dst.write(grid.quality.astype(np.float32), 2)
            dst.set_band_description(1, "land_surface_temperature_celsius")
            dst.set_band_description(2, "quality_code")
            dst.update_tags(**tags)
            dst.update_tags(2, codes=";".join(f"{k}={v}" for k, v in QUALITY_LABELS.items()))
        with mem.open() as src:
            path.parent.mkdir(parents=True, exist_ok=True)
            rio_copy(src, str(path), driver="COG", compress="DEFLATE", overview_resampling="nearest")


def wgs84_bounds(path: Path) -> list[float]:
    with rasterio.open(path) as src:
        return list(transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21))


# --------------------------------------------------------------------------- tiles


def tile_bounds_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = 2 * WEB_MERCATOR_HALF / (2**z)
    west = -WEB_MERCATOR_HALF + x * size
    north = WEB_MERCATOR_HALF - y * size
    return west, north - size, west + size, north


@lru_cache(maxsize=1)
def transparent_tile() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def read_tile_values(path: Path, z: int, x: int, y: int) -> np.ndarray:
    """LST values (°C) resampled by nearest neighbour onto a 256x256 Web Mercator tile."""
    west, south, east, north = tile_bounds_3857(z, x, y)
    dst_transform = Affine((east - west) / TILE_SIZE, 0, west, 0, -(north - south) / TILE_SIZE, north)
    dest = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(
            source=rasterio.band(src, 1),
            destination=dest,
            src_nodata=np.nan,
            dst_transform=dst_transform,
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.nearest,
        )
    return dest


def render_tile(path: Path, bounds_3857: list[float], z: int, x: int, y: int) -> bytes:
    if not (0 <= z <= MAX_TILE_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z):
        raise ValueError("Tile out of range")
    west, south, east, north = tile_bounds_3857(z, x, y)
    bw, bs, be, bn = bounds_3857
    if east <= bw or west >= be or north <= bs or south >= bn:
        return transparent_tile()
    values = read_tile_values(path, z, x, y)
    if not np.isfinite(values).any():
        return transparent_tile()
    buf = io.BytesIO()
    Image.fromarray(colorize(values), mode="RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def bounds_3857(path: Path) -> list[float]:
    with rasterio.open(path) as src:
        return list(transform_bounds(src.crs, "EPSG:3857", *src.bounds, densify_pts=21))


# --------------------------------------------------------------------------- pixel query


def query_pixel(path: Path, lat: float, lng: float) -> dict[str, Any]:
    """Read the stored numeric value at a location (never inferred from colour)."""
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("Coordinates out of range")
    with rasterio.open(path) as src:
        transformer = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        px, py = transformer.transform(lng, lat)
        if not (math.isfinite(px) and math.isfinite(py)):
            return {"insideLayer": False, "valueC": None, "quality": "outside_area"}
        row, col = src.index(px, py)
        if not (0 <= row < src.height and 0 <= col < src.width):
            return {"insideLayer": False, "valueC": None, "quality": "outside_area"}
        window = ((row, row + 1), (col, col + 1))
        value = float(src.read(1, window=window)[0, 0])
        code = int(src.read(2, window=window)[0, 0])
    return {
        "insideLayer": True,
        "valueC": round(value, 2) if math.isfinite(value) else None,
        "quality": QUALITY_LABELS.get(code, "unknown"),
        "pixel": {"row": row, "col": col},
    }
