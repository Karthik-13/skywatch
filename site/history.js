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
    // iso is "YYYY-MM-DD HH:MM:SS" UTC from SQLite
    return iso.slice(11, 19) + " UTC";
  }

  function fmtDuration(firstSeen, lastSeen) {
    if (!firstSeen || !lastSeen) return "—";
    const a = new Date(firstSeen.replace(" ", "T") + "Z");
    const b = new Date(lastSeen.replace(" ", "T") + "Z");
    const secs = Math.round((b - a) / 1000);
    if (secs < 0) return "—";
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  }

  function avgDuration(records) {
    if (!records.length) return "—";
    let total = 0;
    let count = 0;
    for (const r of records) {
      if (!r.first_seen || !r.last_seen) continue;
      const a = new Date(r.first_seen.replace(" ", "T") + "Z");
      const b = new Date(r.last_seen.replace(" ", "T") + "Z");
      const secs = Math.round((b - a) / 1000);
      if (secs >= 0) { total += secs; count++; }
    }
    if (!count) return "—";
    const avg = Math.round(total / count);
    const m = Math.floor(avg / 60);
    const s = avg % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  }

  function statusBadge(status) {
    if (status === "CRITICAL") {
      return `<span class="bg-error-container text-on-error-container px-2 py-1 rounded font-label-caps text-label-caps">CRITICAL</span>`;
    }
    if (status === "WARNING") {
      return `<span class="bg-tertiary-container text-on-tertiary-container px-2 py-1 rounded font-label-caps text-label-caps">WARNING</span>`;
    }
    return `<span class="bg-secondary-container text-on-secondary-container px-2 py-1 rounded font-label-caps text-label-caps">STABLE</span>`;
  }

  function iconForStatus(status) {
    if (status === "CRITICAL") return "text-error";
    if (status === "WARNING") return "text-tertiary-fixed-dim";
    return "text-on-surface-variant";
  }

  function renderStats(records, stats) {
    const totalEl = $("#stat-total");
    const avgEl = $("#stat-avg-duration");
    const lastAlertEl = $("#stat-last-alert");
    const countEl = $("#stat-count-label");

    if (totalEl) totalEl.textContent = (stats.total_detections || 0).toLocaleString();
    if (avgEl) avgEl.textContent = avgDuration(records);
    if (lastAlertEl) {
      if (stats.last_detection) {
        lastAlertEl.textContent = fmtTime(stats.last_detection);
      } else {
        lastAlertEl.textContent = "No detections yet";
      }
    }
    if (countEl) {
      countEl.textContent = `Showing ${records.length} of ${(stats.total_detections || 0).toLocaleString()} telemetry records`;
    }
  }

  function renderTable(records) {
    const tbody = $("#history-tbody");
    if (!tbody) return;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center font-telemetry-sm text-telemetry-sm text-on-surface-variant">No records found</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map((r) => {
      const rowId = `row-${r.id}`;
      return `
<tr class="expandable-row group" data-expanded="false" data-row-id="${escapeHtml(String(r.id))}" onclick="toggleRow(this)">
  <td class="px-6 py-5 text-on-surface">${escapeHtml(fmtTime(r.last_seen))}</td>
  <td class="px-6 py-5">
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined ${iconForStatus(r.status)} text-[18px]">flight</span>
      <span class="font-telemetry-sm text-telemetry-sm text-on-surface group-hover:text-primary transition-colors">${escapeHtml(r.callsign)}</span>
    </div>
  </td>
  <td class="px-6 py-5 font-telemetry-sm text-telemetry-sm text-on-surface">${escapeHtml(fmtDist(r.min_distance_m))}</td>
  <td class="px-6 py-5 text-on-surface-variant">${escapeHtml(fmtDuration(r.first_seen, r.last_seen))}</td>
  <td class="px-6 py-5">${statusBadge(r.status)}</td>
</tr>
<tr id="${escapeHtml(rowId)}">
  <td class="p-0" colspan="5">
    <div class="expanded-content bg-surface-container/30 px-6">
      <div class="py-6 grid grid-cols-2 gap-8">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="font-label-caps text-label-caps text-on-surface-variant uppercase">ICAO24</p>
              <p class="font-telemetry-sm text-telemetry-sm text-primary">${escapeHtml(r.icao24.toUpperCase())}</p>
            </div>
            <div>
              <p class="font-label-caps text-label-caps text-on-surface-variant uppercase">CALLSIGN</p>
              <p class="font-telemetry-sm text-telemetry-sm text-primary">${escapeHtml(r.callsign)}</p>
            </div>
            <div>
              <p class="font-label-caps text-label-caps text-on-surface-variant uppercase">MAX ALTITUDE</p>
              <p class="font-telemetry-sm text-telemetry-sm text-primary">${escapeHtml(fmtAlt(r.max_altitude_ft))}</p>
            </div>
            <div>
              <p class="font-label-caps text-label-caps text-on-surface-variant uppercase">MIN DISTANCE</p>
              <p class="font-telemetry-sm text-telemetry-sm text-primary">${escapeHtml(fmtDist(r.min_distance_m))}</p>
            </div>
            <div>
              <p class="font-label-caps text-label-caps text-on-surface-variant uppercase">FIRST SEEN</p>
              <p class="font-telemetry-sm text-telemetry-sm text-on-surface">${escapeHtml(fmtTime(r.first_seen))}</p>
            </div>
            <div>
              <p class="font-label-caps text-label-caps text-on-surface-variant uppercase">LAST SEEN</p>
              <p class="font-telemetry-sm text-telemetry-sm text-on-surface">${escapeHtml(fmtTime(r.last_seen))}</p>
            </div>
          </div>
          <a href="manifest.html?icao24=${escapeHtml(r.icao24)}" class="inline-block font-label-caps text-label-caps text-primary border-b border-primary/40 hover:border-primary pb-0.5 transition-all">VIEW IN MANIFEST →</a>
        </div>
      </div>
    </div>
  </td>
</tr>`;
    }).join("");
  }

  function exportData(records, format) {
    if (format === "csv") {
      const header = "icao24,callsign,first_seen,last_seen,min_distance_m,max_altitude_ft,status";
      const rows = records.map((r) =>
        [r.icao24, r.callsign, r.first_seen, r.last_seen, r.min_distance_m, r.max_altitude_ft ?? "", r.status].join(",")
      );
      download("skywatch-history.csv", "text/csv", [header, ...rows].join("\n"));
    } else {
      download("skywatch-history.json", "application/json", JSON.stringify(records, null, 2));
    }
  }

  function download(filename, type, content) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const state = {
    records: [],   // last server-loaded set (status filter is server-side)
    stats: {},
    filter: null,
    search: "",    // client-side, callsign/ICAO
    dateFrom: "",  // client-side, YYYY-MM-DD
    dateTo: "",
  };

  function dateKey(iso) {
    // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"
    return iso ? iso.slice(0, 10) : "";
  }

  // Client-side search + date filtering over the already-loaded records.
  function visibleRecords() {
    let recs = state.records;

    const q = state.search.trim().toLowerCase();
    if (q) {
      recs = recs.filter(
        (r) =>
          (r.callsign || "").toLowerCase().includes(q) ||
          (r.icao24 || "").toLowerCase().includes(q)
      );
    }
    if (state.dateFrom) recs = recs.filter((r) => dateKey(r.last_seen) >= state.dateFrom);
    if (state.dateTo) recs = recs.filter((r) => dateKey(r.last_seen) <= state.dateTo);

    return recs;
  }

  function renderView() {
    const recs = visibleRecords();
    renderStats(recs, state.stats);
    renderTable(recs);
  }

  async function load(statusFilter) {
    state.filter = statusFilter || null;
    const url = new URL(`${API_BASE}/api/history`);
    url.searchParams.set("limit", "100");
    if (statusFilter) url.searchParams.set("status", statusFilter);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.records = data.records || [];
      state.stats = data.stats || {};
    } catch (e) {
      console.error("History fetch failed", e);
      state.records = [];
      state.stats = {};
    }

    renderView();
    updateFilterButtons(statusFilter);
  }

  function updateFilterButtons(active) {
    const allBtn = $("#filter-all");
    const alertBtn = $("#filter-alerts");
    const activeClass = "bg-primary-container text-on-primary-container";
    const inactiveClass = "text-on-surface-variant hover:text-primary";
    if (allBtn) {
      allBtn.className = allBtn.className.replace(activeClass, "").replace(inactiveClass, "").trim();
      allBtn.classList.add(...(active ? inactiveClass.split(" ") : activeClass.split(" ")));
    }
    if (alertBtn) {
      alertBtn.className = alertBtn.className.replace(activeClass, "").replace(inactiveClass, "").trim();
      alertBtn.classList.add(...(active ? activeClass.split(" ") : inactiveClass.split(" ")));
    }
  }

  function init() {
    // toggleRow is used inline in HTML onclick — keep it on window
    window.toggleRow = function (element) {
      const isExpanded = element.getAttribute("data-expanded") === "true";
      document.querySelectorAll(".expandable-row").forEach((row) => {
        row.setAttribute("data-expanded", "false");
      });
      if (!isExpanded) element.setAttribute("data-expanded", "true");
    };

    const allBtn = $("#filter-all");
    const alertBtn = $("#filter-alerts");
    if (allBtn) allBtn.addEventListener("click", () => load(null));
    if (alertBtn) alertBtn.addEventListener("click", () => load("CRITICAL"));

    const csvBtn = $("#export-csv");
    const jsonBtn = $("#export-json");
    if (csvBtn) csvBtn.addEventListener("click", () => exportData(visibleRecords(), "csv"));
    if (jsonBtn) jsonBtn.addEventListener("click", () => exportData(visibleRecords(), "json"));

    const searchInput = $("#search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.search = e.target.value;
        renderView();
      });
    }

    const dateFrom = $("#date-from");
    const dateTo = $("#date-to");
    const dateClear = $("#date-clear");
    if (dateFrom) {
      dateFrom.addEventListener("change", (e) => {
        state.dateFrom = e.target.value;
        renderView();
      });
    }
    if (dateTo) {
      dateTo.addEventListener("change", (e) => {
        state.dateTo = e.target.value;
        renderView();
      });
    }
    if (dateClear) {
      dateClear.addEventListener("click", () => {
        state.dateFrom = "";
        state.dateTo = "";
        if (dateFrom) dateFrom.value = "";
        if (dateTo) dateTo.value = "";
        renderView();
      });
    }

    load(null);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
