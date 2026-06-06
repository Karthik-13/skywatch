/* ============================================================
   SkyWatch — screen builders, navigation & live wiring
   ============================================================ */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const W = () => SW.World;

  // ---------- helpers ----------
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const fmtKt = (v) => Math.round(v).toLocaleString();
  const fmtFt = (v) => Math.round(v).toLocaleString();
  const fmtDist = (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km");
  const fmtHdg = (d) => pad(Math.round(d) % 360, 3) + "°";
  const fmtDur = (s) => Math.floor(s / 60) + "m " + pad(Math.round(s % 60)) + "s";

  function placeholder(label, sub) {
    return `<div style="position:relative;width:100%;height:100%;background:
        repeating-linear-gradient(135deg,rgba(120,150,160,.05) 0 8px,transparent 8px 16px),var(--inset);
        border:1px solid var(--line);display:grid;place-items:center;text-align:center;">
      <div>
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--text-mute);text-transform:uppercase;">${label}</div>
        ${sub ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-mute);opacity:.7;margin-top:5px;">${sub}</div>` : ""}
      </div></div>`;
  }
  function ico(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }
  const ICONS = {
    radar: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 19 8"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
    plane: `<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>`,
    history: `<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>`,
    sliders: `<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>`,
    alert: `<path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>`,
    target: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`,
    gauge: `<path d="M12 14 16 9"/><path d="M4 18a8 8 0 1 1 16 0"/><circle cx="12" cy="14" r="1.3" fill="currentColor"/>`,
    bell: `<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7"/><path d="M10.5 20a1.5 1.5 0 0 0 3 0"/>`,
  };

  // ================================================================
  // SHELL: clocks + nav
  // ================================================================
  function startClocks() {
    const utc = $("#clk-utc"), loc = $("#clk-local"), z = $("#clk-z");
    function tick() {
      const d = new Date();
      const u = (n) => pad(n);
      if (utc) utc.textContent = `${u(d.getUTCHours())}:${u(d.getUTCMinutes())}:${u(d.getUTCSeconds())}`;
      if (loc) loc.textContent = `${u(d.getHours())}:${u(d.getMinutes())}:${u(d.getSeconds())}`;
      if (z) z.textContent = `${u(d.getUTCHours())}${u(d.getUTCMinutes())}Z`;
    }
    tick(); setInterval(tick, 1000);
  }

  const PAGES = {
    dashboard: { crumb: "OPS / LIVE", title: "Live Radar Dashboard" },
    telemetry: { crumb: "OPS / CONTACT", title: "Flight Telemetry" },
    history: { crumb: "RECORDS / LOG", title: "Flyover History" },
    calibration: { crumb: "SYSTEM / CONFIG", title: "Alerts & Calibration" },
  };
  function nav(to) {
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.go === to));
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + to));
    $("#pg-crumb").textContent = PAGES[to].crumb;
    $("#pg-title").textContent = PAGES[to].title;
  }

  // ================================================================
  // DASHBOARD
  // ================================================================
  let dashFeed, dashContacts;
  function buildDashboard() {
    const el = $("#screen-dashboard .screen-pad");
    el.innerHTML = `
      <div class="statstrip" style="margin-bottom:18px;">
        <div class="cell cy stat"><div class="s-k">Contacts In Zone</div><div class="s-v" id="st-count">0</div><div class="sub">WITHIN 2.0 KM RADIUS</div></div>
        <div class="cell warn stat" id="st-breach-cell"><div class="s-k">Proximity Breaches</div><div class="s-v" id="st-breach">0</div><div class="sub" id="st-breach-sub">100 M ALERT ZONE</div></div>
        <div class="cell stat"><div class="s-k">Closest Contact</div><div class="s-v" id="st-closest">—</div><div class="sub" id="st-closest-cs">—</div></div>
        <div class="cell stat"><div class="s-k">Tracking Uptime</div><div class="s-v" id="st-uptime">00:00</div><div class="sub">FEED NOMINAL · 1.0 HZ</div></div>
      </div>
      <div class="dash">
        <div class="dash-left">
          <div class="panel ticked glow radar-panel">
            <div class="panel-head">
              <span class="h-ico">${ico(ICONS.radar)}</span>
              <span class="h-title">PPI Scope — Sector 7G</span>
              <span class="h-meta" id="radar-range">RANGE 2.0 KM · N-UP</span>
            </div>
            <div class="radar-stage">
              <div class="breach-callout" id="breach-callout">
                <span class="bc-ico">${ico(ICONS.alert)}</span>
                <span class="bc-txt" id="breach-text">PROXIMITY BREACH</span>
              </div>
              <div class="radar-wrap">
                <canvas id="radar-main"></canvas>
                <div class="radar-hud">
                  <div class="corner tl">LAT <span class="b">47.6062°N</span><br>LON <span class="b">122.3321°W</span></div>
                  <div class="corner tr">MODE <span class="b">ACTIVE</span><br>GAIN <span class="b">AUTO</span></div>
                  <div class="corner bl">SWEEP <span class="b" id="hud-sweep">33 RPM</span></div>
                  <div class="corner br">ELEV 0–10K FT<br>FILTER <span class="b">ALL</span></div>
                </div>
              </div>
            </div>
            <div class="radar-foot">
              <div class="item"><span class="swatch tri"></span> TRACKED</div>
              <div class="item"><span class="swatch tri or"></span> IN BREACH ZONE</div>
              <div class="item" style="color:var(--text-faint)"><span class="swatch" style="border-style:dashed;color:rgba(255,122,24,.5)"></span> 100 M PERIMETER</div>
              <div class="sep"></div>
              <div class="item" id="foot-clock">— ZULU</div>
            </div>
          </div>
        </div>
        <div class="dash-right">
          <div class="panel ticked feed">
            <div class="panel-head">
              <span class="h-ico" style="color:var(--orange)">${ico(ICONS.alert)}</span>
              <span class="h-title">Tactical Feed</span>
              <span class="h-meta"><span class="badge or"><span class="b-dot"></span>LIVE</span></span>
            </div>
            <div class="feed-list" id="feed-list"></div>
          </div>
          <div class="panel ticked">
            <div class="panel-head">
              <span class="h-ico">${ico(ICONS.plane)}</span>
              <span class="h-title">Active Contacts</span>
              <span class="h-meta" id="contacts-count">—</span>
            </div>
            <div id="contact-list"></div>
          </div>
        </div>
      </div>`;

    // radar instance
    dashRadar = new SW.Radar($("#radar-main"), {
      range: 2000, rings: [100, 500, 1000, 1500, 2000], proxRing: 100,
      sweepSpeed: 0.55, labels: true, bearings: true, trails: true,
    });
    dashFeed = $("#feed-list");
    dashContacts = $("#contact-list");
    seedFeed();
    renderContacts();
  }

  // tactical feed event log
  const feedEvents = [];
  function pushFeed(ev) {
    feedEvents.unshift(ev);
    if (feedEvents.length > 14) feedEvents.pop();
    if (!dashFeed) return;
    dashFeed.innerHTML = feedEvents.map((e) => `
      <div class="feed-item ${e.kind || ""}">
        <div class="ts">${e.ts}</div>
        <div class="body"><div class="ln1">${e.l1}</div><div class="ln2">${e.l2}</div></div>
      </div>`).join("");
  }
  function zulu(off = 0) {
    const d = new Date(Date.now() - off * 1000);
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  function seedFeed() {
    const seeds = [
      { kind: "alert", l1: `<span class="cs">N172SW</span> BREACH · 72 M`, l2: "C172 · INTERCEPT T-00:14 · ALT 1,100 FT" },
      { kind: "entry", l1: `<span class="cs">QXE2280</span> entered zone`, l2: "E175 · BRG 110° · 1.25 km" },
      { kind: "", l1: `<span class="cs">DAL2210</span> climbing`, l2: "B738 · +1,100 fpm · passing 9,900 ft" },
      { kind: "entry", l1: `<span class="cs">LIFEGUARD</span> entered zone`, l2: "H135 · MEDEVAC · BRG 020°" },
      { kind: "", l1: `<span class="cs">ASA1422</span> descending`, l2: "A320 · −640 fpm · BRG 327°" },
      { kind: "", l1: `<span class="cs">SKW5519</span> departed zone`, l2: "CRJ9 · BRG 244° · 1.86 km" },
    ];
    seeds.forEach((s, i) => pushFeed({ ...s, ts: zulu(i * 22 + 4) }));
  }

  function renderContacts() {
    if (!dashContacts) return;
    const cs = [...W().contacts].sort((a, b) => a.dist - b.dist);
    $("#contacts-count").textContent = cs.length + " TRACKED";
    dashContacts.innerHTML = cs.map((c) => `
      <div class="contact-row ${c.breaching ? "warn" : ""}" data-cs="${c.callsign}">
        <div class="tag">${c.type}</div>
        <div>
          <div class="cs">${c.callsign}</div>
          <div class="meta">${SW.typeClass(c.type)} · BRG ${fmtHdg(c.bearing)}</div>
        </div>
        <div class="dist"><div class="d">${fmtDist(c.dist)}</div><div class="a">${fmtFt(c.alt)} FT</div></div>
      </div>`).join("");
    $$(".contact-row", dashContacts).forEach((r) =>
      r.addEventListener("click", () => { focusContact(r.dataset.cs); nav("telemetry"); }));
  }

  // ================================================================
  // TELEMETRY
  // ================================================================
  let focusCS = "ASA1422";
  const telHist = { alt: [], gs: [] };
  function focusContact(cs) { focusCS = cs; telHist.alt = []; telHist.gs = []; buildTelemetry(); }

  const ROUTES = {
    ASA1422: { orig: "KSEA", orign: "Seattle–Tacoma", dest: "KSFO", destn: "San Francisco", et: "01:42" },
    QXE2280: { orig: "KPDX", orign: "Portland", dest: "KSEA", destn: "Seattle–Tacoma", et: "00:31" },
    DAL2210: { orig: "KSEA", orign: "Seattle–Tacoma", dest: "KSLC", destn: "Salt Lake City", et: "01:58" },
    N172SW: { orig: "KBFI", orign: "Boeing Field", dest: "KBFI", destn: "Local Pattern", et: "00:00" },
  };

  function buildTelemetry() {
    const c = W().contacts.find((x) => x.callsign === focusCS) || W().contacts[0];
    const t = SW.TYPES[c.type] || {};
    const r = ROUTES[c.callsign] || ROUTES.ASA1422;
    const el = $("#screen-telemetry .screen-pad");
    el.innerHTML = `
      <div class="tele">
        <div class="tele-main">
          <div class="panel ticked glow tele-hero">
            <div>
              <div class="eyebrow">SELECTED CONTACT · MODE-S</div>
              <div class="cs-big">${c.callsign.slice(0, c.callsign.length - 2)}<span class="live">${c.callsign.slice(-2)}</span></div>
              <div class="sub">
                <span class="badge cy">${c.type}</span>
                <span class="badge">${c.reg}</span>
                <span class="badge ${c.breaching ? "or" : "gn"}"><span class="b-dot"></span>${c.breaching ? "IN BREACH ZONE" : "TRACKING"}</span>
              </div>
              <div class="desc">${t.name || c.type} · ${t.cls || ""}<br>OPERATOR ${SW.AIRLINES[c.op] || "—"} · WAKE ${t.wake || "—"} · SQUAWK ${c.squawk}</div>
            </div>
            <div class="silhouette">${placeholder("SIDE PROFILE", c.type)}</div>
          </div>

          <div class="tele-grid">
            <div class="tele-cell big stat"><div class="s-k">${ico2()} Altitude</div><div class="s-v" id="t-alt">—<span class="u">FT MSL</span></div><div class="trend" id="t-alt-tr">—</div></div>
            <div class="tele-cell big stat"><div class="s-k">${ico2()} Ground Speed</div><div class="s-v" id="t-gs">—<span class="u">KT</span></div><div class="trend" id="t-gs-tr">—</div></div>
            <div class="tele-cell stat">
              <div class="s-k">${ico2()} Heading</div>
              <canvas class="compass" id="t-compass" width="176" height="176"></canvas>
              <div class="s-v" id="t-hdg" style="font-size:20px;text-align:center;margin-top:4px;">—</div>
            </div>
          </div>

          <div class="tele-grid">
            <div class="tele-cell stat"><div class="s-k">Vertical Rate</div><div class="s-v" id="t-vr" style="font-size:24px;">—<span class="u">FPM</span></div></div>
            <div class="tele-cell stat"><div class="s-k">Range To Home</div><div class="s-v" id="t-rng" style="font-size:24px;">—</div></div>
            <div class="tele-cell stat"><div class="s-k">Closing / TCA</div><div class="s-v" id="t-tca" style="font-size:24px;">—</div></div>
          </div>

          <div class="panel ticked">
            <div class="panel-head"><span class="h-ico">${ico(ICONS.gauge)}</span><span class="h-title">Altitude & Speed — Last 60 s</span><span class="h-meta">1 HZ SAMPLE</span></div>
            <div class="chart-wrap"><canvas id="t-chart" height="150"></canvas></div>
            <div class="chart-legend">
              <div class="lg"><span class="ln" style="background:var(--cyan)"></span>ALTITUDE (FT)</div>
              <div class="lg"><span class="ln" style="background:var(--orange)"></span>GROUND SPEED (KT)</div>
            </div>
          </div>
        </div>

        <div class="tele-side">
          <div class="panel ticked">
            <div class="panel-head"><span class="h-ico">${ico(ICONS.target)}</span><span class="h-title">Track Position</span><span class="h-meta" id="t-brg">—</span></div>
            <div class="mini-radar"><canvas id="t-mini"></canvas></div>
          </div>
          <div class="panel ticked">
            <div class="panel-head"><span class="h-ico">${ico(ICONS.plane)}</span><span class="h-title">Flight Plan</span></div>
            <div class="route">
              <div class="port"><div class="code">${r.orig}</div><div class="nm">${r.orign}</div></div>
              <div class="mid"><div class="ln"></div><div class="et">ETE ${r.et}</div></div>
              <div class="port"><div class="code">${r.dest}</div><div class="nm">${r.destn}</div></div>
            </div>
          </div>
          <div class="panel ticked">
            <div class="panel-head"><span class="h-title">Transponder</span></div>
            <div class="panel-body" style="padding-top:6px;padding-bottom:6px;">
              <div class="drow"><span class="dk">Mode</span><span class="dv">S · EHS</span></div>
              <div class="drow"><span class="dk">Squawk</span><span class="dv cy">${c.squawk}</span></div>
              <div class="drow"><span class="dk">Category</span><span class="dv">${t.cat || "—"}</span></div>
              <div class="drow"><span class="dk">Source</span><span class="dv">ADS-B 1090ES</span></div>
              <div class="drow"><span class="dk">Signal</span><span class="dv cy">−74 dBm</span></div>
            </div>
          </div>
        </div>
      </div>`;

    telMini = new SW.Radar($("#t-mini"), { range: 2200, rings: [500, 1100, 1700, 2200], proxRing: null, mini: true, bearings: false, labels: false, sweepSpeed: 0.4 });
    telChart = $("#t-chart");
    telCompass = $("#t-compass");
  }
  function ico2() { return `<span style="width:9px;height:9px;border:1px solid var(--cyan);display:inline-block;transform:rotate(45deg);opacity:.6"></span>`; }

  function drawCompass(cv, hdg) {
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = 88; if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = w * dpr; }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, w);
    const c = w / 2, R = c - 6;
    ctx.strokeStyle = "rgba(120,150,160,0.18)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    for (let d = 0; d < 360; d += 30) {
      const a = (d - 90) * Math.PI / 180;
      const big = d % 90 === 0;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      ctx.lineTo(c + Math.cos(a) * (R - (big ? 7 : 4)), c + Math.sin(a) * (R - (big ? 7 : 4)));
      ctx.strokeStyle = big ? "rgba(22,214,232,0.5)" : "rgba(120,150,160,0.3)"; ctx.stroke();
    }
    // needle
    const a = (hdg - 90) * Math.PI / 180;
    ctx.save(); ctx.translate(c, c); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(R - 12, 0); ctx.lineTo(-6, 5); ctx.lineTo(-6, -5); ctx.closePath();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--cyan");
    ctx.shadowColor = "rgba(22,214,232,0.7)"; ctx.shadowBlur = 8; ctx.fill(); ctx.restore();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(c, c, 2.5, 0, Math.PI * 2); ctx.fillStyle = "rgba(22,214,232,0.9)"; ctx.fill();
  }

  function drawChart(cv, alt, gs) {
    if (!cv || alt.length < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 600, h = 150;
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = 8;
    // gridlines
    ctx.strokeStyle = "rgba(120,150,160,0.08)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad + (h - pad * 2) * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const series = (arr, col, fill) => {
      let mn = Math.min(...arr), mx = Math.max(...arr); if (mx - mn < 1) { mx = mn + 1; }
      mn -= (mx - mn) * 0.15; mx += (mx - mn) * 0.12;
      const X = (i) => (i / (arr.length - 1)) * w;
      const Y = (v) => pad + (h - pad * 2) * (1 - (v - mn) / (mx - mn));
      if (fill) {
        ctx.beginPath(); ctx.moveTo(0, h);
        arr.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(w, h); ctx.closePath();
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, fill); g.addColorStop(1, "transparent");
        ctx.fillStyle = g; ctx.fill();
      }
      ctx.beginPath(); arr.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
      // head dot
      ctx.beginPath(); ctx.arc(X(arr.length - 1), Y(arr[arr.length - 1]), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
    };
    series(alt, getComputedStyle(document.documentElement).getPropertyValue("--cyan"), "rgba(22,214,232,0.14)");
    series(gs, getComputedStyle(document.documentElement).getPropertyValue("--orange"), null);
  }

  // ================================================================
  // HISTORY
  // ================================================================
  let histRows;
  function buildHistory() {
    histRows = SW.buildHistory();
    const total = histRows.length;
    const breaches = histRows.filter((r) => r.breached).length;
    const closest = Math.min(...histRows.map((r) => r.closest));
    const hours = new Array(14).fill(0);
    histRows.forEach((r) => { const h = +r.time.slice(0, 2); if (h >= 0 && h < 14) hours[h]++; });
    const maxH = Math.max(...hours);
    const peakH = hours.indexOf(maxH);

    const el = $("#screen-history .screen-pad");
    el.innerHTML = `
      <div class="hist-toolbar">
        <div class="search"><span class="ico">${ico(ICONS.target)}</span><input id="hist-search" placeholder="SEARCH CALLSIGN / TYPE / SQUAWK…"></div>
        <div class="chipset" id="hist-chips">
          <div class="chip on" data-f="all">ALL</div>
          <div class="chip" data-f="breach">BREACHES</div>
          <div class="chip" data-f="jet">JETS</div>
          <div class="chip" data-f="light">LIGHT / HELO</div>
        </div>
        <div class="hist-stat">
          <div class="hs"><div class="v cy">${total}</div><div class="k">Logged 24H</div></div>
          <div class="hs"><div class="v or">${breaches}</div><div class="k">Breaches</div></div>
          <div class="hs"><div class="v">${closest} m</div><div class="k">Closest Pass</div></div>
        </div>
      </div>

      <div class="panel ticked" style="margin-bottom:18px;">
        <div class="panel-head"><span class="h-ico">${ico(ICONS.gauge)}</span><span class="h-title">Flyover Density — Past 14 Hours</span><span class="h-meta">PEAK ${pad(peakH)}:00 · ${maxH} CONTACTS</span></div>
        <div class="panel-body">
          <div class="histo">${hours.map((v, i) => `<div class="bar ${i === peakH ? "peak" : ""}" style="height:${maxH ? (v / maxH * 100) : 2}%" title="${pad(i)}:00 — ${v}"></div>`).join("")}</div>
          <div class="histo-axis"><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span></div>
        </div>
      </div>

      <div class="panel ticked">
        <div class="panel-head"><span class="h-ico">${ico(ICONS.history)}</span><span class="h-title">Contact Log</span><span class="h-meta" id="hist-shown">${total} RECORDS</span></div>
        <div class="table-wrap">
          <table class="log">
            <thead><tr>
              <th>Time (Z)</th><th>Callsign</th><th>Type</th><th>Class</th>
              <th class="num">Closest</th><th class="num">Peak Alt</th><th class="num">Max GS</th><th class="num">In Zone</th><th>Status</th>
            </tr></thead>
            <tbody id="hist-body"></tbody>
          </table>
        </div>
      </div>`;

    const isJet = (t) => (SW.typeClass(t) || "").includes("Jet");
    const isLight = (t) => /Light|Helicopter|Single/.test(SW.typeClass(t) || "");
    function renderRows(filter, q) {
      q = (q || "").toUpperCase();
      const rows = histRows.filter((r) => {
        if (filter === "breach" && !r.breached) return false;
        if (filter === "jet" && !isJet(r.type)) return false;
        if (filter === "light" && !isLight(r.type)) return false;
        if (q && !(r.callsign.includes(q) || r.type.includes(q))) return false;
        return true;
      });
      $("#hist-shown").textContent = rows.length + " RECORDS";
      $("#hist-body").innerHTML = rows.map((r) => `
        <tr class="${r.breached ? "breached" : ""}">
          <td>${r.time}</td>
          <td class="cs">${r.callsign}</td>
          <td class="typetag">${r.type}</td>
          <td>${SW.typeClass(r.type)}</td>
          <td class="num close">${r.closest} m</td>
          <td class="num">${r.peakAlt.toLocaleString()} ft</td>
          <td class="num">${r.maxGs} kt</td>
          <td class="num">${fmtDur(r.dur)}</td>
          <td>${r.breached ? `<span class="badge or mini-badge">BREACH</span>` : `<span class="badge gn mini-badge">CLEAR</span>`}</td>
        </tr>`).join("");
    }
    let curFilter = "all";
    renderRows("all", "");
    $$("#hist-chips .chip").forEach((ch) => ch.addEventListener("click", () => {
      $$("#hist-chips .chip").forEach((c) => c.classList.remove("on")); ch.classList.add("on");
      curFilter = ch.dataset.f; renderRows(curFilter, $("#hist-search").value);
    }));
    $("#hist-search").addEventListener("input", (e) => renderRows(curFilter, e.target.value));
  }

  // ================================================================
  // CALIBRATION
  // ================================================================
  let calibRadar;
  function buildCalibration() {
    const el = $("#screen-calibration .screen-pad");
    el.innerHTML = `
      <div class="calib">
        <div class="calib-main">
          <div class="panel ticked">
            <div class="panel-head"><span class="h-ico">${ico(ICONS.target)}</span><span class="h-title">Proximity & Detection</span><span class="h-meta">LIVE · AFFECTS SCOPE</span></div>
            <div class="ctrl">
              <div class="c-top"><span class="c-name">Proximity Alert Radius</span><span class="c-val or" id="cv-prox">100 m</span></div>
              <div class="c-desc">Aircraft crossing inside this radius trigger a breach alert and tactical feed entry.</div>
              <input type="range" class="sky or" id="sl-prox" min="40" max="500" step="10" value="100">
              <div class="range-scale"><span>40 m</span><span>250 m</span><span>500 m</span></div>
            </div>
            <div class="ctrl">
              <div class="c-top"><span class="c-name">Scope Range</span><span class="c-val" id="cv-range">2.0 km</span></div>
              <div class="c-desc">Outer ring distance. Lower values magnify the immediate airspace around home base.</div>
              <input type="range" class="sky" id="sl-range" min="1000" max="5000" step="500" value="2000">
              <div class="range-scale"><span>1 km</span><span>3 km</span><span>5 km</span></div>
            </div>
            <div class="ctrl">
              <div class="c-top"><span class="c-name">Sweep Rate</span><span class="c-val" id="cv-sweep">33 RPM</span></div>
              <div class="c-desc">Antenna rotation speed. Faster sweeps refresh blips more often; slower sweeps extend afterglow.</div>
              <input type="range" class="sky" id="sl-sweep" min="0.2" max="1.2" step="0.05" value="0.55">
              <div class="range-scale"><span>12 RPM</span><span>40 RPM</span><span>72 RPM</span></div>
            </div>
            <div class="ctrl">
              <div class="c-top"><span class="c-name">Altitude Filter Ceiling</span><span class="c-val" id="cv-alt">10,000 ft</span></div>
              <div class="c-desc">Suppress contacts above this altitude to focus on low, immediate traffic.</div>
              <input type="range" class="sky" id="sl-alt" min="2000" max="20000" step="1000" value="10000">
              <div class="range-scale"><span>2k</span><span>10k</span><span>20k ft</span></div>
            </div>
          </div>

          <div class="panel ticked">
            <div class="panel-head"><span class="h-ico" style="color:var(--orange)">${ico(ICONS.bell)}</span><span class="h-title">Alerts & Notifications</span></div>
            <div class="toggle-row"><div class="t-info"><div class="t-name">Audio Breach Alarm</div><div class="t-sub">Tone burst when a contact enters the proximity zone</div></div><div class="sw on" data-t="audio"></div></div>
            <div class="toggle-row"><div class="t-info"><div class="t-name">Voice Callouts</div><div class="t-sub">Synthesized callsign + bearing announcements</div></div><div class="sw" data-t="voice"></div></div>
            <div class="toggle-row"><div class="t-info"><div class="t-name">Desktop Notifications</div><div class="t-sub">System banner for every zone entry</div></div><div class="sw on" data-t="desktop"></div></div>
            <div class="toggle-row"><div class="t-info"><div class="t-name">Log Every Contact</div><div class="t-sub">Record all flyovers, not only breaches, to history</div></div><div class="sw on" data-t="log"></div></div>
          </div>
        </div>

        <div class="calib-side">
          <div class="panel ticked glow">
            <div class="panel-head"><span class="h-ico">${ico(ICONS.radar)}</span><span class="h-title">Zone Preview</span><span class="h-meta">REAL-TIME</span></div>
            <div class="calib-preview"><canvas id="calib-radar"></canvas></div>
            <div class="panel-body" style="border-top:1px solid var(--line);">
              <div class="drow"><span class="dk">Alert Zone Area</span><span class="dv or" id="cv-area">—</span></div>
              <div class="drow"><span class="dk">Coverage Radius</span><span class="dv cy" id="cv-cov">2.00 km</span></div>
              <div class="drow"><span class="dk">Contacts Visible</span><span class="dv" id="cv-visible">—</span></div>
            </div>
          </div>

          <div class="panel ticked">
            <div class="panel-head"><span class="h-title">Alert Sensitivity</span></div>
            <div class="panel-body" style="padding-bottom:8px;">
              <div class="seg" id="seg-sens">
                <button data-s="low">Low</button><button class="on" data-s="std">Standard</button><button data-s="high">High</button>
              </div>
            </div>
            <div class="threat-meter">
              <div class="tm-row"><span class="tm-k">Audio</span><div class="tm-bar"><div class="tm-fill" id="tm-audio" style="background:var(--cyan);transform:scaleX(.7)"></div></div><span class="tm-v" id="tmv-audio">70%</span></div>
              <div class="tm-row"><span class="tm-k">Visual</span><div class="tm-bar"><div class="tm-fill" style="background:var(--cyan);transform:scaleX(.9)"></div></div><span class="tm-v">90%</span></div>
              <div class="tm-row"><span class="tm-k">Haptic</span><div class="tm-bar"><div class="tm-fill" style="background:var(--orange);transform:scaleX(.45)"></div></div><span class="tm-v">45%</span></div>
            </div>
          </div>

          <div class="panel ticked">
            <div class="panel-head"><span class="h-title">Station</span></div>
            <div class="panel-body" style="padding-top:6px;padding-bottom:6px;">
              <div class="drow"><span class="dk">Receiver</span><span class="dv">RTL-SDR · 1090 MHz</span></div>
              <div class="drow"><span class="dk">Antenna</span><span class="dv">Collinear · Roof</span></div>
              <div class="drow"><span class="dk">Position</span><span class="dv cy">47.6062, −122.3321</span></div>
              <div class="drow"><span class="dk">Calibration</span><span class="dv">±3 m GPS LOCK</span></div>
            </div>
          </div>
        </div>
      </div>`;

    calibRadar = new SW.Radar($("#calib-radar"), { range: 2000, rings: [100, 500, 1000, 1500, 2000], proxRing: 100, mini: true, bearings: false, labels: false, sweepSpeed: 0.55 });
    wireCalibration();
  }

  function setProxAll(m) {
    W().proximity = m;
    [dashRadar, calibRadar].forEach((r) => r && (r.opts.rings = ringsFor(r.opts.range, m), r.opts.proxRing = m));
  }
  function ringsFor(range, prox) {
    const base = [prox, range * 0.25, range * 0.5, range * 0.75, range].map((x) => Math.round(x));
    return [...new Set(base)].sort((a, b) => a - b);
  }
  function setRangeAll(range) {
    [dashRadar, calibRadar].forEach((r) => r && (r.opts.range = range, r.opts.rings = ringsFor(range, W().proximity)));
    const rl = $("#radar-range"); if (rl) rl.textContent = `RANGE ${(range/1000).toFixed(1)} KM · N-UP`;
    const cov = $("#cv-cov"); if (cov) cov.textContent = (range/1000).toFixed(2) + " km";
  }
  function setSweepAll(s) {
    SW.RADARS.forEach((r) => { if (r.opts.proxRing !== undefined) r.opts.sweepSpeed = s; });
    const rpm = Math.round(s * 60);
    const hud = $("#hud-sweep"); if (hud) hud.textContent = rpm + " RPM";
  }

  function wireCalibration() {
    const prox = $("#sl-prox"), range = $("#sl-range"), sweep = $("#sl-sweep"), alt = $("#sl-alt");
    const upArea = () => {
      const m = +prox.value;
      $("#cv-area").textContent = (Math.PI * m * m / 1000).toFixed(1) + "k m²";
      const vis = W().contacts.filter((c) => c.dist <= +range.value).length;
      $("#cv-visible").textContent = vis + " / " + W().contacts.length;
    };
    prox.addEventListener("input", () => { $("#cv-prox").textContent = prox.value + " m"; setProxAll(+prox.value); upArea(); });
    range.addEventListener("input", () => { $("#cv-range").textContent = (range.value/1000).toFixed(1) + " km"; setRangeAll(+range.value); upArea(); });
    sweep.addEventListener("input", () => { $("#cv-sweep").textContent = Math.round(sweep.value*60) + " RPM"; setSweepAll(+sweep.value); });
    alt.addEventListener("input", () => { $("#cv-alt").textContent = (+alt.value).toLocaleString() + " ft"; });
    $$("#screen-calibration .sw").forEach((s) => s.addEventListener("click", () => s.classList.toggle("on")));
    $$("#seg-sens button").forEach((b) => b.addEventListener("click", () => {
      $$("#seg-sens button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
      const map = { low: 0.45, std: 0.7, high: 0.95 };
      $("#tm-audio").style.transform = `scaleX(${map[b.dataset.s]})`;
      $("#tmv-audio").textContent = Math.round(map[b.dataset.s] * 100) + "%";
    }));
    upArea();
  }

  // ================================================================
  // LIVE TICK (per-frame, throttled)
  // ================================================================
  let acc = 0, started = Date.now(), lastBreach = false, breachCountTotal = 1;
  function liveTick(dt) {
    // dashboard radar foot clock
    const fc = $("#foot-clock"); if (fc) fc.textContent = zulu() + " ZULU";

    acc += dt;
    if (acc < 0.25) return; acc = 0;
    const s = W().summary();

    // stat strip
    set("#st-count", s.count);
    set("#st-breach", s.breach ? 1 : 0);
    const bc = $("#st-breach-cell"); if (bc) bc.classList.toggle("warn", !!s.breach);
    if (s.closest) { set("#st-closest", fmtDist(s.closest.dist)); set("#st-closest-cs", s.closest.callsign + " · " + s.closest.type); }
    const up = Math.floor((Date.now() - started) / 1000);
    set("#st-uptime", pad(Math.floor(up / 60)) + ":" + pad(up % 60));
    set("#top-tracked", s.total);
    set("#top-breach", s.breach ? 1 : 0);

    // breach callout
    const co = $("#breach-callout");
    if (co) {
      co.classList.toggle("show", !!s.breach);
      if (s.breach) {
        const tca = Math.abs(s.breach.tca);
        $("#breach-text").innerHTML = `BREACH · <b>${s.breach.callsign}</b> @ ${Math.round(s.breach.dist)} M · TCA ${pad(Math.floor(tca/60))}:${pad(Math.round(tca%60))}`;
      }
    }
    if (s.breach && !lastBreach) {
      pushFeed({ kind: "alert", ts: zulu(), l1: `<span class="cs">${s.breach.callsign}</span> BREACH · ${Math.round(s.breach.dist)} M`, l2: `${s.breach.type} · INTERCEPT · ALT ${fmtFt(s.breach.alt)} FT` });
    }
    lastBreach = !!s.breach;

    // contacts list (dist changes)
    if ($("#contact-list")) renderContacts();

    // telemetry
    if ($("#screen-telemetry").classList.contains("active")) updateTelemetry();
    // calib visible count
    if ($("#cv-visible") && $("#sl-range")) {
      const r = +$("#sl-range").value;
      $("#cv-visible").textContent = W().contacts.filter((c) => c.dist <= r).length + " / " + W().contacts.length;
    }
  }
  let chartAcc = 0;
  function updateTelemetry() {
    const c = W().contacts.find((x) => x.callsign === focusCS); if (!c) return;
    setHTML("#t-alt", `${fmtFt(c.alt)}<span class="u">FT MSL</span>`);
    setHTML("#t-gs", `${fmtKt(c.gs)}<span class="u">KT</span>`);
    set("#t-hdg", fmtHdg(c.hdg));
    setHTML("#t-vr", `${c.vr >= 0 ? "+" : ""}${fmtFt(c.vr)}<span class="u">FPM</span>`);
    set("#t-rng", fmtDist(c.dist));
    const tca = c.tca > 0 ? c.tca : 0;
    setHTML("#t-tca", c.rangeRate < 0 ? `${pad(Math.floor(tca/60))}:${pad(Math.round(tca%60))}<span class="u">TCA</span>` : `OPENING`);
    set("#t-brg", "BRG " + fmtHdg(c.bearing));
    const tr = $("#t-alt-tr"); if (tr) { tr.className = "trend " + (c.vr > 50 ? "up" : c.vr < -50 ? "dn" : "flat"); tr.textContent = c.vr > 50 ? "▲ CLIMBING" : c.vr < -50 ? "▼ DESCENDING" : "● LEVEL"; }
    const gtr = $("#t-gs-tr"); if (gtr) { gtr.className = "trend flat"; gtr.textContent = "● " + SW.typeClass(c.type).toUpperCase(); }
    drawCompass(telCompass, c.hdg);
    // chart sampling 1Hz
    chartAcc += 0.25;
    if (chartAcc >= 1) {
      chartAcc = 0;
      telHist.alt.push(c.alt); telHist.gs.push(c.gs);
      if (telHist.alt.length > 60) { telHist.alt.shift(); telHist.gs.shift(); }
    }
    drawChart(telChart, telHist.alt, telHist.gs);
  }
  function set(sel, v) { const e = $(sel); if (e) e.textContent = v; }
  function setHTML(sel, v) { const e = $(sel); if (e) e.innerHTML = v; }

  // shared radar refs
  let dashRadar, telMini, telChart, telCompass, calibRadar2;

  // ================================================================
  // BOOT
  // ================================================================
  function boot() {
    SW.World.init();
    startClocks();
    buildDashboard();
    buildTelemetry();
    buildHistory();
    buildCalibration();
    nav("dashboard");
    $$(".nav-item").forEach((n) => n.addEventListener("click", () => nav(n.dataset.go)));
    document.addEventListener("keydown", (e) => {
      const map = { "1": "dashboard", "2": "telemetry", "3": "history", "4": "calibration" };
      if (map[e.key]) nav(map[e.key]);
    });
    SW.onFrame = () => liveTick(0.0167 * 1); // approx; throttled internally
    // seed telemetry history so chart is populated
    const c0 = W().contacts.find((x) => x.callsign === focusCS);
    if (c0) for (let i = 0; i < 40; i++) { telHist.alt.push(c0.alt + Math.sin(i / 5) * 120); telHist.gs.push(c0.gs + Math.sin(i / 7) * 8); }
    SW.startLoop();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // expose for debugging
  SW.nav = nav;
})();
