(function () {
  "use strict";

  const API_BASE =
    window.SKYWATCH_API ||
    `${window.location.protocol}//${window.location.hostname}:8000`;
  const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/radar";
  const PANEL_RADIUS_M = 5000;

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDist(m) {
    if (m < 1000) return `${Math.round(m)}M`;
    const nm = m / 1852;
    if (nm < 10) return `${nm.toFixed(1)} NM`;
    return `${(m / 1000).toFixed(1)}KM`;
  }

  function fmtAlt(ft) {
    if (ft == null) return "—";
    return Math.round(ft).toLocaleString();
  }

  function fmtSpd(kts) {
    if (kts == null) return "—";
    return Math.round(kts).toString();
  }

  function fmtHdg(deg) {
    if (deg == null) return "—";
    return `${Math.round(deg)}°`;
  }

  function hdgCardinal(deg) {
    if (deg == null) return "—";
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(deg / 45) % 8];
  }

  function fmtVrate(mps) {
    if (mps == null) return "—";
    const fpm = Math.round(mps * 196.85);
    const sign = fpm >= 0 ? "+" : "";
    return `${sign}${fpm.toLocaleString()} FPM`;
  }

  function icaoFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("icao24") || "").toLowerCase().trim();
    return /^[0-9a-f]{6}$/.test(raw) ? raw : null;
  }

  function setUrlIcao(icao24) {
    const url = new URL(window.location.href);
    url.searchParams.set("icao24", icao24);
    history.replaceState(null, "", url);
  }

  function aircraftTypeLabel(meta) {
    if (!meta) return "—";
    const parts = [meta.manufacturerName, meta.model].filter(Boolean);
    if (parts.length) return parts.join(" ");
    return meta.typecode || "—";
  }

  function weightClass(meta, ac) {
    if (ac?.status === "CRITICAL") return "CRITICAL";
    if (ac?.status === "WARNING") return "WARNING";
    const cls = meta?.icaoAircraftClass || "";
    if (cls.startsWith("L")) return "HEAVY";
    if (cls.startsWith("M")) return "MEDIUM";
    if (cls.startsWith("S")) return "LIGHT";
    return ac?.status || "STABLE";
  }

  const state = {
    selectedIcao24: icaoFromUrl(),
    baseLat: 51.5074,
    baseLon: -0.1278,
    aircraft: [],
    proximityRadius: 5000,
    metadata: null,
    metaIcao: null,
    metaLoading: false,
    ws: null,
    connected: false,
    reconnectDelay: 2000,
    lastTimestamp: null,
    feedStatus: "ok",
    retryAfterS: 0,
  };

  function feedSubtitleText(ac) {
    if (!state.connected) return "Reconnecting to radar feed…";
    if (state.feedStatus === "rate_limited") {
      return `OpenSky rate limited — retry in ${state.retryAfterS}s`;
    }
    if (state.feedStatus === "stale") {
      return `Cached feed — refresh in ${state.retryAfterS}s`;
    }
    if (state.feedStatus === "error") {
      return "Feed error — showing last known data";
    }
    if (ac) {
      return `Last update: ${state.lastTimestamp || "—"} UTC • ${fmtDist(ac.distance_m)} from base`;
    }
    return `Last update: ${state.lastTimestamp || "—"} UTC`;
  }

  function updateFeedIndicators(ac) {
    const feedStatus = $("#feed-status");
    const feedSubtitle = $("#feed-subtitle");
    const feedDot = $("#feed-dot");
    const limited = state.feedStatus === "rate_limited" || state.feedStatus === "error";

    if (feedStatus) {
      if (!state.connected) feedStatus.textContent = "FEED OFFLINE";
      else if (limited) feedStatus.textContent = "RATE LIMITED";
      else if (state.feedStatus === "stale") feedStatus.textContent = "CACHED FEED";
      else feedStatus.textContent = "FEED SYNCED";
    }
    if (feedDot) {
      if (!state.connected || limited) {
        feedDot.className = "w-2 h-2 rounded-full bg-error shadow-[0_0_8px_#ffb4ab]";
      } else if (state.feedStatus === "stale") {
        feedDot.className = "w-2 h-2 rounded-full bg-tertiary-fixed-dim shadow-[0_0_8px_#ffb77a]";
      } else {
        feedDot.className = "w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_#a7ffb3]";
      }
    }
    if (feedSubtitle) feedSubtitle.textContent = feedSubtitleText(ac);
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/alerts/config`);
      if (!res.ok) return;
      const cfg = await res.json();
      state.baseLat = cfg.base_lat;
      state.baseLon = cfg.base_lon;
      state.proximityRadius = cfg.proximity_radius_m;
    } catch (_) {
      /* use defaults */
    }
  }

  async function loadMetadata(icao24) {
    if (!icao24 || (state.metaIcao === icao24 && state.metadata)) return;
    state.metaLoading = true;
    state.metaIcao = icao24;
    try {
      const res = await fetch(`${API_BASE}/api/aircraft/${icao24}`);
      if (res.ok) {
        state.metadata = await res.json();
      } else {
        state.metadata = null;
      }
    } catch (_) {
      state.metadata = null;
    }
    state.metaLoading = false;
    renderSpecs(state.aircraft.find((a) => a.icao24 === icao24));
  }

  function renderRecentContacts(contacts) {
    const el = $("#recent-contacts");
    if (!el) return;

    if (contacts.length === 0) {
      el.innerHTML =
        '<div class="font-telemetry-sm text-telemetry-sm text-on-surface-variant p-3">No contacts within 5km</div>';
      return;
    }

    el.innerHTML = contacts
      .map((ac) => {
        const selected = ac.icao24 === state.selectedIcao24;
        const meta = ac.icao24 === state.metaIcao ? state.metadata : null;
        const typeLine = meta
          ? `${escapeHtml(meta.typecode || "—")} • ${escapeHtml(meta.registration || ac.icao24.toUpperCase())}`
          : escapeHtml(ac.icao24.toUpperCase());
        const rowClass = selected
          ? "flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded cursor-pointer hover:bg-primary/10 transition-colors"
          : "flex items-center justify-between p-3 hover:bg-surface-variant/30 rounded cursor-pointer transition-colors";
        const callsignClass = selected ? "text-primary" : "text-on-surface";
        const chevronClass = selected ? "text-primary" : "text-on-surface-variant";

        return `<div class="${rowClass}" data-icao24="${escapeHtml(ac.icao24)}">
<div class="flex flex-col">
<span class="font-telemetry-sm text-telemetry-sm ${callsignClass}">${escapeHtml(ac.callsign || ac.icao24)}</span>
<span class="font-label-caps text-label-caps text-on-surface-variant">${typeLine}</span>
</div>
<span class="material-symbols-outlined ${chevronClass} text-[20px]">chevron_right</span>
</div>`;
      })
      .join("");
  }

  function renderTelemetry(ac) {
    const callsign = ac.callsign || ac.icao24;

    const headerLoc = $("#header-locating");
    if (headerLoc) headerLoc.textContent = `LOCATING: ${callsign}`;

    const altEl = $("#alt-val");
    const speedEl = $("#speed-val");
    const hdgEl = $("#hdg-val");
    const hdgCardinalEl = $("#hdg-cardinal");
    const altBar = $("#alt-bar");
    const speedBar = $("#speed-bar");

    if (altEl) altEl.textContent = fmtAlt(ac.altitude_ft);
    if (speedEl) speedEl.textContent = fmtSpd(ac.speed_kts);
    if (hdgEl) hdgEl.textContent = fmtHdg(ac.heading);
    if (hdgCardinalEl) hdgCardinalEl.textContent = hdgCardinal(ac.heading);
    if (altBar && ac.altitude_ft != null) {
      altBar.style.width = `${Math.min(100, (ac.altitude_ft / 45000) * 100)}%`;
    }
    if (speedBar && ac.speed_kts != null) {
      speedBar.style.width = `${Math.min(100, (ac.speed_kts / 550) * 100)}%`;
    }

    updateFeedIndicators(ac);

    const compassArrow = $("#compass-arrow");
    const compassLabel = $("#compass-label");
    if (compassArrow && ac.heading != null) {
      compassArrow.style.transform = `rotate(${Math.round(ac.heading)}deg)`;
    }
    if (compassLabel) compassLabel.textContent = fmtHdg(ac.heading);

    const mapCallsign = $("#map-callsign");
    if (mapCallsign) mapCallsign.textContent = callsign;

    const proxTarget = $("#prox-target");
    const proxDistance = $("#prox-distance");
    const proxVsep = $("#prox-vsep");
    if (proxTarget) proxTarget.textContent = `Target: ${callsign}`;
    if (proxDistance) proxDistance.textContent = fmtDist(ac.distance_m);
    if (proxVsep) proxVsep.textContent = fmtVrate(ac.vertical_rate);

    const approachVector = $("#approach-vector");
    const approachDetail = $("#approach-detail");
    if (approachVector) {
      approachVector.textContent =
        ac.status === "CRITICAL"
          ? "PROXIMITY BREACH"
          : ac.status === "WARNING"
            ? "ADVISORY RANGE"
            : "TRACKING VECTOR";
    }
    if (approachDetail) {
      approachDetail.textContent = `HDG ${fmtHdg(ac.heading)} • ${fmtDist(ac.distance_m)} • ${ac.on_ground ? "ON GROUND" : "AIRBORNE"}`;
    }

    renderSpecs(ac);
  }

  function renderSpecs(ac) {
    const meta = state.metadata;
    const title = $("#spec-title");
    const reg = $("#spec-registration");
    const badge = $("#spec-badge");

    if (title) title.textContent = aircraftTypeLabel(meta);
    if (reg) {
      reg.textContent = meta?.registration
        ? `Registration: ${meta.registration}`
        : ac
          ? `ICAO: ${ac.icao24.toUpperCase()}`
          : "Registration: —";
    }
    if (badge) badge.textContent = weightClass(meta, ac);

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || "—";
    };

    set("spec-range", meta?.country || null);
    set(
      "spec-cruise",
      ac?.speed_kts != null ? `${Math.round(ac.speed_kts)} KTS` : null
    );
    set("spec-engine", meta?.engines || meta?.typecode || null);
    set("spec-occupancy", meta?.operator || meta?.owner || null);
  }

  function renderEmpty(message) {
    const headerLoc = $("#header-locating");
    if (headerLoc) headerLoc.textContent = "LOCATING: —";
    updateFeedIndicators(null);
    const feedSubtitle = $("#feed-subtitle");
    if (feedSubtitle && message) feedSubtitle.textContent = message;
  }

  function applyFrame(frame) {
    state.aircraft = (frame.aircraft || []).slice().sort((a, b) => a.distance_m - b.distance_m);
    state.proximityRadius = frame.proximity_radius_m;
    state.lastTimestamp = frame.timestamp;
    state.feedStatus = frame.feed_status || "ok";
    state.retryAfterS = frame.retry_after_s || 0;

    const contacts = state.aircraft.filter((ac) => ac.distance_m <= PANEL_RADIUS_M);
    renderRecentContacts(contacts);

    let ac = state.selectedIcao24
      ? state.aircraft.find((a) => a.icao24 === state.selectedIcao24)
      : null;

    if (!ac && contacts.length > 0) {
      ac = contacts[0];
      state.selectedIcao24 = ac.icao24;
      setUrlIcao(ac.icao24);
      loadMetadata(ac.icao24);
    }

    if (ac) {
      renderTelemetry(ac);
    } else {
      renderEmpty(
        contacts.length === 0
          ? "No aircraft within 5km of base"
          : "Selected aircraft not in current feed"
      );
    }
  }

  function selectAircraft(icao24) {
    if (!icao24 || icao24 === state.selectedIcao24) return;
    state.selectedIcao24 = icao24;
    setUrlIcao(icao24);
    loadMetadata(icao24);
    const ac = state.aircraft.find((a) => a.icao24 === icao24);
    if (ac) renderTelemetry(ac);
    renderRecentContacts(
      state.aircraft.filter((a) => a.distance_m <= PANEL_RADIUS_M)
    );
  }

  function openWs(lat, lon) {
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.close();
    }

    const ws = new WebSocket(WS_URL);
    state.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "set_location", lat, lon }));
      state.connected = true;
    };

    ws.onmessage = (event) => {
      try {
        applyFrame(JSON.parse(event.data));
      } catch (e) {
        console.error("Manifest frame parse error", e);
      }
    };

    ws.onclose = () => {
      state.connected = false;
      const feedStatus = $("#feed-status");
      if (feedStatus) feedStatus.textContent = "FEED OFFLINE";
      setTimeout(() => openWs(state.baseLat, state.baseLon), state.reconnectDelay);
    };

    ws.onerror = () => ws.close();
  }

  function startFeed() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.baseLat = pos.coords.latitude;
        state.baseLon = pos.coords.longitude;
        openWs(pos.coords.latitude, pos.coords.longitude);
      },
      () => openWs(state.baseLat, state.baseLon),
      { maximumAge: 0, timeout: 10000, enableHighAccuracy: true }
    );
  }

  function init() {
    const recent = $("#recent-contacts");
    if (recent) {
      recent.addEventListener("click", (e) => {
        const row = e.target.closest("[data-icao24]");
        if (row) selectAircraft(row.dataset.icao24);
      });
    }

    if (state.selectedIcao24) loadMetadata(state.selectedIcao24);
    loadConfig().then(startFeed);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
