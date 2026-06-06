"""
SkyWatch HQ — Backend

Run with:
    uvicorn main:app --reload --port 8000
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import AlertConfig, ICAO24_PATTERN, RadarFrame, SystemStatus, VALID_STATUSES
from db import init_db, get_alert_config, save_alert_config, get_flyover_history, get_history_stats
from opensky import poller

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("main")

OPENSKY_AIRCRAFT_URL = "https://opensky-network.org/api/metadata/aircraft/icao/{icao24}"


# ── App lifespan ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    config_row = await get_alert_config()
    config = AlertConfig(**config_row) if config_row else AlertConfig()
    poller.set_config(config)
    poll_task = asyncio.create_task(poller.run(interval_s=config.update_interval_ms / 1000))
    logger.info("SkyWatch backend started. Base: %.4f, %.4f | Radius: %.0fm",
                config.base_lat, config.base_lon, config.proximity_radius_m)
    yield
    poller.stop()
    poll_task.cancel()


app = FastAPI(title="SkyWatch HQ API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── WebSocket: live radar ─────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        logger.info("WebSocket client connected. Total: %d", len(self.active))

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)
        logger.info("WebSocket client disconnected. Total: %d", len(self.active))

    async def broadcast(self, data: str):
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)


manager = ConnectionManager()


@app.websocket("/ws/radar")
async def radar_websocket(ws: WebSocket):
    await manager.connect(ws)
    config_row = await get_alert_config()
    config = AlertConfig(**config_row) if config_row else AlertConfig()

    try:
        while True:
            frame = RadarFrame(
                aircraft=poller.latest,
                base_lat=config.base_lat,
                base_lon=config.base_lon,
                proximity_radius_m=config.proximity_radius_m,
                timestamp=datetime.now(timezone.utc).strftime("%H:%M:%S"),
                total_count=len(poller.latest),
            )
            await ws.send_text(frame.model_dump_json())
            await asyncio.sleep(config.update_interval_ms / 1000)
    except WebSocketDisconnect:
        manager.disconnect(ws)


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
    url = OPENSKY_AIRCRAFT_URL.format(icao24=normalized)
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(url)
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="Aircraft not found")
            resp.raise_for_status()
            return resp.json()
    except HTTPException:
        raise
    except Exception:
        logger.exception("OpenSky metadata request failed for %s", normalized)
        raise HTTPException(status_code=502, detail="OpenSky metadata unavailable")


# ── REST: alert config ────────────────────────────────────────────────────────

@app.get("/api/alerts/config", response_model=AlertConfig)
async def read_alert_config():
    row = await get_alert_config()
    return AlertConfig(**row) if row else AlertConfig()


@app.put("/api/alerts/config", response_model=AlertConfig)
async def update_alert_config(config: AlertConfig):
    await save_alert_config(config.model_dump())
    poller.set_config(config)
    return config


# ── REST: system status ───────────────────────────────────────────────────────

@app.get("/api/status", response_model=SystemStatus)
async def system_status():
    config_row = await get_alert_config()
    config = AlertConfig(**config_row) if config_row else AlertConfig()
    return SystemStatus(
        connected=poller.last_update is not None,
        last_update=poller.last_update,
        aircraft_count=len(poller.latest),
        data_source="OpenSky Network",
        proximity_radius_m=config.proximity_radius_m,
    )
