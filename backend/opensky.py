"""
OpenSky Network client.

Shared cache: one API call per 10s serves all WebSocket clients.
Handles 429 rate limits with Retry-After backoff.
"""

import math
import time
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import httpx

from models import Aircraft
from db import upsert_flyover
from opensky_auth import auth

logger = logging.getLogger("opensky")

OPENSKY_URL = "https://opensky-network.org/api/states/all"
MIN_FETCH_INTERVAL_S = 5.0 if auth.is_configured else 10.0
DEFAULT_RETRY_AFTER_S = 10

# OpenSky state vector field indices
F_ICAO24    = 0
F_CALLSIGN  = 1
F_LAT       = 6
F_LON       = 5
F_ALT_M     = 7
F_ON_GROUND = 8
F_SPEED_MS  = 9
F_HEADING   = 10
F_VERT_RATE = 11


@dataclass
class FetchResult:
    aircraft: list[Aircraft]
    feed_status: str          # ok | stale | rate_limited | error
    retry_after_s: int = 0
    aircraft_count: int = 0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bounding_box(lat: float, lon: float, radius_km: float = 10):
    deg_lat = radius_km / 111.0
    deg_lon = radius_km / (111.0 * math.cos(math.radians(lat)))
    return lat - deg_lat, lon - deg_lon, lat + deg_lat, lon + deg_lon


def classify_status(distance_m: float, proximity_radius_m: float) -> str:
    if distance_m <= proximity_radius_m:
        return "CRITICAL"
    if distance_m <= proximity_radius_m * 3:
        return "WARNING"
    return "STABLE"


def parse_state(state: list, base_lat: float, base_lon: float, proximity_radius_m: float) -> Optional[Aircraft]:
    try:
        lat = state[F_LAT]
        lon = state[F_LON]
        if lat is None or lon is None:
            return None

        icao24    = state[F_ICAO24] or "??????"
        callsign  = (state[F_CALLSIGN] or icao24).strip() or icao24
        alt_m     = state[F_ALT_M]
        speed_ms  = state[F_SPEED_MS]
        heading   = state[F_HEADING]
        vrate     = state[F_VERT_RATE]
        on_ground = bool(state[F_ON_GROUND])

        distance_m = haversine_m(base_lat, base_lon, lat, lon)
        status = classify_status(distance_m, proximity_radius_m)

        return Aircraft(
            icao24=icao24,
            callsign=callsign,
            lat=round(lat, 5),
            lon=round(lon, 5),
            altitude_ft=round(alt_m * 3.28084, 0) if alt_m is not None else None,
            speed_kts=round(speed_ms * 1.94384, 0) if speed_ms is not None else None,
            heading=round(heading, 0) if heading is not None else None,
            distance_m=round(distance_m, 0),
            vertical_rate=round(vrate, 1) if vrate is not None else None,
            on_ground=on_ground,
            status=status,
        )
    except Exception as e:
        logger.debug("Failed to parse state: %s", e)
        return None


def _parse_states(
    states: list,
    base_lat: float,
    base_lon: float,
    proximity_radius_m: float,
    *,
    persist: bool = False,
) -> list[Aircraft]:
    aircraft: list[Aircraft] = []
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    for state in states:
        ac = parse_state(state, base_lat, base_lon, proximity_radius_m)
        if ac:
            aircraft.append(ac)
            if not persist:
                continue
            task = asyncio.create_task(upsert_flyover({
                "icao24": ac.icao24,
                "callsign": ac.callsign,
                "first_seen": now_utc,
                "last_seen": now_utc,
                "min_distance_m": ac.distance_m,
                "max_altitude_ft": ac.altitude_ft,
                "aircraft_type": None,
                "status": ac.status,
            }))
            def _on_done(t):
                if not t.cancelled() and t.exception():
                    logger.error("upsert_flyover failed: %s", t.exception())
            task.add_done_callback(_on_done)

    aircraft.sort(key=lambda a: a.distance_m)
    return aircraft


