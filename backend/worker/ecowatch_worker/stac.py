"""Copernicus Data Space Ecosystem STAC discovery for Sentinel-3 SLSTR L2 LST.

Uses the current catalogue at https://stac.dataspace.copernicus.eu/v1 (public,
no authentication needed for search). Asset access is a separate, authenticated
step handled in download.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

from .aoi import Aoi
from .config import Settings
from .http_util import request_json

# Assets needed to decode LST, geolocate it and apply quality flags. Names are the
# STAC asset keys observed on live sentinel-3-sl-2-lst-* items.
REQUIRED_ASSETS = ("LST_in", "geodetic_in", "flags_in")


@dataclass
class Candidate:
    id: str
    collection: str
    platform: str | None
    start: datetime
    end: datetime
    timeliness: str
    asset_hrefs: dict[str, str]
    processing: dict[str, Any] = field(default_factory=dict)
    cloud_cover_percent: float | None = None
    orbit_state: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "collectionId": self.collection,
            "platform": self.platform,
            "acquisitionStart": self.start.isoformat(),
            "acquisitionEnd": self.end.isoformat(),
            "timeliness": self.timeliness,
            "processing": self.processing,
            "granuleCloudCoverPercent": self.cloud_cover_percent,
            "orbitState": self.orbit_state,
        }


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _timeliness(collection: str, product_id: str) -> str:
    if collection.endswith("-nrt") or "_NR_" in product_id:
        return "NRT"
    if collection.endswith("-ntc") or "_NT_" in product_id:
        return "NTC"
    if "_ST_" in product_id:
        return "STC"
    return "unknown"


def _s3_href(asset: dict[str, Any]) -> str | None:
    href = asset.get("href", "")
    if href.startswith("s3://"):
        return href
    alt = (asset.get("alternate") or {}).get("s3", {}).get("href", "")
    return alt if alt.startswith("s3://") else None


def parse_item(item: dict[str, Any]) -> Candidate | None:
    """Turn a STAC item into a Candidate, or None if it lacks required assets."""
    props = item.get("properties") or {}
    assets = item.get("assets") or {}
    hrefs: dict[str, str] = {}
    for name in REQUIRED_ASSETS:
        asset = assets.get(name)
        href = _s3_href(asset) if isinstance(asset, dict) else None
        if not href:
            return None
        hrefs[name] = href
    start_raw = props.get("start_datetime") or props.get("datetime")
    end_raw = props.get("end_datetime") or props.get("datetime")
    if not start_raw or not end_raw:
        return None
    product_id = str(item.get("id"))
    collection = str(item.get("collection", ""))
    processing = {
        k: props[k]
        for k in ("processing:level", "processing:version", "processing:facility", "created", "published", "updated")
        if k in props
    }
    # The product baseline is the last element of the S3 product name, e.g. "..._NR_005".
    tail = product_id.rsplit("_", 1)[-1]
    if tail.isdigit():
        processing.setdefault("baselineCollection", tail)
    cloud = props.get("eo:cloud_cover")
    return Candidate(
        id=product_id,
        collection=collection,
        platform=props.get("platform"),
        start=_parse_time(start_raw),
        end=_parse_time(end_raw),
        timeliness=_timeliness(collection, product_id),
        asset_hrefs=hrefs,
        processing=processing,
        cloud_cover_percent=float(cloud) if isinstance(cloud, (int, float)) else None,
        orbit_state=props.get("sat:orbit_state"),
    )


def _same_host(url: str, base: str) -> bool:
    return urlparse(url).hostname == urlparse(base).hostname


def search_items(
    client: httpx.Client, settings: Settings, aoi: Aoi, start: datetime, end: datetime
) -> list[dict[str, Any]]:
    """Run the STAC search for every AOI bbox, following pagination with hard limits."""
    items: dict[str, dict[str, Any]] = {}
    datetime_range = f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')}/{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    search_url = f"{settings.stac_url}/search"
    max_items = settings.stac_page_limit * settings.max_stac_pages
    for bbox in aoi.search_bboxes():
        body: dict[str, Any] | None = {
            "collections": list(settings.lst_collections),
            "bbox": [round(v, 6) for v in bbox],
            "datetime": datetime_range,
            "limit": settings.stac_page_limit,
            "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        }
        url = search_url
        for _page in range(settings.max_stac_pages):
            if body is None or len(items) >= max_items:
                break
            page = request_json(client, "POST", url, allowed_hosts=settings.allowed_hosts, json_body=body)
            for feature in page.get("features") or []:
                if isinstance(feature, dict) and feature.get("id"):
                    items.setdefault(str(feature["id"]), feature)
            next_link = next(
                (l for l in page.get("links") or [] if l.get("rel") == "next" and l.get("body")), None
            )
            if not next_link or not _same_host(next_link.get("href", search_url), settings.stac_url):
                body = None
            else:
                url = next_link.get("href", search_url)
                body = next_link["body"]
    return list(items.values())


def dedupe_and_sort(candidates: list[Candidate]) -> list[Candidate]:
    """Drop NRT duplicates of acquisitions that also exist as NTC; newest first."""
    best: dict[tuple[str | None, str], Candidate] = {}
    rank = {"NTC": 0, "STC": 1, "NRT": 2, "unknown": 3}
    for c in candidates:
        key = (c.platform, c.start.strftime("%Y%m%dT%H%M%S"))
        existing = best.get(key)
        if existing is None or rank[c.timeliness] < rank[existing.timeliness]:
            best[key] = c
    return sorted(best.values(), key=lambda c: c.start, reverse=True)


def discover(
    client: httpx.Client, settings: Settings, aoi: Aoi, window_hours: int, now: datetime | None = None
) -> list[Candidate]:
    end = now or datetime.now(timezone.utc)
    start = end - timedelta(hours=window_hours)
    parsed = [c for c in (parse_item(i) for i in search_items(client, settings, aoi, start, end)) if c]
    return dedupe_and_sort(parsed)
