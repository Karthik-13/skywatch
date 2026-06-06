/* ============================================================
   SkyWatch — radar world simulation + PPI renderer
   ============================================================ */
(function () {
  const KT = 0.514444;          // knots -> m/s
  const D2R = Math.PI / 180;
  const TAU = Math.PI * 2;

  // ---------------- shared world ----------------
  const World = {
    contacts: [],
    proximity: 100,             // meters — the alert zone radius (calibratable)
    maxWorld: 2700,             // respawn boundary
    t: 0,
    init() {
      this.contacts = SW.CONTACTS.map((c) => ({
        ...c,
        trail: [],
        orbit: c.breach ? Math.atan2(c.x, c.y) : 0,
        bgs: c.gs, bhdg: c.hdg,
        jit: Math.random() * 100,
      }));
      this.recompute();
    },
    recompute() {
      for (const c of this.contacts) {
        c.dist = Math.hypot(c.x, c.y);
        c.bearing = (Math.atan2(c.x, c.y) / D2R + 360) % 360;
        const spd = c.gs * KT;
        const vx = Math.sin(c.hdg * D2R) * spd, vy = Math.cos(c.hdg * D2R) * spd;
        // time to closest approach to home (s); range rate (m/s, + = opening)
        const vv = vx * vx + vy * vy || 1e-6;
        c.tca = -(c.x * vx + c.y * vy) / vv;
        c.rangeRate = (c.x * vx + c.y * vy) / (c.dist || 1e-6);
        c.inZone = c.dist <= 2000;
        c.breaching = c.dist <= this.proximity;
      }
    },
    update(dt) {
      this.t += dt;
      for (const c of this.contacts) {
        if (c.breach) {
          // breacher slowly orbits the home zone so the alert stays visible
          c.orbit += 0.16 * dt;
          const r = 72 + Math.sin(this.t * 0.5 + c.jit) * 22;
          c.x = Math.sin(c.orbit) * r;
          c.y = Math.cos(c.orbit) * r;
          c.hdg = ((c.orbit / D2R) + 90 + 360) % 360;
          c.gs = 92 + Math.sin(this.t * 0.8) * 6;
          c.alt = 1100 + Math.sin(this.t * 0.3) * 60;
        } else {
          const spd = c.gs * KT;
          c.x += Math.sin(c.hdg * D2R) * spd * dt;
          c.y += Math.cos(c.hdg * D2R) * spd * dt;
          c.alt += (c.vr / 60) * dt;
          // gentle liveliness
          c.gs = c.bgs + Math.sin(this.t * 0.6 + c.jit) * 4;
          c.hdg = c.bhdg + Math.sin(this.t * 0.25 + c.jit) * 3;
          const d = Math.hypot(c.x, c.y);
          if (d > this.maxWorld) {
            // respawn at the boundary heading roughly across the field
            const a = Math.random() * TAU;
            c.x = Math.cos(a) * (this.maxWorld - 30);
            c.y = Math.sin(a) * (this.maxWorld - 30);
            const toCenter = (Math.atan2(-c.x, -c.y) / D2R + 360) % 360;
            c.bhdg = toCenter + (Math.random() * 80 - 40);
            c.hdg = c.bhdg;
            c.trail.length = 0;
          }
        }
        // trail
        c.trail.push({ x: c.x, y: c.y });
        if (c.trail.length > 90) c.trail.shift();
      }
      this.recompute();
    },
    summary() {
      const inZone = this.contacts.filter((c) => c.inZone);
      let closest = null;
      for (const c of this.contacts) if (!closest || c.dist < closest.dist) closest = c;
      const breach = this.contacts.find((c) => c.breaching) || null;
      return { count: inZone.length, total: this.contacts.length, closest, breach };
    },
  };

  // ---------------- PPI renderer ----------------
  class Radar {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.opts = Object.assign({
        range: 2000,                       // meters at outer ring
        rings: [100, 500, 1000, 1500, 2000],
        sweepSpeed: 0.55,                  // rev/sec * 2pi handled below (deg/s)
        labels: true, bearings: true, mini: false, trails: true,
        accent: getCss("--cyan"), warn: getCss("--orange"),
      }, opts);
      this.sa = -Math.PI / 2;              // sweep angle (canvas radians)
      this.glow = new Map();               // contact id -> afterglow intensity
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      RADARS.push(this);
    }
    set(key, val) { this.opts[key] = val; }
    resize() {
      const r = this.cv.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (this.cv.width !== w * this.dpr || this.cv.height !== h * this.dpr) {
        this.cv.width = w * this.dpr; this.cv.height = h * this.dpr;
      }
      this.w = w; this.h = h;
    }
    m2px(m) { return (m / this.opts.range) * this.R; }

    render(dt) {
      this.resize();
      const ctx = this.ctx, w = this.w, h = this.h;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) / 2 - (this.opts.mini ? 10 : 26);
      this.cx = cx; this.cy = cy; this.R = R;
      if (!isFinite(R) || R < 6) return; // canvas hidden / too small to draw
      const A = this.opts.accent, Wn = this.opts.warn;

      // background field
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      bg.addColorStop(0, "rgba(22,214,232,0.05)");
      bg.addColorStop(0.7, "rgba(10,16,20,0.0)");
      bg.addColorStop(1, "rgba(0,0,0,0.0)");
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

      // outer clip for sweep
      this._sweep(ctx, cx, cy, R, dt, A);

      // grid: crosshair
      ctx.strokeStyle = "rgba(120,150,160,0.10)"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      // diagonal hairlines
      ctx.strokeStyle = "rgba(120,150,160,0.05)";
      ctx.beginPath();
      const dd = R * Math.SQRT1_2;
      ctx.moveTo(cx - dd, cy - dd); ctx.lineTo(cx + dd, cy + dd);
      ctx.moveTo(cx - dd, cy + dd); ctx.lineTo(cx + dd, cy - dd);
      ctx.stroke();

      // range rings
      ctx.font = `${this.opts.mini ? 8 : 9}px 'JetBrains Mono', monospace`;
      for (const rm of this.opts.rings) {
        const rr = this.m2px(rm);
        if (rr > R + 1) continue;
        const isProx = rm === this.opts.proxRing;
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU);
        ctx.strokeStyle = isProx ? (World.summary().breach ? "rgba(255,122,24,0.55)" : "rgba(255,122,24,0.28)")
                                 : "rgba(22,214,232,0.16)";
        ctx.lineWidth = isProx ? 1.4 : 1;
        ctx.setLineDash(isProx ? [] : [2, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!this.opts.mini) {
          const lbl = rm >= 1000 ? (rm / 1000).toFixed(rm % 1000 ? 1 : 0) + "km" : rm + "m";
          ctx.fillStyle = isProx ? "rgba(255,161,77,0.7)" : "rgba(120,150,160,0.4)";
          ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(lbl, cx + 4, cy - rr + 1);
        }
      }

      // proximity zone fill
      if (this.opts.proxRing) {
        const pr = this.m2px(this.opts.proxRing);
        const br = World.summary().breach;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr);
        g.addColorStop(0, br ? "rgba(255,122,24,0.20)" : "rgba(255,122,24,0.06)");
        g.addColorStop(1, "rgba(255,122,24,0.0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.fill();
        if (br) {
          // expanding pulse
          const ph = (World.t * 0.8) % 1;
          ctx.beginPath(); ctx.arc(cx, cy, pr * (0.4 + ph * 0.9), 0, TAU);
          ctx.strokeStyle = `rgba(255,122,24,${0.5 * (1 - ph)})`; ctx.lineWidth = 1.4; ctx.stroke();
        }
      }

      // bearing ticks
      if (this.opts.bearings && !this.opts.mini) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (let d = 0; d < 360; d += 30) {
          const a = (d - 90) * D2R;
          const x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R;
          const x2 = cx + Math.cos(a) * (R - (d % 90 === 0 ? 12 : 7));
          const y2 = cy + Math.sin(a) * (R - (d % 90 === 0 ? 12 : 7));
          ctx.strokeStyle = d % 90 === 0 ? "rgba(22,214,232,0.4)" : "rgba(120,150,160,0.25)";
          ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          if (d % 90 === 0) {
            const lx = cx + Math.cos(a) * (R - 22), ly = cy + Math.sin(a) * (R - 22);
            ctx.fillStyle = "rgba(150,175,185,0.6)";
            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.fillText(["N","E","S","W"][d / 90], lx, ly);
          }
        }
        // outer ring
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
        ctx.strokeStyle = "rgba(22,214,232,0.22)"; ctx.lineWidth = 1; ctx.stroke();
      }

      // contacts
      for (const c of World.contacts) this._blip(ctx, c, dt);

      // home marker
      this._home(ctx, cx, cy);
    }

    _sweep(ctx, cx, cy, R, dt, A) {
      this.sa += (this.opts.sweepSpeed * TAU) * dt;
      if (this.sa > TAU) this.sa -= TAU;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
      const N = 26, trail = 1.1; // radians of trail
      for (let i = 0; i < N; i++) {
        const a1 = this.sa - (i / N) * trail;
        const a0 = this.sa - ((i + 1) / N) * trail;
        const al = 0.16 * (1 - i / N);
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
        ctx.fillStyle = `rgba(22,214,232,${al})`;
        ctx.fill();
      }
      // leading line
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(this.sa) * R, cy + Math.sin(this.sa) * R);
      ctx.strokeStyle = "rgba(79,230,244,0.55)"; ctx.lineWidth = 1.4;
      ctx.shadowColor = "rgba(22,214,232,0.7)"; ctx.shadowBlur = 8;
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.restore();
    }

    _blip(ctx, c, dt) {
      const rr = this.m2px(c.dist);
      if (rr > this.R + 4) { this.glow.set(c.id, 0); return; }
      const sx = this.cx + this.m2px(c.x);
      const sy = this.cy - this.m2px(c.y);
      const warn = c.breaching;
      const col = warn ? this.opts.warn : this.opts.accent;

      // afterglow when sweep passes
      const blipA = Math.atan2(sy - this.cy, sx - this.cx);
      let diff = this.sa - blipA; diff = ((diff % TAU) + TAU) % TAU;
      let g = this.glow.get(c.id) || 0;
      if (diff < 0.12) g = 1;
      g = Math.max(g - dt * 0.55, warn ? 0.45 : 0.12);
      this.glow.set(c.id, g);

      // trail
      if (this.opts.trails && c.trail.length > 1) {
        ctx.beginPath();
        for (let i = Math.max(0, c.trail.length - 40); i < c.trail.length; i++) {
          const p = c.trail[i];
          const px = this.cx + this.m2px(p.x), py = this.cy - this.m2px(p.y);
          if (i === Math.max(0, c.trail.length - 40)) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = warn ? `rgba(255,122,24,0.28)` : `rgba(22,214,232,0.18)`;
        ctx.lineWidth = 1; ctx.stroke();
      }

      // heading triangle
      const ca = (c.hdg - 90) * D2R;
      const sz = this.opts.mini ? 3.6 : (warn ? 6 : 5);
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(ca);
      ctx.beginPath();
      ctx.moveTo(sz * 1.5, 0); ctx.lineTo(-sz, sz * 0.85); ctx.lineTo(-sz, -sz * 0.85); ctx.closePath();
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = (6 + g * 12);
      ctx.globalAlpha = 0.55 + g * 0.45;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;

      // warn ring
      if (warn) {
        ctx.beginPath(); ctx.arc(sx, sy, sz + 6, 0, TAU);
        ctx.strokeStyle = "rgba(255,122,24,0.8)"; ctx.lineWidth = 1.2; ctx.stroke();
      }

      // label
      if (this.opts.labels && !this.opts.mini) {
        ctx.font = "9.5px 'JetBrains Mono', monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillStyle = warn ? "rgba(255,161,77,0.95)" : "rgba(200,228,235,0.78)";
        ctx.fillText(c.callsign, sx + sz + 8, sy - 5);
        ctx.fillStyle = warn ? "rgba(255,122,24,0.7)" : "rgba(120,150,160,0.6)";
        ctx.fillText(Math.round(c.alt).toLocaleString() + "ft", sx + sz + 8, sy + 6);
      }
    }

    _home(ctx, cx, cy) {
      ctx.save();
      // pulsing ground glow
      const pr = 7 + Math.sin(World.t * 2) * 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, pr + 5, 0, TAU);
      ctx.fillStyle = "rgba(22,214,232,0.12)"; ctx.fill();
      // diamond
      ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.beginPath(); ctx.rect(-4, -4, 8, 8);
      ctx.strokeStyle = getCss("--cyan"); ctx.lineWidth = 1.6;
      ctx.shadowColor = "rgba(22,214,232,0.8)"; ctx.shadowBlur = 8; ctx.stroke();
      ctx.fillStyle = "rgba(22,214,232,0.25)"; ctx.fill();
      ctx.restore();
      if (!this.opts.mini) {
        ctx.font = "8.5px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(150,175,185,0.7)"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText("HOME", cx, cy + 12);
      }
    }
  }

  // ---------------- loop ----------------
  const RADARS = [];
  let last = 0, running = false;
  function loop(ts) {
    if (!running) return;
    const dt = Math.min((ts - last) / 1000 || 0, 0.05);
    last = ts;
    World.update(dt);
    for (const r of RADARS) { try { r.render(dt); } catch (e) {} }
    if (SW.onFrame) SW.onFrame();
    requestAnimationFrame(loop);
  }
  function start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } }

  function getCss(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#16d6e8";
  }

  window.SW = window.SW || {};
  Object.assign(window.SW, { World, Radar, startLoop: start, RADARS });
})();
