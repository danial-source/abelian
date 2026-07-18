"""Portfolio hazard pipeline: CSV upload → concurrent v2 hazard scoring →
flattened GeoJSON → published Felt map.

Endpoints in main.py compose this module:
  POST /portfolio/analyze          → start_job()  → {job_id}
  GET  /portfolio/analyze/{id}     → job_status() → progress / result

Job storage is a process-local TTL dict (same trade-off as portfolio_risk.py:
survives the worker, not a restart, single-instance only — fine for the demo,
recorded in the gap analysis). Scoring is asyncio-concurrent with a semaphore
of 5 to stay polite to the upstream federal services (NFHL/NSI/3DEP/NIFC/
LANDFIRE). The FELT_API_TOKEN is read from the environment server-side and
never leaves this process.
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
import httpx

from .hazard_scoring_v2 import score_hazard
from .portfolio_flatten import FSL_PORTFOLIO, flatten_hazard, portfolio_summary

MAX_ROWS = 50
SCORING_CONCURRENCY = 5
JOB_TTL = timedelta(hours=2)
FELT_API = "https://felt.com/api/v2"
# Continental US bounds (matches the validation promise in the wrapper docs).
CONUS = {"lat": (24.4, 49.5), "lng": (-125.0, -66.9)}


# ─── Job cache ──────────────────────────────────────────────────────────────

@dataclass
class AnalyzeJob:
    job_id: str
    portfolio_name: str
    total: int
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc))
    status: str = "scoring"          # scoring | publishing | complete | failed
    done: int = 0
    errors: list[dict] = field(default_factory=list)
    result: dict | None = None
    failure: str | None = None


JOBS: dict[str, AnalyzeJob] = {}


def _prune_jobs() -> None:
    cutoff = datetime.now(timezone.utc) - JOB_TTL
    for k in [k for k, j in JOBS.items() if j.created_at < cutoff]:
        JOBS.pop(k, None)


# ─── CSV parsing + validation ───────────────────────────────────────────────

class PortfolioValidationError(ValueError):
    pass


def parse_portfolio_csv(raw: bytes) -> list[dict]:
    """CSV → validated rows. Columns: name (or address) + latitude/longitude,
    or address alone (geocoded later). Raises PortfolioValidationError with a
    user-facing message on structural problems."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise PortfolioValidationError("CSV must be UTF-8 encoded.")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise PortfolioValidationError("CSV has no header row.")
    cols = {c.strip().lower() for c in reader.fieldnames if c}
    has_coords = {"latitude", "longitude"} <= cols
    has_addr = "address" in cols
    if not (has_coords or has_addr):
        raise PortfolioValidationError(
            "CSV needs either latitude+longitude columns or an address column.")

    rows, seen = [], set()
    for i, r in enumerate(csv.DictReader(io.StringIO(text)), start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        name = r.get("name") or r.get("address") or f"Property {i - 1}"
        lat = lng = None
        if r.get("latitude") and r.get("longitude"):
            try:
                lat, lng = float(r["latitude"]), float(r["longitude"])
            except ValueError:
                raise PortfolioValidationError(
                    f"Row {i}: latitude/longitude are not numbers.")
            if not (CONUS["lat"][0] <= lat <= CONUS["lat"][1]
                    and CONUS["lng"][0] <= lng <= CONUS["lng"][1]):
                raise PortfolioValidationError(
                    f"Row {i} ({name}): coordinates outside continental US "
                    f"bounds ({lat}, {lng}).")
            key = (round(lat, 6), round(lng, 6))
            if key in seen:
                raise PortfolioValidationError(
                    f"Row {i} ({name}): duplicate coordinates.")
            seen.add(key)
        elif not r.get("address"):
            raise PortfolioValidationError(
                f"Row {i}: needs latitude+longitude or an address.")
        rows.append({"name": name, "lat": lat, "lng": lng,
                     "address": r.get("address") or None})

    if not rows:
        raise PortfolioValidationError("CSV contains no data rows.")
    if len(rows) > MAX_ROWS:
        raise PortfolioValidationError(
            f"Portfolio is capped at {MAX_ROWS} properties for v1; "
            f"got {len(rows)}. Split the file and run in batches.")
    return rows


# ─── Felt publishing (async, token stays server-side) ──────────────────────

async def _felt(client: httpx.AsyncClient, method: str, path: str,
                **kw) -> dict:
    token = os.environ["FELT_API_TOKEN"]
    r = await client.request(
        method, f"{FELT_API}{path}",
        headers={"Authorization": f"Bearer {token}"}, **kw)
    r.raise_for_status()
    return r.json()


async def publish_to_felt(features: list[dict], title: str) -> dict:
    """Create a new map, upload the layer, style it. New-map-per-portfolio by
    design: row-level layer updates need Enterprise Live Data or a full
    re-upload, so each analysis gets its own governed artifact."""
    lats = [f["geometry"]["coordinates"][1] for f in features]
    lngs = [f["geometry"]["coordinates"][0] for f in features]
    geojson_bytes = json.dumps(
        {"type": "FeatureCollection", "features": features}).encode()

    async with httpx.AsyncClient(timeout=120) as client:
        m = await _felt(client, "POST", "/maps", json={
            "title": title,
            "lat": sum(lats) / len(lats), "lon": sum(lngs) / len(lngs),
            "zoom": 9, "public_access": "view_and_comment"})
        map_id = m["id"]

        up = await _felt(client, "POST", f"/maps/{map_id}/upload",
                         json={"name": "Portfolio Properties"})
        layer_id = up["layer_id"]
        s3 = await client.post(
            up["url"], data=up["presigned_attributes"],
            files={"file": ("portfolio.geojson", geojson_bytes,
                            "application/geo+json")})
        s3.raise_for_status()

        for _ in range(60):                       # ≤5 min processing budget
            layer = await _felt(client, "GET",
                                f"/maps/{map_id}/layers/{layer_id}")
            if layer.get("status") == "completed":
                break
            if layer.get("status") == "failed":
                raise RuntimeError(f"Felt layer processing failed: {layer}")
            await asyncio.sleep(5)
        else:
            raise TimeoutError("Felt layer still processing after 5 minutes")

        await _felt(client, "POST",
                    f"/maps/{map_id}/layers/{layer_id}/update_style",
                    json={"style": FSL_PORTFOLIO})
        return {"map_id": map_id, "map_url": m["url"], "layer_id": layer_id}


# ─── Orchestration ──────────────────────────────────────────────────────────

async def _geocode_rows(rows: list[dict], job: AnalyzeJob) -> list[dict]:
    """Fill coordinates for address-only rows via the shared geocoder. A row
    that fails geocoding is recorded in job.errors, not fatal to the batch."""
    need = [r for r in rows if r["lat"] is None]
    if not need:
        return rows
    from .portfolio_risk import _geocode_one  # shared Mapbox/Nominatim path
    ok = []
    async with httpx.AsyncClient(timeout=20) as client:
        for r in rows:
            if r["lat"] is not None:
                ok.append(r)
                continue
            g = await _geocode_one(client, r["address"])
            if not g:
                job.errors.append(
                    {"property": r["name"],
                     "error": f"Could not geocode: {r['address']}"})
                continue
            r["lat"], r["lng"] = g[0], g[1]
            if not (CONUS["lat"][0] <= r["lat"] <= CONUS["lat"][1]
                    and CONUS["lng"][0] <= r["lng"] <= CONUS["lng"][1]):
                job.errors.append(
                    {"property": r["name"],
                     "error": "Geocoded outside continental US."})
                continue
            ok.append(r)
            if not os.getenv("MAPBOX_TOKEN"):
                await asyncio.sleep(1.0)          # Nominatim ≤1 req/s
    return ok


async def run_analysis(pool: asyncpg.Pool, job: AnalyzeJob,
                       rows: list[dict]) -> None:
    """Background task: geocode → score concurrently → flatten → publish."""
    try:
        rows = await _geocode_rows(rows, job)
        job.total = len(rows) or job.total
        sem = asyncio.Semaphore(SCORING_CONCURRENCY)

        async def score_one(r: dict) -> dict | None:
            async with sem:
                try:
                    resp = await score_hazard(pool, r["lat"], r["lng"])
                    props = flatten_hazard(r["name"], resp)
                    return {"type": "Feature",
                            "geometry": {"type": "Point",
                                         "coordinates": [r["lng"], r["lat"]]},
                            "properties": props}
                except Exception as e:            # noqa: BLE001
                    job.errors.append({"property": r["name"],
                                       "error": f"{type(e).__name__}: {e}"})
                    return None
                finally:
                    job.done += 1

        features = [f for f in await asyncio.gather(
            *(score_one(r) for r in rows)) if f]
        if not features:
            raise RuntimeError("No properties scored successfully.")

        job.status = "publishing"
        felt = await publish_to_felt(
            features, f"Portfolio Hazard Review \u2014 {job.portfolio_name}")

        job.result = {
            "felt_map_url": felt["map_url"],
            "felt_map_id": felt["map_id"],
            "geojson": {"type": "FeatureCollection", "features": features},
            "summary": portfolio_summary(features),
            "errors": job.errors,
        }
        job.status = "complete"
    except Exception as e:                        # noqa: BLE001
        job.status = "failed"
        job.failure = f"{type(e).__name__}: {e}"


def start_job(pool: asyncpg.Pool, raw_csv: bytes,
              portfolio_name: str) -> dict:
    """Validate synchronously (fast 400s), then score in the background."""
    _prune_jobs()
    rows = parse_portfolio_csv(raw_csv)           # raises → 400 in main.py
    job = AnalyzeJob(job_id=uuid.uuid4().hex[:12],
                     portfolio_name=portfolio_name.strip() or "Untitled",
                     total=len(rows))
    JOBS[job.job_id] = job
    asyncio.get_event_loop().create_task(run_analysis(pool, job, rows))
    return {"job_id": job.job_id, "total": job.total}


def job_status(job_id: str) -> dict | None:
    job = JOBS.get(job_id)
    if not job:
        return None
    out: dict[str, Any] = {
        "job_id": job.job_id, "status": job.status,
        "progress": {"done": job.done, "total": job.total},
        "errors": job.errors,
    }
    if job.status == "complete":
        out["result"] = job.result
    if job.status == "failed":
        out["failure"] = job.failure
    return out
