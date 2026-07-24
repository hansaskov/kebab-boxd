# 02 — City view: Restaurants as markers on a fallback grid

**What to build:** Visiting `/explore` shows the current city (default Odense; `?city=<name>` switches) with every approved Restaurant in that city rendered as an absolutely positioned anchor marker on a plain bounded coordinate grid derived from the city's Restaurant coordinates. Markers show the RatingAvg (1.0–5.0 display convention), carry a CSS-only tooltip with the Restaurant name, and link to `?city=<city>&highlight=<id>`, which visually highlights that marker. Unknown or empty cities get a clear empty state, and the current city is clearly indicated. The page also gains its responsive shell (map area, nearby-cities slot, timeline slot below; stacked on mobile) and its `prefetchUrls` declaration — real map imagery swaps in later behind the same coordinate-projection interface (`projectToPercent`).

**Blocked by:** 01 — Test infrastructure

**Status:** ready-for-human

- [x] Default view (no params) resolves to Odense; `?city=<name>` switches the viewed city
- [x] Every approved Restaurant in the viewed city renders as a marker positioned by its coordinates via the projection interface; pending/rejected Restaurants never appear
- [x] Markers are anchors showing RatingAvg, with a CSS-only name tooltip, linking to the highlighted view
- [x] `?highlight=<id>` visually distinguishes that Restaurant's marker
- [x] Empty state when the city has no approved Restaurants; current city name displayed
- [x] Page shell: map area + nearby-cities slot + timeline slot, stacked on mobile; `prefetchUrls` declared per AGENTS.md
- [x] HTTP-seam tests cover: default city, city switching, marker presence and position styles, highlight, empty state

## Comments

Implemented: `src/city/directory.ts`, `src/city/map.ts`, explore page shell + markers, HTTP tests in `src/tests/explore-city-view.test.ts`.
