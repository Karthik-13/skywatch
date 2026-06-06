"""
OpenSky OAuth2 client credentials flow.

Loads clientId/clientSecret from backend/credentials.json (gitignored).
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("opensky.auth")

TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
CREDENTIALS_PATH = Path(__file__).parent / "credentials.json"
REFRESH_MARGIN_S = 30


class OpenSkyAuth:
    def __init__(self):
        self._client_id: Optional[str] = None
        self._client_secret: Optional[str] = None
        self._token: Optional[str] = None
        self._expires_at: Optional[datetime] = None
        self._load_credentials()

    def _load_credentials(self):
        if not CREDENTIALS_PATH.exists():
            logger.info("No credentials.json — OpenSky requests will be anonymous")
            return
        try:
            data = json.loads(CREDENTIALS_PATH.read_text())
            self._client_id = data.get("client_id") or data.get("clientId")
            self._client_secret = data.get("client_secret") or data.get("clientSecret")
            if self._client_id and self._client_secret:
                logger.info("OpenSky OAuth credentials loaded")
            else:
                logger.warning("credentials.json missing clientId/clientSecret")
        except Exception as e:
            logger.warning("Failed to load credentials.json: %s", e)

    @property
    def is_configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    async def get_headers(self, *, force_refresh: bool = False) -> dict:
        if not self.is_configured:
            return {}
        token = await self._get_token(force_refresh=force_refresh)
        return {"Authorization": f"Bearer {token}"}

    async def _get_token(self, *, force_refresh: bool = False) -> str:
        now = datetime.now(timezone.utc)
        if not force_refresh and self._token and self._expires_at and now < self._expires_at:
            return self._token

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data["access_token"]
        expires_in = int(data.get("expires_in", 1800))
        self._expires_at = now + timedelta(seconds=max(60, expires_in - REFRESH_MARGIN_S))
        logger.debug("OpenSky access token refreshed (expires in %ds)", expires_in)
        return self._token


auth = OpenSkyAuth()
