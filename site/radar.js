(function () {
  "use strict";

  const API_BASE =
    window.SKYWATCH_API ||
    `${window.location.protocol}//${window.location.hostname}:8000`;
  const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/radar";
  const RADAR_RANGE_M = 5000; // tactical scope: outer 5KM ring = 400px radius
  const RADAR_RADIUS_PX = 400;
  const PANEL_RADIUS_M = 5000; // manifest + telemetry log matches radar scope

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtCoord(lat, lon) {
    const latH = lat >= 0 ? "N" : "S";
    const lonH = lon >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(4)}° ${latH}, ${Math.abs(lon).toFixed(4)}° ${lonH}`;
  }

  function fmtDist(m) {
    if (m < 1000) return `${Math.round(m)}M`;
    return `${(m / 1000).toFixed(1)}KM`;
  }

  function fmtAlt(ft) {
    if (ft == null) return "—";
    return `${Math.round(ft).toLocaleString()}FT`;
  }

  function fmtSpd(kts) {
    if (kts == null) return "—";
    return `${Math.round(kts)}KTS`;
  }

  function fmtHdg(deg) {
    if (deg == null) return "—";
    return `${Math.round(deg)}°`;
  }

  function offsetMeters(lat, lon, baseLat, baseLon) {
    const dLat = (lat - baseLat) * 110540;
    const dLon = (lon - baseLon) * 111320 * Math.cos((baseLat * Math.PI) / 180);
    return { x: dLon, y: dLat };
  }

  function toRadarPx(x, y) {
    const scale = RADAR_RADIUS_PX / RADAR_RANGE_M;
    return { px: x * scale, py: -y * scale };
  }

  function statusChip(status) {
    if (status === "CRITICAL") {
      return '<span class="bg-tertiary text-on-tertiary font-label-caps text-label-caps px-2 py-0.5 rounded">CRITICAL</span>';
    }
    if (status === "WARNING") {
      return '<span class="bg-tertiary-container text-on-tertiary-container font-label-caps text-label-caps px-2 py-0.5 rounded">WARNING</span>';
    }
    return '<span class="bg-surface-container-high text-on-surface-variant font-label-caps text-label-caps px-2 py-0.5 rounded">STABLE</span>';
  }

  function manifestCard(ac) {
    const critical = ac.status === "CRITICAL";
    const warning = ac.status === "WARNING";
    const border = critical
      ? "border-l-4 border-tertiary bg-tertiary-container/10 hover:bg-tertiary-container/20"
      : warning
        ? "border-l-4 border-tertiary-fixed-dim bg-tertiary-container/5 hover:bg-tertiary-container/10"
        : "border-l-4 border-transparent hover:bg-surface-container-high";
    const callsignClass = critical || warning ? "text-tertiary" : "text-primary";
    const callsign = escapeHtml(ac.callsign || ac.icao24);

    return `<div class="p-4 transition-all cursor-pointer ${border}" data-icao24="${escapeHtml(ac.icao24)}">
<div class="flex justify-between items-start mb-2">
<span class="font-telemetry-lg text-telemetry-lg ${callsignClass}">${callsign}</span>
${statusChip(ac.status)}
</div>
<div class="grid grid-cols-2 gap-2 text-on-surface-variant">
<div class="font-telemetry-sm text-telemetry-sm text-on-surface-variant">ALT: ${fmtAlt(ac.altitude_ft)}</div>
<div class="font-telemetry-sm text-telemetry-sm text-on-surface-variant">SPD: ${fmtSpd(ac.speed_kts)}</div>
<div class="font-telemetry-sm text-telemetry-sm text-on-surface-variant">DST: ${fmtDist(ac.distance_m)}</div>
<div class="font-telemetry-sm text-telemetry-sm text-on-surface-variant">HDG: ${fmtHdg(ac.heading)}</div>
</div>
</div>`;
  }

  function blipContentHtml(ac) {
    const critical = ac.status === "CRITICAL";
    const warning = ac.status === "WARNING";
    const heading = ac.heading != null ? Math.round(ac.heading) : 0;
    const callsign = escapeHtml(ac.callsign || ac.icao24);

    const labelBg = critical
      ? "text-tertiary bg-surface-container-highest border-tertiary/50"
      : warning
        ? "text-tertiary-fixed-dim bg-surface-container-high border-tertiary-fixed-dim/30"
        : "text-primary bg-surface-container-high border-primary/20";
    const iconClass = critical
      ? "text-tertiary drop-shadow-[0_0_8px_rgba(255,180,171,0.8)]"
      : warning
        ? "text-tertiary-fixed-dim opacity-90"
        : "text-primary opacity-80 group-hover:opacity-100 transition-opacity";
    const iconSize = critical ? "text-[32px]" : "text-[24px]";
    const path = critical
      ? `<div class="blip-path absolute top-1/2 left-1/2 w-48 h-px bg-gradient-to-r from-tertiary to-transparent origin-left opacity-50" style="transform: rotate(${((heading + 90) % 360)}deg)"></div>`
      : "";

    return `<div class="flex flex-col items-center">
<div class="font-telemetry-sm text-telemetry-sm ${labelBg} px-2 py-0.5 rounded mb-1 border blip-label">${callsign}</div>
<div class="${iconClass} blip-icon">
<span class="material-symbols-outlined ${iconSize} blip-flight-icon" style="transform: rotate(${heading}deg)">flight</span>
</div>
</div>
${path}`;
  }

  function smoothstep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  function motionDurationMs() {
    // Prefer the measured gap between real frames; fall back to configured.
    return state.measuredIntervalMs || state.updateIntervalMs || 60000;
  }

  function getTrackProgress(track, now) {
    const elapsed = now - track.startTime;
    // Each track animates over the interval that was current when it started,
    // so a later change in cadence never warps an in-flight animation.
    const dur = track.durationMs || motionDurationMs();
    return Math.min(1, elapsed / dur);
  }

  function getTrackPos(track, now) {
    const t = smoothstep(getTrackProgress(track, now));
    const x = track.fromX + (track.toX - track.fromX) * t;
    const y = track.fromY + (track.toY - track.fromY) * t;
    return toRadarPx(x, y);
  }

  function getTrackHeading(track, now) {
    const from = track.fromHeading ?? track.toHeading ?? 0;
    const to = track.toHeading ?? from;
    const delta = ((to - from + 540) % 360) - 180;
    const t = smoothstep(getTrackProgress(track, now));
    return (from + delta * t + 360) % 360;
  }

  function updateTrack(ac, now) {
    const { x, y } = offsetMeters(ac.lat, ac.lon, state.baseLat, state.baseLon);
    const prev = state.tracks.get(ac.icao24);
    let fromX = x;
    let fromY = y;

    if (prev) {
      const pos = getTrackPos(prev, now);
      const scale = RADAR_RADIUS_PX / RADAR_RANGE_M;
      fromX = pos.px / scale;
      fromY = -pos.py / scale;
    }

    const fromHeading = prev ? getTrackHeading(prev, now) : (ac.heading ?? 0);

    state.tracks.set(ac.icao24, {
      fromX,
      fromY,
      toX: x,
      toY: y,
      fromHeading,
      toHeading: ac.heading ?? fromHeading,
      startTime: now,
      durationMs: motionDurationMs(), // lock cadence at creation
      lastSeen: now,                  // for the drop-out grace window
      heading: ac.heading,
      speed_kts: ac.speed_kts || 0,
      status: ac.status,
      callsign: ac.callsign,
      icao24: ac.icao24,
      distance_m: ac.distance_m,
    });
  }

  function setBlipPosition(el, px, py) {
    el.style.left = `calc(50% + ${px}px)`;
    el.style.top = `calc(50% + ${py}px)`;
    el.style.transform = "translate(-50%, -50%)";
  }

  function syncRadarBlips(list) {
    const radarEl = $("#radar-aircraft");
    if (!radarEl) return;

    const now = performance.now();
    const visible = list.filter((ac) => ac.distance_m <= RADAR_RANGE_M);
    const activeIds = new Set(visible.map((ac) => ac.icao24));

    // Refresh / create blips for aircraft present in this frame.
    for (const ac of visible) {
      updateTrack(ac, now);
      let el = radarEl.querySelector(`[data-icao24="${ac.icao24}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "absolute group cursor-pointer pointer-events-auto";
        el.dataset.icao24 = ac.icao24;
        el.innerHTML = blipContentHtml(ac);
        radarEl.appendChild(el);
      } else if (el.dataset.status !== ac.status || el.dataset.heading !== String(ac.heading ?? "")) {
        el.dataset.status = ac.status;
        el.dataset.heading = String(ac.heading ?? "");
        el.innerHTML = blipContentHtml(ac);
      } else {
        const label = el.querySelector(".blip-label");
        const callsign = ac.callsign || ac.icao24;
        if (label && label.textContent !== callsign) label.textContent = callsign;
      }
    }

    // Drop-out grace: OpenSky intermittently omits an aircraft for a poll or
    // two. Keep its blip parked at the last known spot for ~1.5 intervals so a
    // brief gap doesn't make it vanish and teleport back when it reappears.
    const grace = motionDurationMs() * 1.5;
    for (const [id, track] of state.tracks) {
      if (activeIds.has(id)) continue;
      if (now - (track.lastSeen ?? 0) < grace) continue;
      state.tracks.delete(id);
      const el = radarEl.querySelector(`[data-icao24="${id}"]`);
      if (el) el.remove();
    }

    startMotionLoop();
  }

  function updateBlipPositions() {
    const radarEl = $("#radar-aircraft");
    if (!radarEl) return;

    const now = performance.now();
    for (const [icao24, track] of state.tracks) {
      const el = radarEl.querySelector(`[data-icao24="${icao24}"]`);
      if (!el) continue;
      const { px, py } = getTrackPos(track, now);
      setBlipPosition(el, px, py);
      const hdg = Math.round(getTrackHeading(track, now));
      const icon = el.querySelector(".blip-flight-icon");
      if (icon) icon.style.transform = `rotate(${hdg}deg)`;
      const path = el.querySelector(".blip-path");
      if (path) path.style.transform = `rotate(${((hdg + 90) % 360)}deg)`;
    }
  }

  function startMotionLoop() {
    if (state.rafId) return;
    const tick = () => {
      updateBlipPositions();
      if (state.tracks.size > 0) {
        state.rafId = requestAnimationFrame(tick);
      } else {
        state.rafId = null;
      }
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function logEntry(timestamp, message, tone) {
    const border =
      tone === "critical"
        ? "border-tertiary"
        : tone === "warning"
          ? "border-secondary"
          : tone === "primary"
            ? "border-primary"
            : "border-outline";
    const text =
      tone === "critical"
        ? "text-tertiary"
        : tone === "warning"
          ? "text-secondary"
          : tone === "primary"
            ? "text-primary"
            : "text-outline";
    return `<div class="border-l-2 ${border} pl-3 py-1">
<p class="font-telemetry-sm text-telemetry-sm ${text}">${escapeHtml(timestamp)} UTC</p>
<p class="font-body-base text-body-base text-on-surface">${escapeHtml(message)}</p>
</div>`;
  }

  function estimateEta(ac) {
    if (!ac.speed_kts || ac.speed_kts <= 0) return null;
    const speedMps = ac.speed_kts * 0.514444;
    const seconds = ac.distance_m / speedMps;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) return null;
    return seconds;
  }

  function fmtTimer(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const state = {
    baseLat: 51.5074,
    baseLon: -0.1278,
    proximityRadius: 5000,
    updateIntervalMs: 60000,
    aircraft: [],
    filter: "",
    log: [],
    seen: new Map(),
    tracks: new Map(),
    ws: null,
    reconnectDelay: 2000,
    rafId: null,
    lastFeedMsg: null,
    lastFeedStatus: "ok",     // for one-shot feed-fault audio
    lastFrameTime: null,      // performance.now() of the previous frame
    measuredIntervalMs: null, // smoothed real gap between frames
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function playAudio(type) {
    if (window.SkyWatchAudio) window.SkyWatchAudio.play(type);
  }

  function addLog(message, tone, timestamp) {
    const ts = timestamp || new Date().toISOString().slice(11, 19);
    const key = `${ts}:${message}`;
    if (state.log.some((e) => e.key === key)) return;
    state.log.unshift({ key, ts, message, tone });
    if (state.log.length > 12) state.log.pop();
  }

  function trackEvents(frame) {
    const ts = frame.timestamp;

    for (const ac of frame.aircraft) {
      const inPanel = ac.distance_m <= PANEL_RADIUS_M;
      const prev = state.seen.get(ac.icao24);

      if (!inPanel) {
        if (prev) state.seen.delete(ac.icao24);
        continue;
      }

      if (!prev) {
        addLog(`${ac.callsign} contact established`, "primary", ts);
        // First sighting already inside CRITICAL/WARNING — still worth a tone.
        if (ac.status === "CRITICAL") playAudio("proximity");
        else if (ac.status === "WARNING") playAudio("collision");
      } else if (prev.status !== ac.status) {
        if (ac.status === "CRITICAL") {
          addLog(`WARNING: ${ac.callsign} distance threshold ${Math.round(frame.proximity_radius_m)}m breached`, "critical", ts);
          playAudio("proximity");
        } else if (ac.status === "WARNING") {
          addLog(`${ac.callsign} entered advisory range (${fmtDist(ac.distance_m)})`, "warning", ts);
          playAudio("collision");
        }
      }
      state.seen.set(ac.icao24, { status: ac.status, distance: ac.distance_m });
    }
  }

  function filteredAircraft() {
    const q = state.filter.trim().toLowerCase();
    if (!q) return state.aircraft;
    return state.aircraft.filter(
      (ac) =>
        (ac.callsign || "").toLowerCase().includes(q) ||
        (ac.icao24 || "").toLowerCase().includes(q)
    );
  }

  function manifestAircraft() {
    return filteredAircraft().filter((ac) => ac.distance_m <= PANEL_RADIUS_M);
  }

  function render() {
    const list = filteredAircraft();
    const manifest = manifestAircraft();
    const manifestEl = $("#manifest-list");
    const logEl = $("#telemetry-log");

    if (manifestEl) {
      manifestEl.innerHTML =
        manifest.length > 0
          ? manifest.map(manifestCard).join("")
          : '<div class="p-4 text-on-surface-variant font-telemetry-sm text-telemetry-sm">No aircraft in range</div>';
    }

    syncRadarBlips(list);

    const closest = state.aircraft[0] || null;
    const closestEl = $("#closest-contact");
    const separationEl = $("#separation");
    const barEl = $("#proximity-bar");
    const timerEl = $("#timer");
    const ringPing = $("#proximity-ring-ping");

    if (closest) {
      if (closestEl) closestEl.textContent = closest.callsign || closest.icao24;
      if (separationEl) separationEl.textContent = `${closest.distance_m.toFixed(1)}M`;
      if (barEl && state.proximityRadius > 0) {
        const pct = Math.min(100, (1 - closest.distance_m / state.proximityRadius) * 100);
        barEl.style.width = `${Math.max(8, pct)}%`;
      }
      if (timerEl) {
        const eta = estimateEta(closest);
        timerEl.textContent = eta ? fmtTimer(eta) : "—";
      }
    } else {
      if (closestEl) closestEl.textContent = "—";
      if (separationEl) separationEl.textContent = "—";
      if (barEl) barEl.style.width = "0%";
      if (timerEl) timerEl.textContent = "—";
    }

    if (ringPing) {
      ringPing.classList.toggle("hidden", !state.aircraft.some((a) => a.status === "CRITICAL"));
    }

    if (logEl) {
      logEl.innerHTML =
        state.log.length > 0
          ? state.log.map((e) => logEntry(e.ts, e.message, e.tone)).join("")
          : '<div class="font-telemetry-sm text-telemetry-sm text-on-surface-variant">Awaiting telemetry…</div>';
    }
  }

  function feedStatusMessage(frame) {
    if (frame.feed_status === "rate_limited") {
      return `OpenSky rate limited — retry in ${frame.retry_after_s || "?"}s`;
    }
    if (frame.feed_status === "stale") {
      return `Cached feed — refresh in ${frame.retry_after_s || "?"}s`;
    }
    if (frame.feed_status === "error") {
      return "Feed error — showing last known data";
    }
    return null;
  }

  function applyFrame(frame) {
    // Measure the true gap between frames (network + fetch + OpenSky lag), and
    // smooth it so one late frame doesn't warp the next animation. This becomes
    // the interpolation duration so a blip reaches its target right as the next
    // frame lands — no early-finish-then-sit, no overshoot snap.
    const nowPerf = performance.now();
    if (state.lastFrameTime != null) {
      const dt = nowPerf - state.lastFrameTime;
      const prev = state.measuredIntervalMs ?? dt;
      state.measuredIntervalMs = clamp(prev * 0.6 + dt * 0.4, 10000, 240000);
    }
    state.lastFrameTime = nowPerf;

    state.baseLat = frame.base_lat;
    state.baseLon = frame.base_lon;
    state.proximityRadius = frame.proximity_radius_m;
    if (frame.update_interval_ms) state.updateIntervalMs = frame.update_interval_ms;
    state.aircraft = (frame.aircraft || []).slice().sort((a, b) => a.distance_m - b.distance_m);

    const feedMsg = feedStatusMessage(frame);
    if (feedMsg && state.lastFeedMsg !== feedMsg) {
      state.lastFeedMsg = feedMsg;
      addLog(feedMsg, frame.feed_status === "rate_limited" ? "warning" : "outline", frame.timestamp);
    } else if (frame.feed_status === "ok") {
      state.lastFeedMsg = null;
    }

    // Feed-fault tone: fire once on transition into a faulted state.
    const faulted = frame.feed_status === "error" || frame.feed_status === "rate_limited";
    const wasFaulted = state.lastFeedStatus === "error" || state.lastFeedStatus === "rate_limited";
    if (faulted && !wasFaulted) playAudio("overload");
    state.lastFeedStatus = frame.feed_status;

    const coords = fmtCoord(frame.base_lat, frame.base_lon);
    const headerCoords = $("#header-coords");
    const hudCoords = $("#hud-coords");
    if (headerCoords) headerCoords.textContent = coords;
    if (hudCoords) hudCoords.textContent = coords;

    trackEvents(frame);
    render();
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/alerts/config`);
      if (!res.ok) return;
      const cfg = await res.json();
      state.baseLat = cfg.base_lat;
      state.baseLon = cfg.base_lon;
      state.proximityRadius = cfg.proximity_radius_m;
      state.updateIntervalMs = cfg.update_interval_ms || 60000;
      const coords = fmtCoord(cfg.base_lat, cfg.base_lon);
      const headerCoords = $("#header-coords");
      const hudCoords = $("#hud-coords");
      if (headerCoords) headerCoords.textContent = coords;
      if (hudCoords) hudCoords.textContent = coords;
    } catch (_) {
      addLog("Config unavailable — using defaults", "outline");
      render();
    }
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
      addLog("Radar feed connected", "primary");
      render();
    };

    ws.onmessage = (event) => {
      try {
        applyFrame(JSON.parse(event.data));
      } catch (e) {
        console.error("Radar frame parse error", e);
      }
    };

    ws.onclose = () => {
      addLog("Radar feed disconnected — retrying…", "warning");
      render();
      // Reuse cached location — no need to re-request geolocation on every reconnect
      setTimeout(() => openWs(state.baseLat, state.baseLon), state.reconnectDelay);
    };

    ws.onerror = () => ws.close();
  }

  function connect() {
    addLog("Acquiring location…", "outline");
    render();

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.baseLat = pos.coords.latitude;
        state.baseLon = pos.coords.longitude;
        openWs(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        const msgs = {
          1: "Location access denied — using default coordinates",
          2: "Location unavailable — using default coordinates",
          3: "Location request timed out — using default coordinates",
        };
        addLog(msgs[err.code] || "Geolocation failed — using default coordinates", "warning");
        render();
        openWs(state.baseLat, state.baseLon);
      },
      { maximumAge: 0, timeout: 10000, enableHighAccuracy: true }
    );
  }

  function openManifest(icao24) {
    if (!icao24) return;
    window.location.href = `manifest.html?icao24=${encodeURIComponent(icao24)}`;
  }

  function init() {
    const filter = $("#filter-input");
    if (filter) {
      filter.addEventListener("input", (e) => {
        state.filter = e.target.value;
        render();
      });
    }

    const manifestEl = $("#manifest-list");
    if (manifestEl) {
      manifestEl.addEventListener("click", (e) => {
        const card = e.target.closest("[data-icao24]");
        if (card) openManifest(card.dataset.icao24);
      });
    }

    const radarEl = $("#radar-aircraft");
    if (radarEl) {
      radarEl.addEventListener("click", (e) => {
        const blip = e.target.closest("[data-icao24]");
        if (blip) openManifest(blip.dataset.icao24);
      });
    }

    addLog("Radar sweep calibration complete", "outline");
    loadConfig().then(connect);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
