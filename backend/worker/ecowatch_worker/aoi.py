"""Area-of-interest geometry.

A geocoded point is not a city boundary. Without a licensed city polygon we use a
geodesic circle ("City-centre area") of a configurable radius. The processing grid
is an Azimuthal Equidistant projection centred on the city: distance from the
centre is exact, so the circle mask is geodesically correct, and the grid has no
antimeridian seam. Within the small radii allowed here (<= 50 km) the AEQD scale
error is far below 0.1 %, so pixels are treated as equal-area.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Geod, Transformer

GEOD = Geod(ellps="WGS84")
EARTH_MEAN_RADIUS_M = 6_371_008.8


@dataclass(frozen=True)
class Aoi:
    latitude: float
    longitude: float
    radius_m: float
    mode: str = "city-centre"

    def __post_init__(self) -> None:
        if not (-90.0 <= self.latitude <= 90.0):
            raise ValueError("latitude out of range")
        if not (-180.0 <= self.longitude <= 180.0):
            raise ValueError("longitude out of range")
        if self.radius_m <= 0:
            raise ValueError("radius must be positive")

    @property
    def label(self) -> str:
        return "City-centre area" if self.mode == "city-centre" else "City boundary"

    def key(self) -> str:
        """Stable cache key. Coordinates rounded to ~1 m."""
        raw = f"{self.mode}:{self.latitude:.5f}:{self.longitude:.5f}:{self.radius_m:.0f}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def crs(self) -> CRS:
        return CRS.from_proj4(
            f"+proj=aeqd +lat_0={self.latitude} +lon_0={self.longitude} +datum=WGS84 +units=m +no_defs"
        )

    def ring(self, n: int = 72) -> list[tuple[float, float]]:
        """Geodesic circle vertices as (lon, lat), longitudes normalised to [-180, 180]."""
        azimuths = np.linspace(0.0, 360.0, n, endpoint=False)
        lons, lats, _ = GEOD.fwd(
            np.full(n, self.longitude), np.full(n, self.latitude), azimuths, np.full(n, self.radius_m)
        )
        return list(zip(lons.tolist(), lats.tolist()))

    def contains_pole(self) -> str | None:
        distance_to_north = math.radians(90.0 - self.latitude) * EARTH_MEAN_RADIUS_M
        distance_to_south = math.radians(self.latitude + 90.0) * EARTH_MEAN_RADIUS_M
        if distance_to_north <= self.radius_m:
            return "north"
        if distance_to_south <= self.radius_m:
            return "south"
        return None

    def search_bboxes(self) -> list[list[float]]:
        """STAC bboxes [west, south, east, north] covering the circle.

        Returns two boxes when the circle crosses the antimeridian, and a full
        longitude band when it contains a pole.
        """
        ring = self.ring()
        lats = [p[1] for p in ring]
        south, north = min(lats), max(lats)
        pole = self.contains_pole()
        if pole == "north":
            return [[-180.0, south, 180.0, 90.0]]
        if pole == "south":
            return [[-180.0, -90.0, 180.0, north]]

        # Unwrap longitudes relative to the centre so a ring crossing ±180 is continuous.
        unwrapped = [((lon - self.longitude + 540.0) % 360.0) - 180.0 + self.longitude for lon, _ in ring]
        west, east = min(unwrapped), max(unwrapped)
        if west < -180.0:
            return [[west + 360.0, south, 180.0, north], [-180.0, south, east, north]]
        if east > 180.0:
            return [[west, south, 180.0, north], [-180.0, south, east - 360.0, north]]
        return [[west, south, east, north]]


def lonlat_to_aeqd(aoi: Aoi, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    transformer = Transformer.from_crs("EPSG:4326", aoi.crs(), always_xy=True)
    return transformer.transform(lon, lat)


def aeqd_to_lonlat(aoi: Aoi, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    transformer = Transformer.from_crs(aoi.crs(), "EPSG:4326", always_xy=True)
    return transformer.transform(x, y)
