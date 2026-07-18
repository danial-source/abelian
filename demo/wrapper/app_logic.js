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
    apiBase: "https://abelian-api-demo.onrender.com",
  };
  APP.SAMPLE_CSV = "name,latitude,longitude\n" +
    "1275 Fountaingrove Pkwy Santa Rosa,38.4405,-122.7141\n" +
    "Downtown Napa - 1st St,38.2986,-122.2857\n" +
    "Guerneville - Main St,38.5019,-122.9958\n";

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
      <button class="btn" data-ppdf="${r.i}" style="margin-top:12px">Export property PDF</button>
      <div class="prov">${val(p.assessment_source)} \u00b7 Rendered from governed layer data</div>`;
  };


  // ── Portfolio workflow (upload → score → publish → swap) ────────────────
  APP.uploadPortfolio = async function (file, name) {
    const bar = document.getElementById("jobstatus");
    const setStatus = (t) => { if (bar) bar.textContent = t; };
    setStatus("Uploading\u2026");
    const cold = setTimeout(() =>
      setStatus("Scoring engine waking up (cold start) \u2014 hang tight\u2026"), 4000);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("portfolio_name", name);
    let job;
    try {
      const r = await fetch(APP.CONFIG.apiBase + "/portfolio/analyze",
                            { method: "POST", body: fd });
      clearTimeout(cold);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setStatus("Rejected: " + (d.detail || r.status));
        return;
      }
      job = await r.json();
    } catch (e) {
      clearTimeout(cold);
      setStatus("Upload failed \u2014 is the scoring API reachable?");
      return;
    }
    // Poll
    for (;;) {
      await new Promise(res => setTimeout(res, 4000));
      let st;
      try {
        st = await (await fetch(APP.CONFIG.apiBase +
          "/portfolio/analyze/" + job.job_id)).json();
      } catch (e) { setStatus("Lost contact with job \u2014 retrying\u2026"); continue; }
      if (st.status === "scoring")
        setStatus("Scoring " + st.progress.done + " of " + st.progress.total + " properties\u2026");
      else if (st.status === "publishing")
        setStatus("Publishing styled map to Felt\u2026");
      else if (st.status === "failed") { setStatus("Failed: " + (st.failure || "unknown")); return; }
      else if (st.status === "complete") {
        const errs = (st.result.errors || []).length;
        setStatus("Done \u2014 " + st.result.summary.property_count + " properties scored" +
                  (errs ? " (" + errs + " row" + (errs > 1 ? "s" : "") + " errored: " +
                   st.result.errors.map(e => e.property).join(", ") + ")" : ""));
        APP.loadPortfolio(st.result, name);
        return;
      }
    }
  };

  APP.loadPortfolio = function (result, name) {
    APP.CONFIG.title = name;
    APP.CONFIG.feltMapId = result.felt_map_id;
    APP.GEOJSON = result.geojson;
    APP._m = APP.model(APP.GEOJSON);
    document.getElementById("ptitle").textContent = "\u2014 " + name;
    document.getElementById("summary").innerHTML =
      APP.renderSummary(APP._m) + APP.summaryButtons();
    document.getElementById("list").innerHTML =
      APP._m.rows.map(r => APP.renderRow(r, false)).join("");
    document.getElementById("detail").classList.remove("open");
    if (window.embedFelt) window.embedFelt(result.felt_map_id);
    const link = document.getElementById("feltlink");
    if (link) link.href = result.felt_map_url;
  };

  APP.exportPdf = async function () {
    const bar = document.getElementById("jobstatus");
    if (bar) bar.textContent = "Building PDF\u2026";
    try {
      const r = await fetch(APP.CONFIG.apiBase + "/portfolio/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geojson: APP.GEOJSON,
                               portfolio_name: APP.CONFIG.title }),
      });
      if (!r.ok) { if (bar) bar.textContent = "PDF failed (" + r.status + ")"; return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "portfolio-hazard-review.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
      if (bar) bar.textContent = "";
    } catch (e) { if (bar) bar.textContent = "PDF failed \u2014 API unreachable"; }
  };

  APP.summaryButtons = function () {
    return '<div class="stat" style="margin-left:auto;display:flex;gap:8px;align-items:center">' +
      '<span id="jobstatus" style="font-size:11px;color:var(--amber)"></span>' +
      '<button class="btn" id="btn-new">New portfolio</button>' +
      '<button class="btn" id="btn-pdf">Export PDF</button>' +
      '<a class="btn" id="feltlink" target="_blank" href="https://felt.com/map/' +
      APP.CONFIG.feltMapId + '">Open in Felt</a></div>';
  };

  // ── Browser wiring ───────────────────────────────────────────────────────
  APP.boot = function () {
    const m = APP.model(APP.GEOJSON);
    APP._m = m;
    document.getElementById("ptitle").textContent = "\u2014 " + APP.CONFIG.title;
    document.getElementById("summary").innerHTML =
      APP.renderSummary(m) + APP.summaryButtons();
    console.log("summary hand-check:", { properties: m.count, highWildfire: m.highWf,
      floodExposed: m.floodExposed, combined: Math.round(m.totalExposure) });
    const list = document.getElementById("list");
    list.innerHTML = m.rows.map(r => APP.renderRow(r, false)).join("");
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".row");
      if (row) APP.select(+row.dataset.i, true);
    });
    document.getElementById("summary").addEventListener("click", (e) => {
      if (e.target.id === "btn-pdf") APP.exportPdf();
      if (e.target.id === "btn-new") {
        const dlg = document.getElementById("uploadform");
        if (dlg) dlg.classList.toggle("open");
      }
    });
    const uf = document.getElementById("uploadform");
    if (uf) uf.addEventListener("submit", (e) => {
      e.preventDefault();
      const file = document.getElementById("csvfile").files[0];
      const name = document.getElementById("pname").value || "Untitled Portfolio";
      if (!file) return;
      uf.classList.remove("open");
      APP.uploadPortfolio(file, name);
    });
    const sl = document.getElementById("samplecsv");
    if (sl) sl.href = "data:text/csv;charset=utf-8," + encodeURIComponent(APP.SAMPLE_CSV);
    document.getElementById("detail").addEventListener("click", (e) => {
      const pb = e.target.closest("[data-ppdf]");
      if (pb) {
        const r = APP._m.rows.find(x => x.i === +pb.dataset.ppdf);
        if (r) window.open(APP.CONFIG.apiBase + "/hazard/score-v2/pdf?lat=" +
                           r.lat + "&lng=" + r.lng, "_blank");
      }
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
