import re

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

ICAO24_PATTERN = re.compile(r"^[0-9a-f]{6}$")
VALID_STATUSES = frozenset({"CRITICAL", "WARNING", "STABLE"})


class Aircraft(BaseModel):
    icao24: str
    callsign: str
    lat: float
    lon: float
    altitude_ft: Optional[float]
    speed_kts: Optional[float]
    heading: Optional[float]
    distance_m: float          # from base station
    vertical_rate: Optional[float]
    on_ground: bool
    status: str                # CRITICAL | WARNING | STABLE


class RadarFrame(BaseModel):
    aircraft: list[Aircraft]
    base_lat: float
    base_lon: float
    proximity_radius_m: float
    timestamp: str             # HH:MM:SS UTC
    total_count: int
    feed_status: str = "ok"    # ok | stale | rate_limited | error
    retry_after_s: int = 0
    update_interval_ms: int = 60000


class FlyoverRecord(BaseModel):
    id: Optional[int] = None
    icao24: str
    callsign: str
    first_seen: str
    last_seen: str
    min_distance_m: float
    max_altitude_ft: Optional[float]
    aircraft_type: Optional[str]
    status: str


class AlertConfig(BaseModel):
    proximity_radius_m: float = Field(default=500.0, ge=10, le=5000)
    update_interval_ms: int = Field(default=120000, ge=60000, le=300000)
    base_lat: float = Field(default=51.5074, ge=-90, le=90)
    base_lon: float = Field(default=-0.1278, ge=-180, le=180)


class SystemStatus(BaseModel):
    connected: bool
    last_update: Optional[str]
    aircraft_count: int
    data_source: str
    proximity_radius_m: float
    feed_status: str = "ok"
    retry_after_s: int = 0
