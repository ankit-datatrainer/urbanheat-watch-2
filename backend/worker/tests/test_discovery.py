"""AOI geometry, STAC discovery/pagination and credential handling.

STAC HTTP responses here are MOCKED with httpx.MockTransport (test-only); their
shape follows items observed on the live CDSE catalogue on 2026-10-10.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import httpx
import pytest

from ecowatch_worker import jobs as jobs_mod
from ecowatch_worker import stac
from ecowatch_worker.aoi import Aoi
from ecowatch_worker.config import Settings
from ecowatch_worker.download import AssetRejected, parse_s3_href
from ecowatch_worker.http_util import DisallowedHostError, assert_allowed_url


def _item(pid: str, collection: str, start: str, with_assets: bool = True) -> dict:
    base = f"s3://eodata/Sentinel-3/SLSTR/SL_2_LST___/2026/10/09/{pid}.SEN3"
    assets = {n: {"href": f"{base}/{n}.nc"} for n in ("LST_in", "geodetic_in", "flags_in")} if with_assets else {}
    return {
        "id": pid,
        "collection": collection,
        "properties": {"datetime": start, "start_datetime": start, "end_datetime": start, "platform": "sentinel-3a"},
        "assets": assets,
    }


def test_aoi_bbox_simple():
    boxes = Aoi(28.61, 77.21, 15_000).search_bboxes()
    assert len(boxes) == 1
    w, s, e, n = boxes[0]
    assert w < 77.21 < e and s < 28.61 < n
    assert 0.25 < (n - s) < 0.3  # ~30 km of latitude


def test_aoi_bbox_antimeridian_split():
    boxes = Aoi(-17.0, 179.95, 15_000).search_bboxes()
    assert len(boxes) == 2
    assert boxes[0][2] == 180.0 and boxes[1][0] == -180.0
    assert all(b[0] <= b[2] for b in boxes)


def test_aoi_pole_uses_full_longitude_band():
    boxes = Aoi(89.95, 10.0, 15_000).search_bboxes()
    assert boxes == [[-180.0, pytest.approx(boxes[0][1]), 180.0, 90.0]]


def test_aoi_rejects_bad_coordinates():
    with pytest.raises(ValueError):
        Aoi(103.8, 1.3, 15_000)  # lat/lon swapped -> latitude out of range


def test_stac_pagination_and_dedupe():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body)
        if "token" not in body:
            return httpx.Response(200, json={
                "features": [
                    _item("S3A_SL_2_LST____20261009T032244_X_NR_005", "sentinel-3-sl-2-lst-nrt", "2026-10-09T03:22:44Z"),
                    _item("S3B_NOASSETS", "sentinel-3-sl-2-lst-nrt", "2026-10-09T02:00:00Z", with_assets=False),
                ],
                "links": [{"rel": "next", "href": "https://stac.dataspace.copernicus.eu/v1/search",
                           "body": {**body, "token": "next:abc"}}],
            })
        return httpx.Response(200, json={
            "features": [_item("S3A_SL_2_LST____20261009T032244_X_NT_004", "sentinel-3-sl-2-lst-ntc", "2026-10-09T03:22:44Z")],
            "links": [],
        })

    client = httpx.Client(transport=httpx.MockTransport(handler))
    found = stac.discover(client, Settings(), Aoi(1.3, 103.85, 15_000), 72,
                          now=datetime(2026, 10, 10, tzinfo=timezone.utc))
    assert len(calls) == 2
    assert calls[0]["datetime"] == "2026-10-07T00:00:00Z/2026-10-10T00:00:00Z"
    assert calls[0]["collections"] == ["sentinel-3-sl-2-lst-nrt", "sentinel-3-sl-2-lst-ntc"]
    # Item without required assets dropped; NRT duplicate replaced by NTC of same acquisition.
    assert [c.timeliness for c in found] == ["NTC"]
    assert found[0].processing["baselineCollection"] == "004"


def test_stac_next_link_to_foreign_host_not_followed():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={"features": [], "links": [
            {"rel": "next", "href": "https://evil.example.com/search", "body": {"token": "x"}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert stac.discover(client, Settings(), Aoi(1.3, 103.85, 15_000), 72) == []
    assert len(calls) == 1


def test_empty_catalogue_gives_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs_mod, "discover", lambda *a, **k: [])
    manager = jobs_mod.JobManager(Settings(cache_dir=tmp_path))
    job = manager.submit(Aoi(1.3, 103.85, 15_000))
    _wait(manager, job.id)
    result = manager.get(job.id).result
    assert result["status"] == "unavailable"
    assert result["note"] == "No usable recent satellite observation."
    assert result["layer"] is None


def test_missing_credentials_gives_configuration_required(monkeypatch, tmp_path):
    cand = stac.parse_item(_item("S3A_X_NR_005", "sentinel-3-sl-2-lst-nrt", "2026-10-09T03:22:44Z"))
    monkeypatch.setattr(jobs_mod, "discover", lambda *a, **k: [cand])
    manager = jobs_mod.JobManager(Settings(cache_dir=tmp_path))
    job = manager.submit(Aoi(1.3, 103.85, 15_000))
    _wait(manager, job.id)
    result = manager.get(job.id).result
    assert result["status"] == "configuration_required"
    assert result["layer"] is None
    assert result["productsConsidered"][0]["id"] == "S3A_X_NR_005"


def test_identical_jobs_are_deduplicated(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs_mod, "discover", lambda *a, **k: [])
    manager = jobs_mod.JobManager(Settings(cache_dir=tmp_path))
    a = manager.submit(Aoi(1.3, 103.85, 15_000))
    b = manager.submit(Aoi(1.3, 103.85, 15_000))
    assert a.id == b.id


def test_ssrf_guards():
    with pytest.raises(DisallowedHostError):
        assert_allowed_url("http://stac.dataspace.copernicus.eu/v1", ("stac.dataspace.copernicus.eu",))
    with pytest.raises(DisallowedHostError):
        assert_allowed_url("https://169.254.169.254/latest", ("stac.dataspace.copernicus.eu",))
    with pytest.raises(AssetRejected):
        parse_s3_href("s3://other-bucket/key.nc", ("eodata",))
    with pytest.raises(AssetRejected):
        parse_s3_href("s3://eodata/a/../../etc/passwd", ("eodata",))
    assert parse_s3_href("s3://eodata/Sentinel-3/x.nc", ("eodata",)) == ("eodata", "Sentinel-3/x.nc")


def _wait(manager, job_id, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if manager.get(job_id).status not in {"queued", "processing"}:
            return
        time.sleep(0.05)
    raise AssertionError("job did not finish")


@pytest.mark.skipif(
    not (os.environ.get("EW_LIVE") == "1" and os.environ.get("CDSE_S3_ACCESS_KEY_ID")),
    reason="Live Copernicus test: set EW_LIVE=1 and CDSE_S3_* credentials",
)
def test_live_real_product_processing(tmp_path):
    """REAL DATA: discovers and processes an actual Sentinel-3 LST product."""
    from ecowatch_worker.config import load_settings

    settings = load_settings()
    settings = Settings(**{**settings.__dict__, "cache_dir": tmp_path})
    manager = jobs_mod.JobManager(settings)
    lat = float(os.environ.get("EW_LIVE_LAT", "28.6139"))
    lon = float(os.environ.get("EW_LIVE_LON", "77.2090"))
    job = manager.submit(Aoi(lat, lon, 15_000))
    _wait(manager, job.id, timeout=900)
    final = manager.get(job.id)
    assert final.status == "completed", final.error
    print(json.dumps(final.result, indent=1, default=str)[:4000])
    assert final.result["status"] in {"available", "partial_coverage", "unavailable"}