class OpenSkyCache:
    """Global singleton — deduplicates OpenSky /states/all calls across all clients."""

    def __init__(self):
        self._lock = asyncio.Lock()
        self._raw_states: list = []
        self._last_api_call: Optional[float] = None
        self._last_success_at: Optional[datetime] = None
        self._rate_limited_until: float = 0.0
        self._retry_after_s: int = 0
        self._last_feed_status: str = "ok"
        self._last_count: int = 0
        self._fetch_center_lat: Optional[float] = None
        self._fetch_center_lon: Optional[float] = None

    def _seconds_until_fetch(self) -> float:
        now = time.monotonic()
        if now < self._rate_limited_until:
            return self._rate_limited_until - now
        if self._last_api_call is None:
            return 0.0
        elapsed = now - self._last_api_call
        if elapsed < MIN_FETCH_INTERVAL_S:
            return MIN_FETCH_INTERVAL_S - elapsed
        return 0.0

    async def _call_opensky(self, base_lat: float, base_lon: float) -> bool:
        lamin, lomin, lamax, lomax = bounding_box(base_lat, base_lon, radius_km=10)
        params = {"lamin": lamin, "lomin": lomin, "lamax": lamax, "lomax": lomax}

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                headers = await auth.get_headers()
                resp = await client.get(OPENSKY_URL, params=params, headers=headers)

                if resp.status_code == 401 and auth.is_configured:
                    headers = await auth.get_headers(force_refresh=True)
                    resp = await client.get(OPENSKY_URL, params=params, headers=headers)

                if resp.status_code == 429:
                    retry = int(resp.headers.get("X-Rate-Limit-Retry-After-Seconds", DEFAULT_RETRY_AFTER_S))
                    now = time.monotonic()
                    self._rate_limited_until = now + retry
                    self._last_api_call = now
                    self._retry_after_s = retry
                    self._last_feed_status = "rate_limited"
                    logger.warning("OpenSky 429 — retry after %ds", retry)
                    return False

                resp.raise_for_status()
                data = resp.json()
                self._raw_states = data.get("states") or []
                self._fetch_center_lat = base_lat
                self._fetch_center_lon = base_lon
                self._last_api_call = time.monotonic()
                self._last_success_at = datetime.now(timezone.utc)
                self._rate_limited_until = 0.0
                self._retry_after_s = 0
                self._last_feed_status = "ok"
                logger.info("OpenSky fetch OK — %d raw states", len(self._raw_states))
                return True

        except Exception as e:
            self._last_feed_status = "error"
            logger.warning("OpenSky fetch failed: %s", e)
            return False

    async def get_aircraft(self, base_lat: float, base_lon: float, proximity_radius_m: float) -> FetchResult:
        async with self._lock:
            now = time.monotonic()
            wait_s = self._seconds_until_fetch()

            if wait_s > 0:
                status = "rate_limited" if now < self._rate_limited_until else "stale"
                aircraft = _parse_states(self._raw_states, base_lat, base_lon, proximity_radius_m) if self._raw_states else []
                self._last_count = len(aircraft)
                return FetchResult(
                    aircraft=aircraft,
                    feed_status=status,
                    retry_after_s=max(1, int(math.ceil(wait_s))),
                    aircraft_count=len(aircraft),
                )

            ok = await self._call_opensky(base_lat, base_lon)
            if not ok and self._raw_states:
                aircraft = _parse_states(
                    self._raw_states, base_lat, base_lon, proximity_radius_m, persist=False
                )
                self._last_count = len(aircraft)
                return FetchResult(
                    aircraft=aircraft,
                    feed_status=self._last_feed_status,
                    retry_after_s=self._retry_after_s,
                    aircraft_count=len(aircraft),
                )

            if not ok:
                aircraft = _parse_states(
                    self._raw_states, base_lat, base_lon, proximity_radius_m, persist=False
                ) if self._raw_states else []
                self._last_count = len(aircraft)
                return FetchResult(
                    aircraft=aircraft,
                    feed_status=self._last_feed_status,
                    retry_after_s=self._retry_after_s,
                    aircraft_count=len(aircraft),
                )

            aircraft = _parse_states(
                self._raw_states, base_lat, base_lon, proximity_radius_m, persist=True
            )
            self._last_count = len(aircraft)
            return FetchResult(
                aircraft=aircraft,
                feed_status="ok",
                retry_after_s=0,
                aircraft_count=len(aircraft),
            )

    def seconds_until_next_fetch(self) -> float:
        """Public helper so callers can stagger their first fetch."""
        return self._seconds_until_fetch()

    def status_snapshot(self) -> dict:
        wait_s = self._seconds_until_fetch()
        age_s = (
            (datetime.now(timezone.utc) - self._last_success_at).total_seconds()
            if self._last_success_at else None
        )
        return {
            "connected": age_s is not None and age_s < 120,
            "last_update": self._last_success_at.strftime("%H:%M:%S") if self._last_success_at else None,
            "aircraft_count": self._last_count,
            "feed_status": self._last_feed_status,
            "retry_after_s": max(0, int(math.ceil(wait_s))),
        }


cache = OpenSkyCache()


async def fetch_aircraft(base_lat: float, base_lon: float, proximity_radius_m: float) -> FetchResult:
    """Fetch aircraft via shared cache. Never raises."""
    return await cache.get_aircraft(base_lat, base_lon, proximity_radius_m)
