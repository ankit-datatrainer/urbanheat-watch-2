"""Internal FastAPI interface of the geospatial worker.

Only the Node API talks to this service. When WORKER_TOKEN is set every request
must carry it in the X-Worker-Token header. Do not expose this port publicly.
"""

from __future__ import annotations

import hmac
import logging
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field

from . import raster
from .aoi import Aoi
from .config import load_settings
from .jobs import JobManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = load_settings()
manager = JobManager(settings)
app = FastAPI(title="EcoWatch geospatial worker", docs_url=None, redoc_url=None)


def require_token(x_worker_token: str | None = Header(default=None)) -> None:
    if settings.worker_token and not hmac.compare_digest(x_worker_token or "", settings.worker_token):
        raise HTTPException(status_code=401, detail="unauthorized")


class JobRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radiusKm: float = Field(gt=0, le=50)
    areaMode: str = Field(default="city-centre", pattern="^city-centre$")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "s3CredentialsConfigured": settings.has_s3_credentials}


@app.post("/jobs", dependencies=[Depends(require_token)])
def create_job(body: JobRequest) -> dict:
    aoi = Aoi(latitude=body.latitude, longitude=body.longitude, radius_m=body.radiusKm * 1000, mode=body.areaMode)
    try:
        job = manager.submit(aoi)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return job.to_json()


@app.get("/jobs/{job_id}", dependencies=[Depends(require_token)])
def get_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if not job:
        return {"jobId": job_id, "status": "expired", "result": None, "error": None}
    return job.to_json()


@app.delete("/jobs/{job_id}", dependencies=[Depends(require_token)])
def cancel_job(job_id: str) -> dict:
    job = manager.cancel(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job.to_json()


def _layer_path(layer_id: str) -> tuple[Path, dict]:
    path = manager.layer_dir(layer_id)
    meta = manager.layer_meta(layer_id) if path else None
    if not path or not meta:
        raise HTTPException(status_code=404, detail="layer not found")
    return path, meta


@app.get("/layers/{layer_id}", dependencies=[Depends(require_token)])
def get_layer(layer_id: str) -> dict:
    return _layer_path(layer_id)[1]


@app.get("/layers/{layer_id}/tiles/{z}/{x}/{y}.png", dependencies=[Depends(require_token)])
def get_tile(layer_id: str, z: int, x: int, y: int) -> Response:
    path, meta = _layer_path(layer_id)
    if not (0 <= z <= raster.MAX_TILE_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z):
        raise HTTPException(status_code=400, detail="tile out of range")
    cached = path / "tiles" / str(z) / str(x) / f"{y}.png"
    if cached.exists():
        data = cached.read_bytes()
    else:
        data = raster.render_tile(path / "lst.tif", meta["bounds3857"], z, x, y)
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
    # Layers are immutable for a given layerId, so tiles can be cached aggressively.
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400, immutable"})


@app.get("/layers/{layer_id}/value", dependencies=[Depends(require_token)])
def get_value(layer_id: str, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)) -> dict:
    path, meta = _layer_path(layer_id)
    result = raster.query_pixel(path / "lst.tif", lat, lng)
    return {
        **result,
        "units": "°C",
        "variable": "Satellite land-surface temperature",
        "acquisitionStart": meta["acquisitionStart"],
        "acquisitionEnd": meta["acquisitionEnd"],
        "nativeResolutionMeters": meta["nativeResolutionMeters"],
        "productId": meta["productId"],
    }
