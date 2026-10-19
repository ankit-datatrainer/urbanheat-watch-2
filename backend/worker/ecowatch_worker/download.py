"""Authenticated asset access through the CDSE S3 interface.

Only the individual NetCDF files needed for LST processing are fetched (not the
whole SAFE product), so no archive extraction is required. Object keys come from
STAC asset hrefs; nothing is guessed. Credentials stay inside the worker.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from .config import Settings
from .http_util import assert_allowed_url


class ConfigurationRequired(RuntimeError):
    """Raised when CDSE S3 credentials are not configured."""


class AssetRejected(RuntimeError):
    pass


def parse_s3_href(href: str, allowed_buckets: tuple[str, ...]) -> tuple[str, str]:
    parsed = urlparse(href)
    if parsed.scheme != "s3":
        raise AssetRejected("Asset href is not an s3:// URL")
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if bucket not in allowed_buckets:
        raise AssetRejected(f"Bucket {bucket!r} is not allowlisted")
    if not key or ".." in PurePosixPath(key).parts:
        raise AssetRejected("Invalid object key")
    return bucket, key


def make_s3_client(settings: Settings):
    if not settings.has_s3_credentials:
        raise ConfigurationRequired(
            "CDSE S3 credentials are not configured (CDSE_S3_ACCESS_KEY_ID / CDSE_S3_SECRET_ACCESS_KEY)."
        )
    assert_allowed_url(settings.s3_endpoint, settings.allowed_hosts)
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name="default",
        config=Config(
            connect_timeout=15,
            read_timeout=120,
            retries={"max_attempts": 5, "mode": "adaptive"},
        ),
    )


def download_assets(s3, settings: Settings, hrefs: dict[str, str], dest: Path) -> dict[str, Path]:
    """Download each asset into dest, enforcing a per-file size limit."""
    out: dict[str, Path] = {}
    for name, href in hrefs.items():
        bucket, key = parse_s3_href(href, settings.allowed_s3_buckets)
        head = s3.head_object(Bucket=bucket, Key=key)
        size = int(head.get("ContentLength", 0))
        if size <= 0 or size > settings.max_download_bytes:
            raise AssetRejected(f"Asset {name} has unexpected size {size} bytes")
        target = dest / f"{name}.nc"
        s3.download_file(bucket, key, str(target))
        out[name] = target
    return out
