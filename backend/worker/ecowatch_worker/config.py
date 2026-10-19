"""Worker configuration, read once from environment variables.

Every limit here is an engineering default, not a scientific constant. Values that
change processing output (QA options, coverage threshold, grid) feed into the layer
cache key so a config change never serves a stale raster.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip()


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    return float(raw) if raw is not None else default


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    return int(raw) if raw is not None else default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


# Bump whenever processing logic changes in a way that alters output pixels or stats.
PROCESSING_VERSION = "lst-v1.0.0"


@dataclass(frozen=True)
class QaConfig:
    """Quality-mask options. Included in the layer cache key."""

    mask_tidal_as_water: bool = True
    # Product flag names (read from flag_meanings) that make a pixel unusable.
    invalid_confidence_flags: tuple[str, ...] = ("unfilled", "cosmetic", "duplicate", "summary_pointing")
    cloud_confidence_flags: tuple[str, ...] = ("summary_cloud",)
    water_confidence_flags: tuple[str, ...] = ("ocean", "inland_water")

    def key(self) -> str:
        return (
            f"tidal={int(self.mask_tidal_as_water)};"
            f"invalid={','.join(self.invalid_confidence_flags)};"
            f"cloud={','.join(self.cloud_confidence_flags)};"
            f"water={','.join(self.water_confidence_flags)}"
        )


@dataclass(frozen=True)
class Settings:
    stac_url: str = "https://stac.dataspace.copernicus.eu/v1"
    # Collection IDs verified against the live /collections response on 2026-10-10.
    lst_collections: tuple[str, ...] = ("sentinel-3-sl-2-lst-nrt", "sentinel-3-sl-2-lst-ntc")
    s3_endpoint: str = "https://eodata.dataspace.copernicus.eu"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    allowed_s3_buckets: tuple[str, ...] = ("eodata",)
    allowed_hosts: tuple[str, ...] = ("stac.dataspace.copernicus.eu", "eodata.dataspace.copernicus.eu")

    cache_dir: Path = Path("./.cache")
    worker_token: str | None = None

    min_valid_area_percent: float = 30.0
    search_windows_hours: tuple[int, ...] = (72, 168)
    max_radius_km: float = 50.0
    max_products_per_job: int = 4
    max_stac_pages: int = 5
    stac_page_limit: int = 50
    max_download_bytes: int = 300 * 1024 * 1024
    max_grid_pixels: int = 250_000
    grid_resolution_m: float = 1000.0
    # Nearest-neighbour search radius when regridding swath pixels. SLSTR nadir pixels
    # are ~1 km and grow towards the swath edge; beyond this distance a target cell
    # is left empty rather than filled from a distant pixel.
    max_neighbour_distance_m: float = 1500.0
    concurrency: int = 2
    job_ttl_seconds: int = 6 * 3600
    http_timeout_s: float = 30.0

    qa: QaConfig = field(default_factory=QaConfig)

    @property
    def has_s3_credentials(self) -> bool:
        return bool(self.s3_access_key_id and self.s3_secret_access_key)


def load_settings() -> Settings:
    return Settings(
        stac_url=_env("CDSE_STAC_URL", "https://stac.dataspace.copernicus.eu/v1").rstrip("/"),
        s3_endpoint=_env("CDSE_S3_ENDPOINT", "https://eodata.dataspace.copernicus.eu").rstrip("/"),
        s3_access_key_id=_env("CDSE_S3_ACCESS_KEY_ID"),
        s3_secret_access_key=_env("CDSE_S3_SECRET_ACCESS_KEY"),
        cache_dir=Path(_env("WORKER_CACHE_DIR", "./.cache")).resolve(),
        worker_token=_env("WORKER_TOKEN"),
        min_valid_area_percent=_env_float("LST_MIN_VALID_AREA_PERCENT", 30.0),
        max_radius_km=_env_float("LST_MAX_RADIUS_KM", 50.0),
        max_products_per_job=_env_int("LST_MAX_PRODUCTS_PER_JOB", 4),
        concurrency=_env_int("WORKER_CONCURRENCY", 2),
        qa=QaConfig(mask_tidal_as_water=_env_bool("LST_MASK_TIDAL_AS_WATER", True)),
    )
