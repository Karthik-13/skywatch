(function () {
  "use strict";

  const API_BASE =
    window.SKYWATCH_API ||
    `${window.location.protocol}//${window.location.hostname}:8000`;

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDist(m) {
    if (m == null) return "—";
    if (m < 1000) return `${Math.round(m)}m`;
    return `${(m / 1000).toFixed(1)}km`;
  }

  function fmtAlt(ft) {
    if (ft == null) return "—";
    return `${Math.round(ft).toLocaleString()} FT`;
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    return iso.slice(11, 19) + " UTC";
  }

  function statusBadge(status) {
    if (status === "CRITICAL") {
      return `<span class="px-2 py-1 rounded bg-error-container/20 text-error font-label-caps text-label-caps border border-error/20">BREACH</span>`;
    }
    if (status === "WARNING") {
      return `<span class="px-2 py-1 rounded bg-tertiary-container/20 text-tertiary-fixed-dim font-label-caps text-label-caps border border-tertiary-fixed-dim/20">ADVISORY</span>`;
    }
    return `<span class="px-2 py-1 rounded bg-secondary-container/10 text-secondary-fixed font-label-caps text-label-caps border border-secondary-fixed/20">NOMINAL</span>`;
  }

  const state = { config: null, saving: false };

  function fmtCoord(lat, lon) {
    const latDir = lat >= 0 ? "N" : "S";
    const lonDir = lon >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
  }

  // Update both coordinate displays (header chip + map BASE_SIG).
  function displayCoords(lat, lon) {
    const coordStr = fmtCoord(lat, lon);
    const coordsEl = $("#base-coords");
    const baseLatEl = $("#base-lat");
    if (coordsEl) coordsEl.textContent = coordStr;
    if (baseLatEl) baseLatEl.textContent = `BASE_SIG: ${coordStr}`;
  }

  // Match the radar/manifest: show the user's live location, not the stored
  // config default. On success we also stage it into state.config so SAVE
  // CONFIG persists this as the fallback home base.
  function requestLiveLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        displayCoords(lat, lon);
        if (state.config) {
          state.config.base_lat = lat;
          state.config.base_lon = lon;
        }
      },
      () => {
        /* denied/unavailable — keep the config coords already shown */
      },
      { maximumAge: 0, timeout: 10000, enableHighAccuracy: true }
    );
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/alerts/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.config = await res.json();
    } catch (e) {
      console.error("Config fetch failed", e);
      return;
    }

    const proxSlider = $("#proximity-slider");
    const proxVal = $("#proximity-val");
    const intervalSlider = $("#interval-slider");
    const intervalVal = $("#interval-val");

    const cfg = state.config;

    if (proxSlider) proxSlider.value = cfg.proximity_radius_m;
    if (proxVal) proxVal.textContent = `${Math.round(cfg.proximity_radius_m)}m`;

    // interval stored as ms, slider shows seconds
    const intervalSec = Math.round(cfg.update_interval_ms / 1000);
    if (intervalSlider) intervalSlider.value = intervalSec;
    if (intervalVal) intervalVal.textContent = `${intervalSec}s`;

    // Show config coords immediately, then override with live location.
    displayCoords(cfg.base_lat, cfg.base_lon);
    requestLiveLocation();
  }

  async function saveConfig() {
    if (state.saving || !state.config) return;
    state.saving = true;

    const proxSlider = $("#proximity-slider");
    const intervalSlider = $("#interval-slider");
    const saveBtn = $("#save-btn");
    const saveStatus = $("#save-status");

    const payload = {
      proximity_radius_m: proxSlider ? parseFloat(proxSlider.value) : state.config.proximity_radius_m,
      update_interval_ms: intervalSlider ? parseInt(intervalSlider.value, 10) * 1000 : state.config.update_interval_ms,
      base_lat: state.config.base_lat,
      base_lon: state.config.base_lon,
    };

    if (saveBtn) saveBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/alerts/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.config = await res.json();
      if (saveStatus) {
        saveStatus.textContent = "Saved";
        saveStatus.className = "font-telemetry-sm text-telemetry-sm text-secondary";
        setTimeout(() => { if (saveStatus) saveStatus.textContent = ""; }, 3000);
      }
    } catch (e) {
      console.error("Config save failed", e);
      if (saveStatus) {
        saveStatus.textContent = "Save failed";
        saveStatus.className = "font-telemetry-sm text-telemetry-sm text-error";
        setTimeout(() => { if (saveStatus) saveStatus.textContent = ""; }, 4000);
      }
    } finally {
      state.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function loadIncidentLog() {
    const tbody = $("#incident-tbody");
    if (!tbody) return;

    try {
      const res = await fetch(`${API_BASE}/api/history?limit=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const records = (data.records || []).filter((r) => r.status === "CRITICAL" || r.status === "WARNING");

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center font-telemetry-sm text-telemetry-sm text-on-surface-variant">No proximity incidents recorded</td></tr>`;
        return;
      }

      tbody.innerHTML = records.map((r) => `
<tr class="group hover:bg-surface-variant/10 transition-colors">
  <td class="py-4 font-telemetry-sm text-telemetry-sm">${escapeHtml(fmtTime(r.last_seen))}</td>
  <td class="py-4">
    <div class="flex items-center gap-2">
      <span class="font-telemetry-lg text-telemetry-lg text-on-surface">${escapeHtml(r.callsign)}</span>
      <span class="font-label-caps text-label-caps bg-surface-variant px-1.5 py-0.5 rounded text-on-surface-variant">${escapeHtml(r.icao24.toUpperCase())}</span>
    </div>
  </td>
  <td class="py-4 font-telemetry-lg text-telemetry-lg text-primary-container">${escapeHtml(fmtDist(r.min_distance_m))}</td>
  <td class="py-4 font-telemetry-sm text-telemetry-sm">${escapeHtml(fmtAlt(r.max_altitude_ft))}</td>
  <td class="py-4">${statusBadge(r.status)}</td>
</tr>`).join("");
    } catch (e) {
      console.error("Incident log fetch failed", e);
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center font-telemetry-sm text-telemetry-sm text-error">Failed to load incident log</td></tr>`;
    }
  }

  function wireSliders() {
    const proxSlider = $("#proximity-slider");
    const proxVal = $("#proximity-val");
    const intervalSlider = $("#interval-slider");
    const intervalVal = $("#interval-val");

    if (proxSlider && proxVal) {
      proxSlider.addEventListener("input", () => {
        proxVal.textContent = `${proxSlider.value}m`;
      });
    }
    if (intervalSlider && intervalVal) {
      intervalSlider.addEventListener("input", () => {
        intervalVal.textContent = `${intervalSlider.value}s`;
      });
    }

    const saveBtn = $("#save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveConfig);
  }

  function wireAudioToggles() {
    const audio = window.SkyWatchAudio;
    if (!audio) return;

    const map = {
      proximity: $("#audio-proximity"),
      collision: $("#audio-collision"),
      overload: $("#audio-overload"),
    };

    for (const [type, el] of Object.entries(map)) {
      if (!el) continue;
      // Reflect saved state on load
      el.checked = audio.isEnabled(type);
      el.addEventListener("change", () => {
        audio.setEnabled(type, el.checked);
        // Immediate feedback (and primes audio) when switched on
        if (el.checked) audio.preview(type);
      });
    }
  }

  function init() {
    wireSliders();
    wireAudioToggles();
    loadConfig();
    loadIncidentLog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
