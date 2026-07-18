# Portfolio Hazard Review — wrapper page

Static page embedding the Felt map with workflow context. `app.js` is
generated: `app_logic.js` + the bundled GeoJSON appended as
`globalThis.APP.GEOJSON`. To swap portfolios: regenerate app.js from a new
GeoJSON and update APP.CONFIG (title, feltMapId) in app_logic.js.
Detail panel is v1 (bundled data); live re-score path is a future add.
Deployed as a Render static site from this directory.
