# 04 — Nearby-cities sidebar with radius slider

**What to build:** Beside the map, a sidebar lists the top 5 cities by Restaurant count (counts shown) within `?radius=` km (default 50; allowed steps 5/10/25/50/100) of the current city's Restaurant centroid, excluding the current city. Each city is an anchor link that switches the viewed city (preserving the active filter, dropping `page`). The radius control is a DaisyUI `range` input with an Apply submit button inside a GET form — a hidden input preserves the current city — working entirely without JavaScript.

**Blocked by:** 02 — City view

**Status:** ready-for-agent

- [ ] Sidebar shows up to 5 nearby cities ordered by Restaurant count descending, each displaying its count, current city excluded
- [ ] Distance computed via haversine from the current city's Restaurant centroid; a city's centroid derives from its Restaurants' coordinates (no schema change)
- [ ] `?radius=` accepts 5/10/25/50/100, defaulting to 50; out-of-range values fall back to the default
- [ ] Radius control: DaisyUI `range` input + Apply button in a GET form, hidden `city` input, no JavaScript
- [ ] City links switch `?city=`, preserving `filter` and dropping `page`
- [ ] Empty state when no cities fall within the radius
- [ ] HTTP-seam tests cover: ordering, top-5 limit, radius steps and fallback, current-city exclusion, link parameters, empty state

## Comments
