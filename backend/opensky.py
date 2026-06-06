"""
OpenSky Network client.

Fetches live aircraft states within a bounding box around the base station,
computes distance from base, classifies status, and persists flyovers to DB.
"""

import math
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from models import Aircraft, AlertConfig
from db import upsert_flyover

logger = logging.getLogger("opensky")

OPENSKY_URL = "https://opensky-network.org/api/states/all"

# OpenSky state vector field indices
F_ICAO24    = 0
F_CALLSIGN  = 1
F_LAT       = 6
F_LON       = 5
F_ALT_M     = 7   # barometric altitude in metres
F_ON_GROUND = 8
F_SPEED_MS  = 9   # metres/second
F_HEADING   = 10
F_VERT_RATE = 11  # m/s


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two lat/lon points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bounding_box(lat: float, lon: float, radius_km: float = 150):
    """Return (lamin, lomin, lamax, lomax) for a circle approximation."""
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

        icao24   = state[F_ICAO24] or "??????"
        callsign = (state[F_CALLSIGN] or icao24).strip() or icao24
        alt_m    = state[F_ALT_M]
        speed_ms = state[F_SPEED_MS]
        heading  = state[F_HEADING]
        vrate    = state[F_VERT_RATE]
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


class OpenSkyPoller:
    def __init__(self):
        self.latest: list[Aircraft] = []
        self.last_update: Optional[str] = None
        self._config: Optional[AlertConfig] = None
        self._running = False

    def set_config(self, config: AlertConfig):
        self._config = config

    async def _fetch(self) -> list[Aircraft]:
        if not self._config:
            return []

        cfg = self._config
        lamin, lomin, lamax, lomax = bounding_box(cfg.base_lat, cfg.base_lon)

        params = {"lamin": lamin, "lomin": lomin, "lamax": lamax, "lomax": lomax}

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(OPENSKY_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            logger.warning("OpenSky fetch failed: %s", e)
            return self.latest  # return stale data rather than empty

        states = data.get("states") or []
        aircraft = []
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        for state in states:
            ac = parse_state(state, cfg.base_lat, cfg.base_lon, cfg.proximity_radius_m)
            if ac:
                aircraft.append(ac)
                # Persist to history DB asynchronously
                asyncio.create_task(upsert_flyover({
                    "icao24": ac.icao24,
                    "callsign": ac.callsign,
                    "first_seen": now_utc,
                    "last_seen": now_utc,
                    "min_distance_m": ac.distance_m,
                    "max_altitude_ft": ac.altitude_ft,
                    "aircraft_type": None,
                    "status": ac.status,
                }))

        # Sort: closest first
        aircraft.sort(key=lambda a: a.distance_m)
        return aircraft

    async def run(self, interval_s: float = 5.0):
        self._running = True
        while self._running:
            try:
                self.latest = await self._fetch()
                self.last_update = datetime.now(timezone.utc).strftime("%H:%M:%S")
                logger.info("Fetched %d aircraft", len(self.latest))
            except Exception as e:
                logger.error("Poller error: %s", e)
            await asyncio.sleep(interval_s)

    def stop(self):
        self._running = False


# Singleton used by main.py
poller = OpenSkyPoller()
