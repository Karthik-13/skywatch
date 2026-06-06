/* ============================================================
   SkyWatch — simulated airspace data
   Designed to mirror an ADS-B / OpenSky feed shape so a real
   source can be swapped in later (see SW.adaptContact).
   ============================================================ */
(function () {
  const HOME = { lat: 47.6062, lon: -122.3321, name: "HOME BASE", id: "STN-7G" };

  // ---- aircraft reference library (type metadata) ----
  const TYPES = {
    A320: { name: "Airbus A320-200", cls: "Narrowbody Jet", cat: "L2J", wake: "Medium" },
    B738: { name: "Boeing 737-800", cls: "Narrowbody Jet", cat: "L2J", wake: "Medium" },
    B789: { name: "Boeing 787-9", cls: "Widebody Jet", cat: "L2J", wake: "Heavy" },
    E75L: { name: "Embraer E175", cls: "Regional Jet", cat: "L2J", wake: "Medium" },
    CRJ9: { name: "Bombardier CRJ-900", cls: "Regional Jet", cat: "L2J", wake: "Medium" },
    C172: { name: "Cessna 172 Skyhawk", cls: "Light Piston", cat: "L1P", wake: "Light" },
    PC12: { name: "Pilatus PC-12", cls: "Turboprop Single", cat: "L1T", wake: "Light" },
    EC35: { name: "Airbus H135", cls: "Light Helicopter", cat: "H2T", wake: "Light" },
    DH8D: { name: "De Havilland Dash 8-400", cls: "Turboprop", cat: "L2T", wake: "Medium" },
  };

  const AIRLINES = {
    ASA: "Alaska Airlines", UAL: "United", DAL: "Delta", SWA: "Southwest",
    QXE: "Horizon Air", SKW: "SkyWest", GOV: "—", N: "Private",
  };

  // ---- live contacts (positions are meters E/N of home) ----
  // one of these is breaching the 100m zone.
  const CONTACTS = [
    { id: "a1", callsign: "ASA1422", reg: "N924VA", op: "ASA", type: "A320", x: -640, y: 980, alt: 4200, gs: 214, hdg: 156, vr: -640, squawk: "4471" },
    { id: "a2", callsign: "QXE2280", reg: "N637QX", op: "QXE", type: "E75L", x: 1180, y: -420, alt: 6800, gs: 268, hdg: 248, vr: 0, squawk: "3302" },
    { id: "a3", callsign: "N172SW", reg: "N172SW", op: "N", type: "C172", x: 62, y: -78, alt: 1100, gs: 96, hdg: 312, vr: -180, squawk: "1200", breach: true },
    { id: "a4", callsign: "SKW5519", reg: "N221SY", op: "SKW", type: "CRJ9", x: -1480, y: -1120, alt: 8200, gs: 301, hdg: 64, vr: 720, squawk: "5517" },
    { id: "a5", callsign: "LIFEGUARD", reg: "N911EC", op: "GOV", type: "EC35", x: 540, y: 1420, alt: 900, gs: 128, hdg: 198, vr: -120, squawk: "0030" },
    { id: "a6", callsign: "DAL2210", reg: "N3762Y", op: "DAL", type: "B738", x: -1720, y: 760, alt: 9900, gs: 322, hdg: 118, vr: 1100, squawk: "6614" },
    { id: "a7", callsign: "N455PC", reg: "N455PC", op: "N", type: "PC12", x: 1620, y: 1180, alt: 5400, gs: 178, hdg: 224, vr: -240, squawk: "1456" },
  ];

  // ---- flyover history log ----
  const HIST_TYPES = ["A320","B738","E75L","CRJ9","C172","PC12","EC35","DH8D","B789"];
  const HIST_OPS = ["ASA","UAL","DAL","SWA","QXE","SKW","N"];
  function pad(n, w) { return String(n).padStart(w, "0"); }
  function rnd(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  function buildHistory() {
    const r = rnd(7);
    const rows = [];
    const callPrefix = { ASA:"ASA", UAL:"UAL", DAL:"DAL", SWA:"SWA", QXE:"QXE", SKW:"SKW", N:"N" };
    let mins = 0;
    for (let i = 0; i < 42; i++) {
      mins += 4 + Math.floor(r() * 26);
      const h = 13 - Math.floor(mins / 60);
      const m = 59 - (mins % 60);
      const op = HIST_OPS[Math.floor(r() * HIST_OPS.length)];
      const type = HIST_TYPES[Math.floor(r() * HIST_TYPES.length)];
      const cs = op === "N" ? "N" + pad(Math.floor(r()*900+100),3) + "XY".charAt(Math.floor(r()*2)) + "Z"
                            : callPrefix[op] + (Math.floor(r()*8900)+100);
      const closest = Math.floor(r() * 2400) + 40;
      const breached = closest < 100;
      rows.push({
        time: `${pad(h,2)}:${pad(m,2)}:${pad(Math.floor(r()*60),2)}`,
        callsign: cs,
        op, type,
        closest,
        peakAlt: Math.floor(r() * 11000) + 700,
        dur: Math.floor(r() * 340) + 18,
        maxGs: Math.floor(r() * 230) + 90,
        breached,
      });
    }
    return rows;
  }

  // shape adapter for a future real feed (OpenSky state vector -> contact)
  function adaptContact(sv) {
    return {
      callsign: (sv.callsign || "").trim(),
      alt: Math.round((sv.geo_altitude || 0) * 3.28084),
      gs: Math.round((sv.velocity || 0) * 1.94384),
      hdg: Math.round(sv.true_track || 0),
      vr: Math.round((sv.vertical_rate || 0) * 196.85),
      squawk: sv.squawk || "----",
    };
  }

  window.SW = window.SW || {};
  Object.assign(window.SW, {
    HOME, TYPES, AIRLINES, CONTACTS, buildHistory, adaptContact,
    typeName: (t) => (TYPES[t] ? TYPES[t].name : t),
    typeClass: (t) => (TYPES[t] ? TYPES[t].cls : "Aircraft"),
  });
})();
