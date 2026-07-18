#!/usr/bin/env python3
"""Abelian → Felt portfolio hazard demo pipeline.

Usage:
  python pipeline.py score      [--api URL] [--pace SECONDS] [--mock]
  python pipeline.py assemble
  python pipeline.py reference
  python pipeline.py publish    [--map-id ID]   (needs FELT_API_TOKEN)
  python pipeline.py all        [--mock]

Scores are cached in scores/ per-property, so interrupted runs resume
without re-burning the 10/hour rate limit on the deployed API.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).parent
SCORES_DIR = ROOT / "scores"
OUT_DIR = ROOT / "out"
PORTFOLIO_CSV = ROOT / "portfolio.csv"

DEFAULT_API = os.getenv("ABELIAN_API", "https://heavi-production.up.railway.app")

# ─── helpers ─────────────────────────────────────────────────────────────

def load_portfolio() -> list[dict]:
    with open(PORTFOLIO_CSV, newline="") as f:
        return [
            {**row, "latitude": float(row["latitude"]),
             "longitude": float(row["longitude"])}
            for row in csv.DictReader(f)
        ]


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name)[:60]


def usd(v) -> str:
    return "N/A" if v is None else f"${v:,.0f}/yr"


def usd_flat(v) -> str:
    return "N/A" if v is None else f"${v:,.0f}"


def pct(v) -> str:
    return "N/A" if v is None else f"{round(v * 100)}%"


# ─── step 1: score ───────────────────────────────────────────────────────

def _is_cached(p: dict, mock: bool) -> bool:
    f = SCORES_DIR / f"{slug(p['name'])}.json"
    if not f.exists():
        return False
    if not mock:  # real runs must never count a cached mock as scored
        try:
            if json.loads(f.read_text()).get("module_version") == "v2-mock":
                return False
        except Exception:
            return False
    return True


def score(api: str, pace: float, mock: bool) -> None:
    SCORES_DIR.mkdir(exist_ok=True)
    portfolio = load_portfolio()
    todo = [p for p in portfolio if not _is_cached(p, mock)]
    print(f"{len(portfolio)} properties, {len(todo)} to score "
          f"({len(portfolio) - len(todo)} cached)")

    if mock:
        from mock_scores import mock_hazard_response
        for p in todo:
            resp = mock_hazard_response(p)
            (SCORES_DIR / f"{slug(p['name'])}.json").write_text(json.dumps(resp, indent=1))
            print(f"  [mock] {p['name']}")
        return

    with httpx.Client(timeout=120) as client:
        h = client.get(f"{api}/health")
        h.raise_for_status()
        print(f"API health: {h.json()}")
        for i, p in enumerate(todo):
            r = client.post(f"{api}/hazard/score-v2",
                            json={"latitude": p["latitude"], "longitude": p["longitude"]})
            if r.status_code == 429:
                print(f"  RATE LIMITED at {p['name']} — rerun later; "
                      f"{len(todo) - i} remaining (cache preserves progress)")
                sys.exit(1)
            r.raise_for_status()
            (SCORES_DIR / f"{slug(p['name'])}.json").write_text(json.dumps(r.json(), indent=1))
            wf = r.json().get("wildfire", {})
            print(f"  {p['name']}: wildfire={wf.get('risk_tier')} "
                  f"({usd(wf.get('annual_risk_usd'))})")
            if i < len(todo) - 1 and pace:
                time.sleep(pace)


# ─── step 2: assemble GeoJSON (flat properties) ──────────────────────────

# Flattening + FSL are shared with the API (single source of truth):
# packages/api/app/portfolio_flatten.py. Load by path so this script works
# from a bare repo checkout without installing the API package.
import importlib.util as _ilu
_pf_path = ROOT.parent.parent / "packages" / "api" / "app" / "portfolio_flatten.py"
if not _pf_path.exists():          # running outside the repo tree
    _pf_path = ROOT / "portfolio_flatten.py"
_spec = _ilu.spec_from_file_location("portfolio_flatten", _pf_path)
_pf = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_pf)
flatten_hazard, FSL_PORTFOLIO = _pf.flatten_hazard, _pf.FSL_PORTFOLIO


def flatten(p, resp):
    return flatten_hazard(p["name"], resp)


def assemble() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    features = []
    for p in load_portfolio():
        f = SCORES_DIR / f"{slug(p['name'])}.json"
        if not f.exists():
            print(f"  SKIP (unscored): {p['name']}")
            continue
        resp = json.loads(f.read_text())
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [p["longitude"], p["latitude"]]},
            "properties": flatten(p, resp),
        })
    out = OUT_DIR / "portfolio_hazard.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=1))
    tiers = [f["properties"]["wildfire_risk"] for f in features]
    print(f"Wrote {out} — {len(features)} features "
          f"(HIGH={tiers.count('HIGH')}, MODERATE={tiers.count('MODERATE')}, "
          f"LOW={tiers.count('LOW')})")


# ─── step 3: reference layers (federal services directly, no Abelian) ────

NORTH_BAY_BBOX = (-123.10, 38.20, -122.20, 38.80)  # w, s, e, n

def _tiles(bbox, nx=6, ny=4):
    w, s, e, n = bbox
    dx, dy = (e - w) / nx, (n - s) / ny
    for i in range(nx):
        for j in range(ny):
            yield (w + i * dx, s + j * dy, w + (i + 1) * dx, s + (j + 1) * dy)


def _arcgis_query(client, url, bbox, out_fields, where, per_tile=500, offset=None):
    """Tiled ArcGIS envelope query — large envelopes 500 on FEMA's server.
    `offset` (degrees) enables server-side geometry generalization."""
    feats = []
    for (tw, ts, te, tn) in _tiles(bbox):
        params = {
            "geometry": f"{tw},{ts},{te},{tn}", "geometryType": "esriGeometryEnvelope",
            "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outSR": "4326",
            "f": "geojson", "outFields": out_fields, "where": where,
            "resultRecordCount": str(per_tile)}
        if offset:
            params["maxAllowableOffset"] = str(offset)
        r = client.get(url, params=params)
        r.raise_for_status()
        feats.extend(r.json().get("features", []))
    return feats


def reference() -> None:
    """FEMA NFHL flood zones + CAL FIRE FRAP fire perimeters, fetched straight
    from the public ArcGIS services (bypasses the Abelian API). NIFC's
    all-years view is stale (nothing after 2019), so fire history comes from
    FRAP, which has Glass/Hennessey/Walbridge 2020."""
    OUT_DIR.mkdir(exist_ok=True)
    with httpx.Client(timeout=180) as client:
        flood = _arcgis_query(
            client,
            "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
            NORTH_BAY_BBOX, "FLD_ZONE,ZONE_SUBTY,STATIC_BFE",
            "FLD_ZONE IN ('A','AE','AH','AO','VE')",  # SFHA only — keeps it legible
            offset=0.0001)  # ~10m generalization
        (OUT_DIR / "fema_flood_zones.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": flood}))
        print(f"  fema_flood_zones.geojson: {len(flood)} features")

        fires = _arcgis_query(
            client,
            "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/"
            "California_Historic_Fire_Perimeters/FeatureServer/0/query",
            NORTH_BAY_BBOX, "FIRE_NAME,YEAR_,GIS_ACRES,ALARM_DATE",
            "YEAR_ >= 2015 AND GIS_ACRES > 5000",  # major fires only
            offset=0.0002)
        seen, uniq = set(), []
        for f in fires:  # perimeters span tiles → dedupe
            k = (f["properties"].get("FIRE_NAME"), f["properties"].get("YEAR_"))
            if k not in seen:
                seen.add(k)
                uniq.append(f)
        (OUT_DIR / "fire_perimeters.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": uniq}))
        names = sorted({f["properties"]["FIRE_NAME"] for f in uniq})
        print(f"  fire_perimeters.geojson: {len(uniq)} major fires: {names}")


# ─── step 4: publish to Felt ─────────────────────────────────────────────

FSL_FLOOD_ZONES = {
    "version": "2.3", "type": "simple",
    "paint": {"color": "#1976d2", "opacity": 0.15,
              "strokeColor": "#1976d2", "strokeWidth": 0.8, "isClickable": True},
    "legend": {}, "popup": {"titleAttribute": "FLD_ZONE"},
}

FSL_FIRE_PERIMETERS = {
    "version": "2.3", "type": "simple",
    "paint": {"color": "#e64a19", "opacity": 0.15,
              "strokeColor": "#bf360c", "strokeWidth": 0.8, "isClickable": True},
    "legend": {},
    "popup": {"titleAttribute": "FIRE_NAME",
              "keyAttributes": ["YEAR_", "GIS_ACRES", "ALARM_DATE"]},
    "attributes": {"YEAR_": {"displayName": "Year"},
                   "GIS_ACRES": {"displayName": "Acres",
                                 "format": {"mantissa": 0, "thousandSeparated": True}},
                   "ALARM_DATE": {"displayName": "Ignition date"}},
}


def _wait_for_layer(map_id: str, layer_id: str, timeout: int = 600) -> None:
    from felt_python import get_layer
    t0 = time.time()
    while time.time() - t0 < timeout:
        details = get_layer(map_id, layer_id)
        status = details.get("status") or details.get("progress")
        if status == "completed":
            return
        if status == "failed":
            raise RuntimeError(f"Layer {layer_id} failed processing: {details}")
        time.sleep(5)
    raise TimeoutError(f"Layer {layer_id} still processing after {timeout}s")


def publish(map_id: str | None) -> None:
    from felt_python import create_map, upload_file, update_layer_style, list_layers

    if not os.getenv("FELT_API_TOKEN"):
        sys.exit("Set FELT_API_TOKEN (Workspace Settings → Developers)")

    if not map_id:
        m = create_map(
            title="Portfolio Hazard Review — North Bay Properties",
            lat=38.45, lon=-122.65, zoom=10,
            public_access="view_and_comment",
        )
        map_id = m["id"]
        print(f"Created map {map_id}: {m['url']}")

    uploads = [
        ("portfolio_hazard.geojson", "Portfolio Properties", FSL_PORTFOLIO),
        ("fema_flood_zones.geojson", "FEMA Flood Zones (SFHA)", FSL_FLOOD_ZONES),
        ("fire_perimeters.geojson", "Fire History 2015+ (NIFC)", FSL_FIRE_PERIMETERS),
    ]
    for fname, layer_name, fsl in uploads:
        path = OUT_DIR / fname
        if not path.exists():
            print(f"  SKIP missing {fname}")
            continue
        resp = upload_file(str(map_id), str(path), layer_name)
        layer_id = resp.get("layer_id") or resp.get("id")
        print(f"  uploaded {layer_name} → layer {layer_id}, processing…")
        _wait_for_layer(map_id, layer_id)
        update_layer_style(map_id, layer_id, fsl)
        print(f"  styled {layer_name}")

    print(f"\nDone → https://felt.com/map/{map_id}")


# ─── main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["score", "assemble", "reference", "publish", "all"])
    ap.add_argument("--api", default=DEFAULT_API)
    ap.add_argument("--pace", type=float, default=0.0,
                    help="seconds between scoring calls (use ~370 for the "
                         "deployed API's 10/hour limit)")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--map-id", default=None)
    a = ap.parse_args()

    if a.cmd in ("score", "all"):
        score(a.api, a.pace, a.mock)
    if a.cmd in ("assemble", "all"):
        assemble()
    if a.cmd in ("reference", "all"):
        reference()
    if a.cmd == "publish" or (a.cmd == "all" and os.getenv("FELT_API_TOKEN")):
        publish(a.map_id)
