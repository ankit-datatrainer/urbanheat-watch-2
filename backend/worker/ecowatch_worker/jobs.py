"""Satellite processing jobs: discovery -> download -> decode/mask -> regrid -> COG.

Jobs run in a bounded thread pool. Identical requests (same area, QA config and
processing version within the same hour) share one job, and processed layers are
cached on disk by product ID + area + QA config + processing version.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from . import raster
from .aoi import Aoi
from .config import PROCESSING_VERSION, Settings
from .download import download_assets, make_s3_client
from .lst import ProductFormatError, read_swath, regrid, summarize
from .stac import Candidate, discover

log = logging.getLogger("ecowatch.worker")

BASE_LIMITATIONS = [
    "Satellite land-surface temperature is the radiative 'skin' temperature of the ground and roofs, "
    "not the air temperature people breathe, not WBGT and not an official heat warning.",
    "Native resolution is about 1 km; street-level differences are not resolved.",
    "Clouds block thermal retrieval; cloudy pixels are left empty, not estimated.",
]


@dataclass
class Job:
    id: str
    key: str
    aoi: Aoi
    status: str = "queued"  # queued | processing | completed | failed | expired | cancelled
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: dict[str, Any] | None = None
    error: str | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def to_json(self) -> dict[str, Any]:
        return {
            "jobId": self.id,
            "status": self.status,
            "createdAt": _iso(self.created_at),
            "updatedAt": _iso(self.updated_at),
            "result": self.result,
            "error": self.error,
        }


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


class Cancelled(Exception):
    pass


class JobManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.layers_dir = settings.cache_dir / "layers"
        self.layers_dir.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, Job] = {}
        self._by_key: dict[str, str] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max(1, settings.concurrency), thread_name_prefix="lst")

    # ------------------------------------------------------------------ public API

    def submit(self, aoi: Aoi) -> Job:
        if aoi.radius_m > self.settings.max_radius_km * 1000:
            raise ValueError(f"radius exceeds {self.settings.max_radius_km} km")
        hour_bucket = int(time.time() // 3600)
        key = f"{aoi.key()}:{self.settings.qa.key()}:{PROCESSING_VERSION}:{hour_bucket}"
        with self._lock:
            self._expire_locked()
            existing_id = self._by_key.get(key)
            existing = self._jobs.get(existing_id) if existing_id else None
            reusable = existing and existing.status in {"queued", "processing", "completed"}
            # A "configuration_required" result must not outlive a credential change.
            if reusable and not (existing.result or {}).get("status") == "configuration_required":
                return existing
            job = Job(id=uuid.uuid4().hex, key=key, aoi=aoi)
            self._jobs[job.id] = job
            self._by_key[key] = job.id
        self._pool.submit(self._run, job)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._expire_locked()
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        job = self.get(job_id)
        if job and job.status in {"queued", "processing"}:
            job.cancel.set()
        return job

    def layer_dir(self, layer_id: str) -> Path | None:
        if not layer_id.isalnum() or len(layer_id) > 64:
            return None
        path = self.layers_dir / layer_id
        return path if (path / "meta.json").exists() else None

    def layer_meta(self, layer_id: str) -> dict[str, Any] | None:
        path = self.layer_dir(layer_id)
        return json.loads((path / "meta.json").read_text("utf-8")) if path else None

    # ------------------------------------------------------------------ internals

    def _expire_locked(self) -> None:
        now = time.time()
        for job in list(self._jobs.values()):
            if job.status in {"completed", "failed", "cancelled"} and now - job.updated_at > self.settings.job_ttl_seconds:
                job.status = "expired"
                job.result = None
                self._jobs.pop(job.id, None)
                if self._by_key.get(job.key) == job.id:
                    self._by_key.pop(job.key, None)

    def _set(self, job: Job, **changes: Any) -> None:
        with self._lock:
            for k, v in changes.items():
                setattr(job, k, v)
            job.updated_at = time.time()

    def _run(self, job: Job) -> None:
        if job.cancel.is_set():
            self._set(job, status="cancelled")
            return
        self._set(job, status="processing")
        try:
            result = self._process(job)
            self._set(job, status="cancelled" if job.cancel.is_set() else "completed", result=result)
        except Cancelled:
            self._set(job, status="cancelled")
        except Exception as exc:  # noqa: BLE001 - job boundary; report, never crash the worker
            log.exception("job %s failed", job.id)
            self._set(job, status="failed", error=type(exc).__name__ + ": " + _redact(str(exc)))

    def _process(self, job: Job) -> dict[str, Any]:
        settings = self.settings
        aoi = job.aoi
        considered: list[dict[str, Any]] = []
        seen: set[str] = set()
        best_partial: dict[str, Any] | None = None
        window_used = None

        with httpx.Client(timeout=settings.http_timeout_s, headers={"User-Agent": "EcoWatch-worker/1.0"}) as client:
            for window in settings.search_windows_hours:
                window_used = window
                candidates = [c for c in discover(client, settings, aoi, window) if c.id not in seen]
                if not candidates:
                    continue
                if not settings.has_s3_credentials:
                    return self._status_only(
                        "configuration_required",
                        "Copernicus products were found, but CDSE S3 credentials are not configured on the "
                        "server, so they could not be downloaded or processed.",
                        [c.to_json() for c in candidates[: settings.max_products_per_job]],
                        window,
                    )
                for cand in candidates:
                    if len(seen) >= settings.max_products_per_job:
                        break
                    if job.cancel.is_set():
                        raise Cancelled()
                    seen.add(cand.id)
                    outcome = self._process_candidate(cand, aoi)
                    considered.append({**cand.to_json(), "outcome": outcome["status"], "note": outcome.get("note")})
                    if outcome["status"] == "available":
                        return self._layer_result(outcome["layer"], considered, window)
                    if outcome["status"] == "partial_coverage":
                        pct = outcome["layer"]["coverage"]["validLandAreaPercent"] or 0
                        if best_partial is None or pct > (best_partial["coverage"]["validLandAreaPercent"] or 0):
                            best_partial = outcome["layer"]
                if len(seen) >= settings.max_products_per_job:
                    break

        if best_partial is not None:
            return self._layer_result(best_partial, considered, window_used)
        return self._status_only(
            "unavailable", "No usable recent satellite observation.", considered, window_used
        )

    def _status_only(self, status: str, note: str, considered: list[dict[str, Any]], window: int | None):
        return {
            "status": status,
            "note": note,
            "layer": None,
            "productsConsidered": considered,
            "searchWindowHours": window,
            "limitations": BASE_LIMITATIONS,
        }

    def _layer_result(self, layer: dict[str, Any], considered: list[dict[str, Any]], window: int | None):
        limitations = list(BASE_LIMITATIONS)
        if layer["status"] == "partial_coverage":
            limitations.append(
                f"Only {layer['coverage']['validLandAreaPercent']}% of the land area has a valid observation "
                f"(minimum {layer['coverage']['minimumValidLandPercent']}%); no area-wide summary is published."
            )
        if layer.get("dayNightNote"):
            limitations.append(layer["dayNightNote"])
        return {
            "status": layer["status"],
            "note": None,
            "layer": layer,
            "productsConsidered": considered,
            "searchWindowHours": window,
            "limitations": limitations,
        }

    def _layer_id(self, cand: Candidate, aoi: Aoi) -> str:
        raw = f"{cand.id}|{aoi.key()}|{self.settings.qa.key()}|{PROCESSING_VERSION}|{self.settings.grid_resolution_m}"
        return hashlib.sha256(raw.encode()).hexdigest()[:24]

    def _process_candidate(self, cand: Candidate, aoi: Aoi) -> dict[str, Any]:
        settings = self.settings
        layer_id = self._layer_id(cand, aoi)
        cached = self.layer_meta(layer_id)
        if cached:
            return {"status": cached["status"], "layer": cached}

        tmp = Path(tempfile.mkdtemp(prefix="lst_", dir=settings.cache_dir))
        try:
            s3 = make_s3_client(settings)
            files = download_assets(s3, settings, cand.asset_hrefs, tmp)
            try:
                swath = read_swath(files["LST_in"], files["geodetic_in"], files["flags_in"], settings.qa)
            except ProductFormatError as exc:
                return {"status": "error", "note": f"Product format not as documented: {exc}"}
            grid = regrid(
                swath, aoi, settings.grid_resolution_m, settings.max_neighbour_distance_m, settings.max_grid_pixels
            )
            stats = summarize(grid, settings.min_valid_area_percent)
            if stats["status"] == "unavailable":
                return {"status": "unavailable", "note": "No valid land pixels in the area after quality masking."}

            out_dir = self.layers_dir / layer_id
            out_dir.mkdir(parents=True, exist_ok=True)
            cog = out_dir / "lst.tif"
            raster.write_cog(
                grid,
                cog,
                {
                    "product_id": cand.id,
                    "collection": cand.collection,
                    "acquisition_start": cand.start.isoformat(),
                    "acquisition_end": cand.end.isoformat(),
                    "processing_version": PROCESSING_VERSION,
                },
            )
            meta = {
                "layerId": layer_id,
                "status": stats["status"],
                "productId": cand.id,
                "collectionId": cand.collection,
                "platform": cand.platform,
                "timeliness": cand.timeliness,
                "acquisitionStart": cand.start.isoformat(),
                "acquisitionEnd": cand.end.isoformat(),
                "acquisitionTimeBasis": "Product granule sensing window (single pass, not a composite).",
                "processing": cand.processing,
                "processingVersion": PROCESSING_VERSION,
                "dayNight": grid.day_night,
                "dayNightNote": grid.day_night_note,
                "nativeResolutionMeters": 1000,
                "gridResolutionMeters": settings.grid_resolution_m,
                "regridding": f"nearest neighbour from swath geolocation, max distance {settings.max_neighbour_distance_m:.0f} m",
                "crs": "Azimuthal Equidistant centred on the city (WGS84)",
                "boundsWgs84": raster.wgs84_bounds(cog),
                "bounds3857": raster.bounds_3857(cog),
                "area": {"mode": aoi.mode, "label": aoi.label, "radiusMeters": aoi.radius_m,
                         "latitude": aoi.latitude, "longitude": aoi.longitude},
                "coverage": stats["coverage"],
                "summary": stats["summary"],
                "partialSummary": stats["partialSummary"],
                "qualityMask": swath.metadata["qualityFlags"],
                "decoding": {k: swath.metadata[k] for k in ("lstUnits", "lstScaleFactor", "lstAddOffset", "lstFillValue")},
                "legend": raster.legend_json(),
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
            (out_dir / "meta.json").write_text(json.dumps(meta, indent=1), "utf-8")
            return {"status": stats["status"], "layer": meta}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def _redact(text: str) -> str:
    """Strip anything that looks like a credential from error text."""
    import re

    text = re.sub(r"(?i)(aws_access_key_id|aws_secret_access_key|signature|x-amz-[a-z-]+)=[^&\s]+", r"\1=***", text)
    return re.sub(r"[A-Za-z0-9/+]{32,}", "***", text)
