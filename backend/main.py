"""
SkyWatch HQ — Backend

Run with:
    uvicorn main:app --reload --port 8000
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import AlertConfig, RadarFrame, SystemStatus, ICAO24_PATTERN, VALID_STATUSES
from db import init_db, get_alert_config, save_alert_config, get_flyover_history, get_history_stats
from opensky import fetch_aircraft, cache, MIN_FETCH_INTERVAL_S
from opensky_auth import auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("main")

OPENSKY_AIRCRAFT_URL = "https://opensky-network.org/api/metadata/aircraft/icao/{icao24}"
MIN_POLL_INTERVAL_S = MIN_FETCH_INTERVAL_S

LAT_BOUNDS = (-90.0, 90.0)
LON_BOUNDS = (-180.0, 180.0)

# In-process metadata cache: icao24 → (timestamp, payload)
# Aircraft type/registration rarely changes — 24hr TTL is fine.
_meta_cache: dict[str, tuple[float, dict]] = {}
META_CACHE_TTL_S = 86400  # 24 hours


def effective_poll_interval_s(config: AlertConfig) -> float:
    return max(MIN_POLL_INTERVAL_S, config.update_interval_ms / 1000)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("SkyWatch backend ready (OpenSky min interval: %ds)", MIN_POLL_INTERVAL_S)
    yield


app = FastAPI(title="SkyWatch HQ API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── WebSocket: live radar ─────────────────────────────────────────────────────

@app.websocket("/ws/radar")
async def radar_websocket(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket client connected")

    try:
        try:
            msg = await asyncio.wait_for(ws.receive_json(), timeout=15.0)
        except asyncio.TimeoutError:
            await ws.close(code=1003, reason="Location not received within 15s")
            return

        if msg.get("type") != "set_location":
            await ws.close(code=1003, reason="Expected set_location message")
            return

        try:
            base_lat = float(msg["lat"])
            base_lon = float(msg["lon"])
        except (KeyError, TypeError, ValueError):
            await ws.close(code=1003, reason="Invalid location payload")
            return

        if not (LAT_BOUNDS[0] <= base_lat <= LAT_BOUNDS[1]) or \
           not (LON_BOUNDS[0] <= base_lon <= LON_BOUNDS[1]):
            await ws.close(code=1003, reason="Coordinates out of range")
            return

        logger.info("Client location set — starting radar feed")

        config_row = await get_alert_config()
        config = AlertConfig(**config_row) if config_row else AlertConfig()

        # Stagger first fetch: if the cache was populated very recently (another
        # connection just fetched), wait out the remainder so we don't queue up
        # multiple back-to-back OpenSky calls when tabs open simultaneously.
        wait_s = cache.seconds_until_next_fetch()
        if wait_s > 0:
            await asyncio.sleep(wait_s)

        while True:
            result = await fetch_aircraft(base_lat, base_lon, config.proximity_radius_m)

            interval_ms = int(max(MIN_POLL_INTERVAL_S * 1000, config.update_interval_ms))
            frame = RadarFrame(
                aircraft=result.aircraft,
                base_lat=base_lat,
                base_lon=base_lon,
                proximity_radius_m=config.proximity_radius_m,
                timestamp=datetime.now(timezone.utc).strftime("%H:%M:%S"),
                total_count=len(result.aircraft),
                feed_status=result.feed_status,
                retry_after_s=result.retry_after_s,
                update_interval_ms=interval_ms,
            )
            await ws.send_text(frame.model_dump_json())

            config_row = await get_alert_config()
            config = AlertConfig(**config_row) if config_row else AlertConfig()

            await asyncio.sleep(effective_poll_interval_s(config))

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Unexpected WebSocket error")
    finally:
        logger.info("WebSocket client disconnected")


# ── REST: history ─────────────────────────────────────────────────────────────

@app.get("/api/history")
async def get_history(
    limit: int = Query(default=50, ge=1, le=500),
    status: Optional[str] = None,
):
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    rows = await get_flyover_history(limit=limit, status_filter=status)
    stats = await get_history_stats()
    return {"records": rows, "stats": stats}


# ── REST: aircraft specs (OpenSky metadata) ───────────────────────────────────

@app.get("/api/aircraft/{icao24}")
async def get_aircraft(icao24: str):
    normalized = icao24.lower()
    if not ICAO24_PATTERN.match(normalized):
        raise HTTPException(status_code=400, detail="Invalid ICAO24 address")

    cached = _meta_cache.get(normalized)
    if cached and (time.monotonic() - cached[0]) < META_CACHE_TTL_S:
        return cached[1]

    url = OPENSKY_AIRCRAFT_URL.format(icao24=normalized)
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            headers = await auth.get_headers()
            resp = await client.get(url, headers=headers)
            if resp.status_code == 401 and auth.is_configured:
                headers = await auth.get_headers(force_refresh=True)
                resp = await client.get(url, headers=headers)
            if resp.status_code == 429:
                retry = int(resp.headers.get("X-Rate-Limit-Retry-After-Seconds", 10))
                raise HTTPException(
                    status_code=429,
                    detail=f"OpenSky rate limited — retry after {retry}s",
                    headers={"Retry-After": str(retry)},
                )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="Aircraft not found")
            resp.raise_for_status()
            data = resp.json()
            _meta_cache[normalized] = (time.monotonic(), data)
            return data
    except HTTPException:
        raise
    except Exception:
        logger.exception("OpenSky metadata request failed for %s", normalized)
        raise HTTPException(status_code=502, detail="OpenSky metadata unavailable")


# ── REST: alert config ────────────────────────────────────────────────────────

@app.get("/api/alerts/config", response_model=AlertConfig)
async def read_alert_config():
    config_row = await get_alert_config()
    return AlertConfig(**config_row) if config_row else AlertConfig()


@app.put("/api/alerts/config", response_model=AlertConfig)
async def update_alert_config(config: AlertConfig):
    await save_alert_config(config.model_dump())
    return config


# ── REST: system status ───────────────────────────────────────────────────────

@app.get("/api/status", response_model=SystemStatus)
async def system_status():
    config_row = await get_alert_config()
    config = AlertConfig(**config_row) if config_row else AlertConfig()
    snap = cache.status_snapshot()
    return SystemStatus(
        connected=snap["connected"],
        last_update=snap["last_update"],
        aircraft_count=snap["aircraft_count"],
        data_source="OpenSky Network",
        proximity_radius_m=config.proximity_radius_m,
        feed_status=snap["feed_status"],
        retry_after_s=snap["retry_after_s"],
    )
