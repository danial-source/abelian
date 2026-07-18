/* generated: bundled logic + data */
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

;globalThis.APP.GEOJSON = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.7141, 38.4405]}, "properties": {"property": "1275 Fountaingrove Pkwy Santa Rosa", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$124,412/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$7,005,195", "building_type": "residential steel", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 124412.26, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$124,412/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.7052, 38.4462]}, "properties": {"property": "Fountaingrove Ridge Ct", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$3,185/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$179,310", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 3184.54, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$3,185/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.7439, 38.4667]}, "properties": {"property": "Coffey Park - Hopper Ave", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$9,824/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$553,147", "building_type": "commercial concrete", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 9823.9, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$9,824/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.7398, 38.4695]}, "properties": {"property": "Coffey Park - Dogwood Dr", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$2,974/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$167,463", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 2974.14, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$2,974/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.6858, 38.5085]}, "properties": {"property": "Mark West Springs Rd", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$10,120/yr", "wildfire_damage_prob": "70%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "OCEGUERA", "year": 2004, "acres": 19.6}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone D", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$216,748", "building_type": "agricultural wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 10119.97, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$10,120/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.5852, 38.5827]}, "properties": {"property": "Calistoga - Foothill Blvd", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$116,222/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "CLOVER", "year": 2017, "acres": 13.9}, {"name": "Hwy 29 Fuel Break - Phase 1", "year": 2015, "acres": 43.18719}, {"name": "BENNETT", "year": 2013, "acres": 0.13}, {"name": "MOUNTAIN", "year": 2007, "acres": 49.28}, {"name": "PALISADES", "year": 1983, "acres": 191.2039}, {"name": "SILVERADO", "year": 1982, "acres": 6218.79}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}, {"name": null, "year": 1939, "acres": 212.7766}, {"name": "Unknown", "year": 1939, "acres": 212.78}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$1,307,632", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 116222.34, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$116,222/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.5637, 38.5946]}, "properties": {"property": "Calistoga - Silverado Trail N", "wildfire_risk": "CANNOT ASSESS", "wildfire_annual_loss": "N/A", "wildfire_damage_prob": "86%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "CLOVER", "year": 2017, "acres": 13.9}, {"name": "Hwy 29 Fuel Break - Phase 1", "year": 2015, "acres": 43.18719}, {"name": "WILDLAKE VMP", "year": 1994, "acres": 71.35973}, {"name": "PALISADES", "year": 1983, "acres": 191.2039}, {"name": "SILVERADO", "year": 1982, "acres": 6218.79}, {"name": "PALISADES VMP", "year": 1981, "acres": 106.2427}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}, {"name": "C. SAVIEZ", "year": 1959, "acres": 205.4}], "canopy_cover_pct": 55.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "N/A", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "N/A", "confidence": "HIGH (90%)", "replacement_value": "N/A", "building_type": "No structure matched", "value_source": "N/A", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "combined_annual_exposure": "N/A"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.4767, 38.5241]}, "properties": {"property": "Deer Park - Sanitarium Rd", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$126,273/yr", "wildfire_damage_prob": "70%", "historical_fires_nearby": [{"name": "HILLCREST", "year": 2016, "acres": 17.34528}, {"name": "DEER", "year": 2008, "acres": 233.1}, {"name": "SILVERADO", "year": 2003, "acres": 69.32}, {"name": "HOSPITAL VMP", "year": 1997, "acres": 31.00481}, {"name": "CRESTMONT VMP", "year": 1995, "acres": 132.6762}, {"name": "CRESTMONT VMP", "year": 1994, "acres": 100.7093}, {"name": "HOWELL MTN.", "year": 1983, "acres": 2353.552}, {"name": "HOWELL MTN. FIRE", "year": 1983, "acres": 2353.55}, {"name": "ROADSIDE #14", "year": 1964, "acres": 230.77}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$901,948", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 126272.76, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$126,273/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.4494, 38.576]}, "properties": {"property": "Angwin - Howell Mountain Rd", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$49,354/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "HILLCREST", "year": 2016, "acres": 17.34528}, {"name": "GARAGE ", "year": 2015, "acres": 27.71869}, {"name": "DEER", "year": 2008, "acres": 233.1}, {"name": "HOSPITAL VMP", "year": 1997, "acres": 31.00481}, {"name": "CRESTMONT VMP", "year": 1995, "acres": 132.6762}, {"name": "WILDLAKE VMP", "year": 1994, "acres": 26.94897}, {"name": "CRESTMONT VMP", "year": 1994, "acres": 100.7093}, {"name": "WILDLAKE VMP", "year": 1993, "acres": 55.50236}, {"name": "HOWELL MTN.", "year": 1983, "acres": 2353.552}, {"name": "HOWELL MTN. FIRE", "year": 1983, "acres": 2353.55}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$396,608", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 49353.93, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$49,354/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.5461, 38.413]}, "properties": {"property": "Kenwood - Warm Springs Rd", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$32,448/yr", "wildfire_damage_prob": "86%", "historical_fires_nearby": [{"name": "Nuns", "year": 2017, "acres": 56556.18}, {"name": "SUGARLOAF VMP", "year": 1995, "acres": 203.7137}, {"name": "ANNADEL", "year": 1995, "acres": 80.16077}, {"name": "KINNEY BROOK VMP", "year": 1983, "acres": 61.31641}, {"name": "BELTANE CMP", "year": 1982, "acres": 67.88553}, {"name": "NUNS CANYON", "year": 1964, "acres": 9807.69}, {"name": "Unknown", "year": 1946, "acres": 781.73}, {"name": null, "year": 1946, "acres": 781.7254}], "canopy_cover_pct": 55.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$210,981", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 32448.28, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$32,448/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.5241, 38.3646]}, "properties": {"property": "Glen Ellen - Arnold Dr", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$12,490/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Prescribed Burn", "year": 2019, "acres": 19.02423}, {"name": "Nuns", "year": 2017, "acres": 56556.18}, {"name": "MAY ACR BURN", "year": 2017, "acres": 16.8516}, {"name": "SONOMA", "year": 2007, "acres": 13.87}, {"name": "PG&E #8", "year": 1996, "acres": 2106.75}, {"name": "BELTANE CMP", "year": 1982, "acres": 67.88553}, {"name": "NUNS CANYON", "year": 1964, "acres": 9807.69}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$200,676", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 12490.09, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$12,490/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.7127, 38.4396]}, "properties": {"property": "Downtown Santa Rosa - 4th St", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$155,501/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$8,755,687", "building_type": "commercial concrete", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 155501.0, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$155,501/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.7215, 38.4362]}, "properties": {"property": "Santa Rosa - Railroad Square", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$49,473/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "Tubbs", "year": 2017, "acres": 36807.37}, {"name": "C. HANLY", "year": 1964, "acres": 55960.7}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$2,785,629", "building_type": "industrial concrete", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 49472.78, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$49,473/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.2857, 38.2986]}, "properties": {"property": "Downtown Napa - 1st St", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$107,263/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "SYAR", "year": 2018, "acres": 10.19067}, {"name": "ATLAS", "year": 2017, "acres": 51624.66}, {"name": "B. HICKEY", "year": 1953, "acres": 671.41}], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "500-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$4,020,368", "building_type": "commercial concrete", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 107263.41, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$107,263/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.281, 38.2932]}, "properties": {"property": "Napa - Soscol Ave riverfront", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$165,674/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "SYAR", "year": 2018, "acres": 10.19067}, {"name": "Atlas", "year": 2017, "acres": 42349.2}, {"name": "J. TUTEUR", "year": 1953, "acres": 186.85}, {"name": "B. HICKEY", "year": 1953, "acres": 671.41}], "canopy_cover_pct": 0.0, "flood_risk": "HIGH", "flood_zone": "Zone AE", "flood_annual_loss": "$13,371/yr", "in_sfha": "Yes", "flood_return_period": "100-yr", "flood_total_loss_100yr": "$1,337,136", "confidence": "HIGH (90%)", "replacement_value": "$4,659,010", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 165674.39, "flood_annual_loss_usd": 13371.36, "combined_annual_exposure": "$179,046/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.2833, 38.2871]}, "properties": {"property": "Napa - Riverside Dr", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$7,686/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "SYAR", "year": 2018, "acres": 10.19067}, {"name": "Atlas", "year": 2017, "acres": 42349.2}, {"name": "J. TUTEUR", "year": 1953, "acres": 186.85}, {"name": "B. HICKEY", "year": 1953, "acres": 671.41}], "canopy_cover_pct": 0.0, "flood_risk": "HIGH", "flood_zone": "Zone AE", "flood_annual_loss": "$746/yr", "in_sfha": "Yes", "flood_return_period": "100-yr", "flood_total_loss_100yr": "$74,571", "confidence": "HIGH (90%)", "replacement_value": "$216,149", "building_type": "residential wood frame", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 7686.26, "flood_annual_loss_usd": 745.71, "combined_annual_exposure": "$8,432/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.9958, 38.5019]}, "properties": {"property": "Guerneville - Main St", "wildfire_risk": "HIGH", "wildfire_annual_loss": "$101,392/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [{"name": "ROADSIDE #44", "year": 1961, "acres": 5968.04}, {"name": "Unknown", "year": 1946, "acres": 629.18}, {"name": null, "year": 1946, "acres": 629.181}, {"name": null, "year": 1945, "acres": 349.0112}, {"name": "Unknown", "year": 1945, "acres": 349.01}, {"name": "Unknown", "year": 1943, "acres": 1218.93}, {"name": null, "year": 1943, "acres": 1218.93}], "canopy_cover_pct": 0.0, "flood_risk": "HIGH", "flood_zone": "Zone AE", "flood_annual_loss": "$2,949/yr", "in_sfha": "Yes", "flood_return_period": "100-yr", "flood_total_loss_100yr": "$294,857", "confidence": "HIGH (90%)", "replacement_value": "$1,629,042", "building_type": "residential masonry", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 101391.58, "flood_annual_loss_usd": 2948.57, "combined_annual_exposure": "$104,340/yr"}}, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-122.8899, 38.4735]}, "properties": {"property": "Forestville - River Rd", "wildfire_risk": "LOW", "wildfire_annual_loss": "$0/yr", "wildfire_damage_prob": "40%", "historical_fires_nearby": [], "canopy_cover_pct": 0.0, "flood_risk": "LOW", "flood_zone": "Zone X", "flood_annual_loss": "$0/yr", "in_sfha": "No", "flood_return_period": "1000-yr", "flood_total_loss_100yr": "$0", "confidence": "HIGH (90%)", "replacement_value": "$210,148", "building_type": "commercial concrete", "value_source": "USACE National Structure Inventory", "assessment_source": "Abelian 0.2.0 hazard module", "confidence_note": "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). Lower confidence than FSim \u2014 verify before relying.", "wildfire_annual_loss_usd": 0.0, "flood_annual_loss_usd": 0.0, "combined_annual_exposure": "$0/yr"}}]};
;if (typeof window !== "undefined" && window.APP && window.APP.boot) {}
