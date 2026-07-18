"""Canonical hazard-result flattening + Felt style for portfolio workflows.

Single source of truth shared by:
  - the API's POST /portfolio/analyze (this package)
  - the demo pipeline at demo/felt-pipeline/pipeline.py (imports via path)

Flattens score_hazard()'s nested response into the flat property schema the
Felt popup and the wrapper page parse. Changing a key here changes the data
contract for both consumers — update the wrapper's parsers in step.
"""
from __future__ import annotations

from typing import Any


def _usd(v: Any) -> str:
    return "N/A" if v is None else f"${v:,.0f}/yr"


def _usd_flat(v: Any) -> str:
    return "N/A" if v is None else f"${v:,.0f}"


def _pct(v: Any) -> str:
    return "N/A" if v is None else f"{round(v * 100)}%"


def flatten_hazard(name: str, resp: dict) -> dict:
    """Nested score_hazard() response → flat popup/wrapper property dict."""
    wf = resp.get("wildfire") or {}
    fl = resp.get("flood") or {}
    conf = resp.get("confidence") or {}
    dmg = fl.get("damage") or {}

    props: dict[str, Any] = {
        "property": name,
        "wildfire_risk": wf.get("risk_tier") or "CANNOT ASSESS",
        "wildfire_annual_loss": _usd(wf.get("annual_risk_usd")),
        "wildfire_damage_prob": _pct(wf.get("damage_probability")),
        "historical_fires_nearby": wf.get("historical_fires"),
        "canopy_cover_pct": wf.get("canopy_cover_pct"),
        "flood_risk": fl.get("risk_tier")
        or ("LOW" if fl.get("available") else "CANNOT ASSESS"),
        "flood_zone": (f"Zone {fl.get('flood_zone')}" if fl.get("flood_zone")
                       else "Unmapped"),
        "flood_annual_loss": _usd(fl.get("annual_risk_usd")),
        "in_sfha": "Yes" if fl.get("in_special_flood_hazard_area") else "No",
        "flood_return_period": (f"{fl.get('return_period_years')}-yr"
                                if fl.get("return_period_years") else "N/A"),
        "flood_total_loss_100yr": _usd_flat(dmg.get("total_loss_usd")),
        "confidence": (f"{conf.get('tier', 'N/A')} ({_pct(conf.get('composite'))})"
                       if conf.get("tier") else "N/A"),
        "replacement_value": _usd_flat(wf.get("nsi_replacement_value")
                                       or fl.get("nsi_replacement_value")),
        "building_type": (wf.get("nsi_building_type")
                          or fl.get("nsi_building_type")
                          or "No structure matched"),
        "value_source": wf.get("nsi_source") or fl.get("nsi_source") or "N/A",
        "assessment_source": (
            f"Abelian {resp.get('module_version', 'v1')} hazard module"),
    }
    if wf.get("method") == "proxy_fallback":
        props["confidence_note"] = (
            "Proxy wildfire estimate (NIFC frequency x LANDFIRE fuel/canopy). "
            "Lower confidence than FSim \u2014 verify before relying.")
    gaps = conf.get("gaps") or []
    if gaps:
        props["data_gaps"] = "; ".join(
            g.get("message", g.get("display_name", str(g)))
            if isinstance(g, dict) else str(g) for g in gaps)[:500]
    props["wildfire_annual_loss_usd"] = wf.get("annual_risk_usd")
    props["flood_annual_loss_usd"] = fl.get("annual_risk_usd")
    both = [v for v in (wf.get("annual_risk_usd"), fl.get("annual_risk_usd"))
            if v is not None]
    props["combined_annual_exposure"] = _usd(sum(both)) if both else "N/A"
    return {k: v for k, v in props.items() if v is not None}


def portfolio_summary(features: list[dict]) -> dict:
    """Summary-strip math. Mirrors the wrapper's APP.model() computation."""
    total = 0.0
    high = flood = 0
    for f in features:
        p = f["properties"]
        total += (p.get("wildfire_annual_loss_usd") or 0)
        total += (p.get("flood_annual_loss_usd") or 0)
        if p.get("wildfire_risk") == "HIGH":
            high += 1
        if p.get("in_sfha") == "Yes":
            flood += 1
    return {
        "property_count": len(features),
        "high_wildfire": high,
        "flood_exposed": flood,
        "total_annual_exposure": round(total, 2),
    }


# ── Felt Style Language for the portfolio layer (shared verbatim) ──────────
FSL_PORTFOLIO: dict = {
    "version": "2.3",
    "type": "categorical",
    "config": {
        "categoricalAttribute": "wildfire_risk",
        "categories": ["HIGH", "MODERATE", "LOW", "CANNOT ASSESS"],
        "showOther": False,
    },
    "paint": {
        "color": ["#c62828", "#f9a825", "#2e7d32", "#9e9e9e"],
        "size": 14, "strokeColor": "#ffffff", "strokeWidth": 1.5,
        "isClickable": True, "isHoverable": True,
    },
    "legend": {},
    "popup": {
        "type": "attributes",
        "popupLocation": "rightSidebar",
        "popupLayout": "list",
        "titleAttribute": "property",
        "keyAttributes": [
            "wildfire_risk", "wildfire_annual_loss", "wildfire_damage_prob",
            "flood_risk", "flood_zone", "flood_annual_loss",
            "combined_annual_exposure", "confidence",
            "replacement_value", "building_type", "value_source",
            "confidence_note", "data_gaps", "assessment_source",
        ],
    },
    "attributes": {
        "wildfire_risk": {"displayName": "Wildfire risk"},
        "wildfire_annual_loss": {"displayName": "Wildfire est. annual loss"},
        "wildfire_damage_prob": {"displayName": "Damage probability"},
        "flood_risk": {"displayName": "Flood risk"},
        "flood_zone": {"displayName": "FEMA flood zone"},
        "flood_annual_loss": {"displayName": "Flood est. annual loss"},
        "combined_annual_exposure": {"displayName": "Combined annual exposure"},
        "confidence": {"displayName": "Assessment confidence"},
        "replacement_value": {"displayName": "Replacement value"},
        "building_type": {"displayName": "Structure"},
        "value_source": {"displayName": "Valuation source"},
        "confidence_note": {"displayName": "Confidence note"},
        "data_gaps": {"displayName": "Data gaps"},
        "assessment_source": {"displayName": "Assessment"},
    },
}
