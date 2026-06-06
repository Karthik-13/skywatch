import aiosqlite
from typing import Optional
from pathlib import Path

DB_PATH = Path(__file__).parent / "skywatch.db"


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS flyovers (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                icao24      TEXT NOT NULL,
                callsign    TEXT NOT NULL,
                first_seen  TEXT NOT NULL,
                last_seen   TEXT NOT NULL,
                min_distance_m  REAL NOT NULL,
                max_altitude_ft REAL,
                aircraft_type   TEXT,
                status      TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alert_config (
                id                  INTEGER PRIMARY KEY CHECK (id = 1),
                proximity_radius_m  REAL    NOT NULL DEFAULT 5000.0,
                update_interval_ms  INTEGER NOT NULL DEFAULT 60000,
                base_lat            REAL    NOT NULL DEFAULT 51.5074,
                base_lon            REAL    NOT NULL DEFAULT -0.1278
            )
        """)
        # Ensure exactly one config row exists
        await db.execute("""
            INSERT OR IGNORE INTO alert_config (id) VALUES (1)
        """)
        # One-time alignment: 120s default to stay within OpenSky daily credit limit
        await db.execute("""
            UPDATE alert_config SET update_interval_ms = 120000
            WHERE id = 1 AND update_interval_ms < 120000
        """)
        await db.commit()


async def get_alert_config() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alert_config WHERE id = 1") as cur:
            row = await cur.fetchone()
            return dict(row) if row else {}


async def save_alert_config(config: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            UPDATE alert_config
            SET proximity_radius_m = :proximity_radius_m,
                update_interval_ms = :update_interval_ms,
                base_lat           = :base_lat,
                base_lon           = :base_lon
            WHERE id = 1
        """, config)
        await db.commit()


async def upsert_flyover(record: dict):
    """Insert new flyover or update min_distance / last_seen if already tracking."""
    async with aiosqlite.connect(DB_PATH) as db:
        existing = await db.execute(
            "SELECT id, min_distance_m FROM flyovers WHERE icao24 = ? AND last_seen > datetime('now','-1 hour')",
            (record["icao24"],)
        )
        row = await existing.fetchone()
        if row:
            row_id, current_min = row
            new_min = min(current_min, record["min_distance_m"])
            await db.execute("""
                UPDATE flyovers
                SET last_seen = ?, min_distance_m = ?, status = ?
                WHERE id = ?
            """, (record["last_seen"], new_min, record["status"], row_id))
        else:
            await db.execute("""
                INSERT INTO flyovers
                    (icao24, callsign, first_seen, last_seen, min_distance_m, max_altitude_ft, aircraft_type, status)
                VALUES
                    (:icao24, :callsign, :first_seen, :last_seen, :min_distance_m, :max_altitude_ft, :aircraft_type, :status)
            """, record)
        await db.commit()


async def get_flyover_history(limit: int = 50, status_filter: Optional[str] = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status_filter:
            cur = await db.execute(
                "SELECT * FROM flyovers WHERE status = ? ORDER BY last_seen DESC LIMIT ?",
                (status_filter, limit)
            )
        else:
            cur = await db.execute(
                "SELECT * FROM flyovers ORDER BY last_seen DESC LIMIT ?",
                (limit,)
            )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def get_history_stats() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        total = (await (await db.execute("SELECT COUNT(*) FROM flyovers")).fetchone())[0]
        alerts = (await (await db.execute(
            "SELECT COUNT(*) FROM flyovers WHERE status IN ('CRITICAL','WARNING')"
        )).fetchone())[0]
        last = (await (await db.execute(
            "SELECT last_seen FROM flyovers ORDER BY last_seen DESC LIMIT 1"
        )).fetchone())
        return {
            "total_detections": total,
            "proximity_alerts": alerts,
            "last_detection": last[0] if last else None,
        }
