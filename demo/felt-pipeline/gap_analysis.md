# Gap Analysis — Abelian → Felt Portfolio Hazard Demo
*What worked, what needed workarounds, what productization would require. July 18, 2026.*

## What worked cleanly
- Map create → GeoJSON Data Layer upload → FSL styling → share permissions, fully
  programmatic via felt-python. Zero UI touches to produce the finished map.
- FSL expressiveness covered everything the demo needed: categorical tiers, ordered
  popup whitelist (`keyAttributes`), display-name remapping, per-layer translucent
  fills, sidebar popup placement.
- The `upload → poll status → style` loop is reliable; layers processed in seconds
  at these sizes (18 points, 2.3MB flood polygons, 435KB fire perimeters).

## Workarounds required
1. **Abelian's reference-layer proxy wasn't needed and shouldn't be used**: its
   NIFC-derived fire source is stale (nothing after 2019 — no Glass Fire). We fetch
   CAL FIRE FRAP and FEMA NFHL directly from the federal ArcGIS services. FEMA's
   server 500s on large envelopes → tiled queries + `maxAllowableOffset`
   generalization (70MB → 2.3MB).
2. **Tier thresholds don't discriminate in high-hazard regions**: >$500/yr = HIGH
   means 16 of 18 North Bay properties tier HIGH. The visual discrimination lives in
   the dollar spread ($3K–$165K). Shipped with tier colors per spec; raw numeric
   `*_annual_loss_usd` fields are in the layer, so switching to a dollar-graduated
   numeric style is a one-call FSL swap.
3. **The proxy wildfire model is value-driven**: NIFC frequency × LANDFIRE fuel ×
   NSI replacement value means expensive downtown structures out-score cheap WUI
   structures on $/yr (Downtown Santa Rosa $155K vs Coffey Park $3–10K). Honest
   model behavior, but a deal team reading "HIGH" needs the damage-probability and
   replacement-value fields (in the popup) to interpret it. FSim-based scoring
   would change this; the proxy path is what runs today.
4. **NREL → NLR domain migration** (May 29, 2026): code already migrated; the
   deploy doc's signup URL wasn't. Solar map blocked only on a valid NLR key.

## Platform gaps for productizing this workflow
- **No comment creation via API.** REST supports resolve/delete/export + webhooks,
  but a workflow wrapper can't seed comments ("Flag for lender review") or post
  analysis-driven annotations programmatically. The collaboration story starts
  manual.
- **No row-level layer updates.** A monthly re-scored portfolio means full layer
  re-upload (losing comment anchoring to features?) or Enterprise Live Data refresh
  from a hosted URL. For "portfolio that re-scores monthly," the clean pattern is
  hosting the scored GeoJSON at a stable URL and using refresh — which makes the
  wrapper own a hosting responsibility.
- **CANNOT ASSESS is a real state** the wrapper must handle end-to-end: the engine
  returns it (NIFC no-response at one Calistoga property), the map must show it
  (added as a gray category), and a productized version needs retry semantics.

## Demo infrastructure (flagged, per plan)
- API: Render starter ($7/mo), `abelian-api-demo.onrender.com`, felt-demo branch of
  danial-source/abelian (2 commits over upstream: env-gated rate limits, package
  discovery fix; both upstream-mergeable). PYTHON_VERSION=3.12.9 (code uses PEP 701
  f-strings; 3.11 fails).
- Database: personal Supabase PostGIS. A graduated version needs its own data home
  + the federal dataset loading pipeline (scripts in repo) as a real data-eng task.
- Tokens used this cycle (GitHub classic PAT, Render key, Felt PAT) should be
  rotated when the demo cycle closes.
