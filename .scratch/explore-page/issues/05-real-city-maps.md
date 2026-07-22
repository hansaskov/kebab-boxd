# 05 — Real server-rendered city maps

**What to build:** The plain coordinate grid from ticket 02 is replaced by a real map artifact per city: server-rendered from a popular geospatial dataset (OSM-derived), cached on disk per city, with the cache invalidated when a Restaurant is approved or added for that city. Marker rendering and the coordinate-projection interface are unchanged — the artifact swaps in behind them — and the grid remains as the fallback for cities without map data. The exact dataset and artifact format (GeoJSON-sourced SVG vs. static image) are chosen during implementation under the constraints: popular dataset, server-rendered, pre-renderable, no client JS.

**Blocked by:** 02 — City view

**Status:** ready-for-agent

- [ ] Map artifact generated server-side per city from an OSM-derived dataset; no client-side JavaScript and no external request at page-load time
- [ ] Artifacts cached on disk: first request generates, subsequent requests reuse
- [ ] Cache invalidated when a Restaurant is approved or added for that city
- [ ] Markers render correctly over the real map via the existing projection interface and bounding box
- [ ] Cities without map data fall back to the coordinate grid
- [ ] HTTP-seam tests cover: artifact presence for a mapped city, fallback for an unmapped city, marker positions consistent across both

## Comments
