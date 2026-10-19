"""Decoding, masking, georeferencing, coverage and tile/value consistency.

Uses the SYNTHETIC fixture in synthetic_product.py (not real satellite data).
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from ecowatch_worker import raster
from ecowatch_worker.aoi import Aoi
from ecowatch_worker.config import QaConfig
from ecowatch_worker.lst import (
    Q_CLOUD,
    Q_EXCLUDED_DAY_NIGHT,
    Q_VALID,
    Q_WATER,
    ProductFormatError,
    decode_packed,
    read_swath,
    regrid,
    summarize,
    to_celsius,
)

from .synthetic_product import FLAG, LST_FILL, make_product

QA = QaConfig()
SG = dict(center_lat=1.30, center_lon=103.85)


def _process(product, aoi, min_pct=30.0):
    swath = read_swath(product.lst_path, product.geodetic_path, product.flags_path, QA)
    grid = regrid(swath, aoi, 1000.0, 1500.0, 250_000)
    return swath, grid, summarize(grid, min_pct)


def test_decode_packed_applies_scale_offset_once():
    raw = np.array([5000, 0, -32768], dtype=np.int16)
    values, valid = decode_packed(raw, {"scale_factor": 0.002, "add_offset": 290.0, "_FillValue": LST_FILL})
    assert values[0] == pytest.approx(300.0)
    assert values[1] == pytest.approx(290.0)
    assert np.isnan(values[2]) and not valid[2]


def test_decode_packed_valid_range_on_packed_values():
    raw = np.array([10, 200], dtype=np.int16)
    values, valid = decode_packed(raw, {"scale_factor": 1.0, "valid_max": 100})
    assert valid.tolist() == [True, False]


def test_kelvin_conversion_only_when_kelvin():
    v = np.array([300.0])
    assert to_celsius(v, "K")[0] == pytest.approx(26.85)
    assert to_celsius(np.array([26.85]), "degC")[0] == pytest.approx(26.85)
    with pytest.raises(ProductFormatError):
        to_celsius(v, "furlongs")
    with pytest.raises(ProductFormatError):
        to_celsius(v, None)


def test_end_to_end_decode_is_not_double_scaled(tmp_path):
    product = make_product(tmp_path, lst_kelvin=np.full((80, 80), 310.0), **SG)
    swath, grid, stats = _process(product, Aoi(1.30, 103.85, 15_000))
    assert stats["status"] == "available"
    assert stats["summary"]["meanC"] == pytest.approx(36.85, abs=0.01)


def test_celsius_source_is_not_converted(tmp_path):
    product = make_product(tmp_path, lst_kelvin=np.full((80, 80), 300.0), lst_units="Kelvin", **SG)
    _, _, stats = _process(product, Aoi(1.30, 103.85, 10_000))
    assert stats["summary"]["meanC"] == pytest.approx(26.85, abs=0.01)


def test_masks_cloud_water_fill(tmp_path):
    rows = cols = 80
    lst = np.full((rows, cols), 305.0)
    conf = np.full((rows, cols), FLAG["land"] | FLAG["day"], dtype=np.uint16)
    conf[:, :20] |= FLAG["summary_cloud"]
    conf[:, 20:30] = FLAG["ocean"] | FLAG["day"]
    lst[:, 30:35] = np.nan  # fill value
    product = make_product(tmp_path, lst_kelvin=lst, confidence=conf, rotation_deg=0, **SG)
    swath = read_swath(product.lst_path, product.geodetic_path, product.flags_path, QA)
    q = swath.quality.reshape(rows, cols)
    assert (q[:, :20] == Q_CLOUD).all()
    assert (q[:, 20:30] == Q_WATER).all()
    assert (q[:, 30:35] != Q_VALID).all()
    assert (q[:, 40:] == Q_VALID).all()
    assert np.isnan(swath.lst_c.reshape(rows, cols)[:, :35]).all()


def test_missing_required_cloud_flag_rejects_product(tmp_path):
    product = make_product(tmp_path, include_cloud_flag=False, **SG)
    with pytest.raises(ProductFormatError):
        read_swath(product.lst_path, product.geodetic_path, product.flags_path, QA)


def test_insufficient_coverage_withholds_summary(tmp_path):
    conf = np.full((80, 80), FLAG["land"] | FLAG["day"] | FLAG["summary_cloud"], dtype=np.uint16)
    conf[38:42, 38:42] = FLAG["land"] | FLAG["day"]  # a few clear pixels only
    product = make_product(tmp_path, confidence=conf, rotation_deg=0, **SG)
    _, _, stats = _process(product, Aoi(1.30, 103.85, 15_000))
    assert stats["status"] == "partial_coverage"
    assert stats["summary"] is None
    assert stats["partialSummary"]["scope"].startswith("Observed pixels only")
    assert stats["coverage"]["validLandAreaPercent"] < 30


def test_day_and_night_never_mixed(tmp_path):
    conf = np.full((80, 80), FLAG["land"] | FLAG["day"], dtype=np.uint16)
    conf[:, :25] = FLAG["land"]  # night pixels (no day bit)
    lst = np.full((80, 80), 310.0)
    lst[:, :25] = 290.0
    product = make_product(tmp_path, confidence=conf, lst_kelvin=lst, rotation_deg=0, **SG)
    _, grid, stats = _process(product, Aoi(1.30, 103.85, 20_000))
    assert grid.day_night == "day"
    assert (grid.quality == Q_EXCLUDED_DAY_NIGHT).any()
    assert stats["summary"]["minC"] == pytest.approx(36.85, abs=0.01)


def test_georeferencing_and_tile_value_consistency(tmp_path):
    rows = cols = 80
    lst = np.full((rows, cols), 300.0)
    hot_r, hot_c = 47, 33
    lst[hot_r, hot_c] = 330.0  # 56.85 °C single hot pixel
    product = make_product(tmp_path, lst_kelvin=lst, rotation_deg=17, **SG)
    hot_lat, hot_lon = float(product.lat[hot_r, hot_c]), float(product.lon[hot_r, hot_c])

    _, grid, _ = _process(product, Aoi(1.30, 103.85, 15_000))
    cog = tmp_path / "lst.tif"
    raster.write_cog(grid, cog, {"product_id": "synthetic"})

    # Numeric query at the hot pixel's true coordinates returns the hot value.
    hit = raster.query_pixel(cog, hot_lat, hot_lon)
    assert hit["quality"] == "valid"
    assert hit["valueC"] == pytest.approx(56.85, abs=0.01)
    # Bounds are around the requested centre (lon/lat not swapped).
    w, s, e, n = raster.wgs84_bounds(cog)
    assert w < 103.85 < e and s < 1.30 < n

    # The tile pixel at the same location is coloured with exactly that value's colour.
    z = 13
    import math
    n_tiles = 2**z
    xf = (hot_lon + 180) / 360 * n_tiles
    yf = (1 - math.log(math.tan(math.radians(hot_lat)) + 1 / math.cos(math.radians(hot_lat))) / math.pi) / 2 * n_tiles
    x, y = int(xf), int(yf)
    png = raster.render_tile(cog, raster.bounds_3857(cog), z, x, y)
    img = np.array(Image.open(io.BytesIO(png)))
    px, py = int((xf - x) * 256), int((yf - y) * 256)
    values = raster.read_tile_values(cog, z, x, y)
    assert values[py, px] == pytest.approx(56.85, abs=0.01)
    expected = raster.colorize(np.array([[values[py, px]]], dtype=np.float32))[0, 0]
    assert img[py, px].tolist() == expected.tolist()


def test_missing_pixels_are_transparent():
    rgba = raster.colorize(np.array([[np.nan, 25.0]], dtype=np.float32))
    assert rgba[0, 0, 3] == 0
    assert rgba[0, 1, 3] > 0


def test_tile_outside_layer_is_transparent(tmp_path):
    product = make_product(tmp_path, **SG)
    _, grid, _ = _process(product, Aoi(1.30, 103.85, 10_000))
    cog = tmp_path / "lst.tif"
    raster.write_cog(grid, cog, {})
    assert raster.render_tile(cog, raster.bounds_3857(cog), 10, 0, 0) == raster.transparent_tile()


def test_antimeridian_regrid(tmp_path):
    product = make_product(tmp_path, center_lat=-17.0, center_lon=179.95, rotation_deg=5)
    _, grid, stats = _process(product, Aoi(-17.0, 179.95, 15_000))
    assert stats["status"] == "available"
    assert stats["coverage"]["validLandAreaPercent"] > 95
