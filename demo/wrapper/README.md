# Portfolio Hazard Review — wrapper page

Static page embedding the Felt map with workflow context. `app.js` is
generated: `app_logic.js` + the bundled GeoJSON appended as
`globalThis.APP.GEOJSON`. To swap portfolios: regenerate app.js from a new
GeoJSON and update APP.CONFIG (title, feltMapId) in app_logic.js.
Detail panel is v1 (bundled data); live re-score path is a future add.
Deployed to Vercel (project: portfolio-hazard-review, https://portfolio-hazard-review.vercel.app) via file-upload deployments — no git integration; redeploy by POSTing the three files to /v13/deployments.
