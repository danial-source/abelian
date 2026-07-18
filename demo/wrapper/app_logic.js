/* Portfolio Hazard Review — wrapper logic.
   Pure functions build HTML strings (testable in Node); DOM wiring is
   browser-only. Data is bundled at build time (data.js sets APP.GEOJSON). */
(function (root) {
  "use strict";
  const APP = {};

  // ── Config: the ONLY portfolio-specific values on the page ──────────────
  APP.CONFIG = {
    title: "North Bay Properties",
    feltMapId: "UfY5hIcFSimAypc8UNlkoB",
  };

  // ── Parsers (proven against every feature before shipping) ─────────────
  APP.parseDollars = function (s) {
    if (typeof s !== "string") return null;
    const m = s.replace(/,/g, "").match(/\$([0-9]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1]) : null;
  };
  APP.parseConfidence = function (s) {
    if (typeof s !== "string") return null;
    const m = s.match(/^([A-Z ]+?)\s*\((\d+)%\)/);
    return m ? { tier: m[1].trim(), pct: +m[2] } : { tier: s, pct: null };
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const usd = (n) => n == null ? "\u2014" : "$" + Math.round(n).toLocaleString("en-US") + "/yr";
  const val = (v) => (v === undefined || v === null || v === "") ? "\u2014" : esc(v);
  const badgeClass = (tier) =>
    tier === "HIGH" ? "b-HIGH" : tier === "MODERATE" ? "b-MODERATE" :
    tier === "LOW" ? "b-LOW" : "b-NA";

  // ── Derived model ────────────────────────────────────────────────────────
  APP.model = function (geojson) {
    const rows = geojson.features.map((f, i) => {
      const p = f.properties;
      const wf = APP.parseDollars(p.wildfire_annual_loss);
      const fl = APP.parseDollars(p.flood_annual_loss);
      return {
        i, p,
        lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        wfUsd: wf, flUsd: fl,
        combined: (wf ?? 0) + (fl ?? 0),
        hasUnknown: wf === null || fl === null,
      };
    });
    rows.sort((a, b) => b.combined - a.combined);
    return {
      rows,
      count: rows.length,
      highWf: rows.filter(r => r.p.wildfire_risk === "HIGH").length,
      floodExposed: rows.filter(r => r.p.in_sfha === "Yes").length,
      cannotAssess: rows.filter(r => r.p.wildfire_risk === "CANNOT ASSESS" || r.p.flood_risk === "CANNOT ASSESS").length,
      totalExposure: rows.reduce((s, r) => s + r.combined, 0),
    };
  };

  // ── Renderers (pure: model → HTML string) ───────────────────────────────
  APP.renderSummary = function (m) {
    const fmtM = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n).toLocaleString("en-US");
    const stats = [
      [m.count, "Properties"],
      [m.highWf, "High wildfire"],
      [m.floodExposed, "Flood-exposed (SFHA)"],
      [fmtM(m.totalExposure) + "/yr", "Combined est. annual exposure" + (m.cannotAssess ? " *" : "")],
    ];
    if (m.cannotAssess) stats.push([m.cannotAssess, "Cannot assess *"]);
    return stats.map(([n, l]) =>
      `<div class="stat"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("") +
      (m.cannotAssess ? `<div class="stat"><div class="l" style="align-self:end">* excludes unassessable properties</div></div>` : "");
  };

  APP.renderRow = function (r, active) {
    const tier = r.p.wildfire_risk || "\u2014";
    const cls = badgeClass(tier);
    return `<div class="row${active ? " active" : ""}" data-i="${r.i}">
      <div><div class="name">${val(r.p.property)}</div>
      <span class="badge ${cls}">${esc(tier)}</span></div>
      <div class="amt">${r.hasUnknown && r.combined === 0 ? "\u2014" : usd(r.combined)}</div></div>`;
  };

  APP.renderDetail = function (r) {
    const p = r.p;
    const conf = APP.parseConfidence(p.confidence) || { tier: "\u2014", pct: null };
    const fires = Array.isArray(p.historical_fires_nearby) ? p.historical_fires_nearby : [];
    const fireChips = fires.slice(0, 10).map(f =>
      `<span class="chip">${val(f.name)} ${val(f.year)} \u00b7 ${f.acres != null ? Math.round(f.acres).toLocaleString("en-US") + " ac" : "\u2014"}</span>`).join("");
    return `
      <button class="close" data-close>\u00d7</button>
      <h2>${val(p.property)}</h2>
      <div class="sub" style="font-size:11px;color:var(--dim)">Confidence: ${esc(conf.tier)}${conf.pct != null ? " (" + conf.pct + "%)" : ""}</div>

      <div class="peril">
        <h3>Wildfire <span class="badge ${badgeClass(p.wildfire_risk)}">${val(p.wildfire_risk)}</span></h3>
        <div class="big">${p.wildfire_risk === "CANNOT ASSESS" ? "N/A \u2014 cannot assess" : val(p.wildfire_annual_loss)}</div>
        <div class="kv"><span class="k">Damage probability</span><span class="v">${val(p.wildfire_damage_prob)}</span></div>
        <div class="kv"><span class="k">Canopy cover</span><span class="v">${p.canopy_cover_pct != null ? p.canopy_cover_pct + "%" : "\u2014"}</span></div>
        ${fires.length ? `<div class="fires"><h4>Fire history at this location</h4>${fireChips}</div>` : ""}
      </div>

      <div class="peril">
        <h3>Flood <span class="badge ${badgeClass(p.flood_risk)}">${val(p.flood_risk)}</span></h3>
        <div class="big">${val(p.flood_annual_loss)}</div>
        <div class="kv"><span class="k">FEMA zone</span><span class="v">${val(p.flood_zone)}</span></div>
        <div class="kv"><span class="k">In SFHA</span><span class="v">${val(p.in_sfha)}</span></div>
        <div class="kv"><span class="k">Return period</span><span class="v">${val(p.flood_return_period)}</span></div>
        <div class="kv"><span class="k">100-yr event loss</span><span class="v">${val(p.flood_total_loss_100yr)}</span></div>
      </div>

      <div class="peril">
        <h3>Valuation basis</h3>
        <div class="kv"><span class="k">Replacement value</span><span class="v">${val(p.replacement_value)}</span></div>
        <div class="kv"><span class="k">Structure</span><span class="v">${val(p.building_type)}</span></div>
        <div class="kv"><span class="k">Source</span><span class="v">${val(p.value_source)}</span></div>
      </div>

      ${p.confidence_note ? `<div class="callout"><span class="tag">CONFIDENCE NOTE</span><div>${val(p.confidence_note)}</div></div>` : ""}
      ${p.data_gaps ? `<div class="callout"><span class="tag">DATA GAPS</span><div>${val(p.data_gaps)}</div></div>` : ""}
      <div class="prov">${val(p.assessment_source)} \u00b7 Rendered from governed layer data</div>`;
  };

  // ── Browser wiring ───────────────────────────────────────────────────────
  APP.boot = function () {
    const m = APP.model(APP.GEOJSON);
    APP._m = m;
    document.getElementById("ptitle").textContent = "\u2014 " + APP.CONFIG.title;
    document.getElementById("summary").innerHTML = APP.renderSummary(m);
    console.log("summary hand-check:", { properties: m.count, highWildfire: m.highWf,
      floodExposed: m.floodExposed, combined: Math.round(m.totalExposure) });
    const list = document.getElementById("list");
    list.innerHTML = m.rows.map(r => APP.renderRow(r, false)).join("");
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".row");
      if (row) APP.select(+row.dataset.i, true);
    });
    document.getElementById("detail").addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) {
        document.getElementById("detail").classList.remove("open");
        document.querySelectorAll(".row.active").forEach(el => el.classList.remove("active"));
      }
    });
  };

  APP.select = function (i, flyTo) {
    const r = APP._m.rows.find(x => x.i === i);
    if (!r) return;
    document.querySelectorAll(".row").forEach(el =>
      el.classList.toggle("active", +el.dataset.i === i));
    const el = document.querySelector(`.row[data-i="${i}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
    const d = document.getElementById("detail");
    d.innerHTML = APP.renderDetail(r);
    d.classList.add("open");
    if (flyTo && APP._felt) {
      APP._felt.setViewport({ center: { latitude: r.lat, longitude: r.lng }, zoom: 15 });
    }
  };

  APP.wireMap = function (felt) {
    APP._felt = felt;
    const ld = document.getElementById("maploading");
    if (ld) ld.remove();
    // Map click → match property → highlight row + open panel (no fly-to loop)
    felt.onPointerClick({
      handler: (event) => {
        const f = (event.features || [])[0];
        const name = f && f.properties && (f.properties.property || f.properties.name);
        if (!name) return;
        const r = APP._m.rows.find(x => x.p.property === name);
        if (r) APP.select(r.i, false);
      },
    });
  };

  root.APP = APP;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", APP.boot);
    else APP.boot();
  }
})(typeof window !== "undefined" ? window : globalThis);
