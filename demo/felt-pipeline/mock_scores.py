"""Mock hazard responses matching hazard_scoring_v2.score_hazard()'s exact
schema, keyed off the portfolio CSV's `note` column. For pipeline validation
only — never for the actual demo map."""
from __future__ import annotations


def _tier(annual: float | None) -> str | None:
    if annual is None:
        return None
    return "HIGH" if annual > 500 else "MODERATE" if annual >= 50 else "LOW"


def mock_hazard_response(p: dict) -> dict:
    note = p.get("note", "").lower()
    seed = abs(hash(p["name"])) % 1000

    if "fire" in note and "urban" not in note:
        wf_annual = 800 + seed * 4          # HIGH wildfire
        fires, canopy = 3 + seed % 4, 35 + seed % 40
    elif "urban" in note:
        wf_annual = 5 + seed % 40           # LOW
        fires, canopy = 0, 5 + seed % 10
    else:
        wf_annual = 60 + seed % 400         # MODERATE-ish
        fires, canopy = 1 + seed % 2, 20 + seed % 25

    if "flood" in note:
        fl_annual, zone, sfha = 400 + seed, "AE", True
    else:
        fl_annual, zone, sfha = 0.0, "X", False

    val = 450_000 + seed * 300
    return {
        "module": "hazard_assessment", "module_version": "v2-mock",
        "query": {"latitude": p["latitude"], "longitude": p["longitude"]},
        "wildfire": {
            "available": True, "method": "proxy_fallback",
            "annual_risk_usd": round(wf_annual, 2), "risk_tier": _tier(wf_annual),
            "damage_probability": round(0.3 + (seed % 50) / 100, 3),
            "fire_frequency_per_year": round(fires / 25, 4),
            "historical_fires": fires, "fuel_model_fbfm40": "GR2",
            "canopy_cover_pct": canopy,
            "replacement_value_usd": val,
            "nsi_replacement_value": val,
            "nsi_building_type": "residential wood-frame" if seed % 3 else "commercial masonry",
            "nsi_source": "USACE National Structure Inventory", "nsi_available": True,
            "confidence": 0.72,
            "sources_used": {"wf_likelihood": "nifc_fire_perimeters",
                             "wf_fuel_proximity": "landfire_wcs_fuel",
                             "wf_canopy": "landfire_wcs_canopy"},
            "note": "Proxy/fallback wildfire estimate (mock).",
        },
        "flood": {
            "available": True, "annual_risk_usd": round(fl_annual, 2),
            "risk_tier": _tier(fl_annual), "flood_zone": zone,
            "in_special_flood_hazard_area": sfha,
            "depth_ft": 1.5 if sfha else None,
            "depth_basis": "mock", "static_bfe_ft": 12.0 if sfha else None,
            "ground_elevation_ft": 10.5,
            "annual_exceedance_probability": 0.01 if sfha else 0.002,
            "return_period_years": 100 if sfha else 500,
            "damage": {"hazus_occupancy_class": "RES1-1SNB",
                       "structural_damage_pct": 18.0 if sfha else 0.0,
                       "contents_damage_pct": 24.0 if sfha else 0.0,
                       "structural_loss_usd": round(val * 0.18, 2) if sfha else 0.0,
                       "contents_loss_usd": 30_000.0 if sfha else 0.0,
                       "total_loss_usd": round(val * 0.18 + 30_000, 2) if sfha else 0.0},
            "nsi_replacement_value": val,
            "nsi_building_type": "residential wood-frame",
            "nsi_source": "USACE National Structure Inventory", "nsi_available": True,
            "structure_matched": True,
        },
        "confidence": {
            "tier": "MODERATE", "composite": 0.74,
            "statement": "Mock confidence statement.",
            "completeness": 0.9,
            "gaps": ([{"criterion": "wf_likelihood",
                       "display_name": "Burn probability",
                       "message": "FSim unavailable; NIFC frequency proxy used"}]
                     if "fire" in note else []),
            "strongest_data": "fema_nfhl", "weakest_data": "wf_likelihood",
            "per_criterion": {},
        },
        "methodology": {"workflow_type": "hazard_assessment", "criteria_count": 10},
    }
