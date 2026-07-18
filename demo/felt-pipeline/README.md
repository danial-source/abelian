# Felt Portfolio Hazard Demo Pipeline

CSV of properties → Abelian hazard scores → flat-property GeoJSON → styled
Felt map with FEMA + CAL FIRE reference layers.

## Setup
```bash
pip install httpx felt-python
export FELT_API_TOKEN=...        # Felt Workspace Settings → Developers
export ABELIAN_API=https://abelian-api-demo.onrender.com   # or --api flag
```

## Run
```bash
python pipeline.py score          # scores portfolio.csv (cached in scores/)
python pipeline.py assemble       # scores/ → out/portfolio_hazard.geojson
python pipeline.py reference      # FEMA NFHL + CAL FIRE FRAP → out/
python pipeline.py publish        # creates styled Felt map, prints URL
python pipeline.py all            # everything
```
`--mock` on score validates the pipeline without the API (never for real maps —
real runs auto-rescore anything cached from mock mode).
`--pace 370` spaces scoring calls for rate-limited deployments.
`publish --map-id <id>` adds layers to an existing map instead of creating one.

## State of the demo (July 18, 2026)
- Live map: https://felt.com/map/UfY5hIcFSimAypc8UNlkoB (view_and_comment)
- API: abelian-api-demo.onrender.com (this branch, Render starter, Supabase PostGIS)
- scores/ contains the real API responses from the demo run (provenance record)
- gap_analysis.md documents workarounds + productization gaps
- Solar variant blocked on a valid NREL/NLR key (developer.nlr.gov/signup)
