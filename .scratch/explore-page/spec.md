# Explore Page

Status: ready-for-agent

## Problem Statement

The `/explore` route is a placeholder: an authenticated User sees a heading and nothing else. There is no way to discover which Restaurants exist in a city, no way to see recent Reviews tied to a place, and no way to search for people, Restaurants, or cities. Discovery — the core promise of the page — is entirely absent. The database already holds everything needed (Location with city and coordinates on every Restaurant, Reviews, Followers, Favorites), but none of it is surfaced.

## Solution

Turn `/explore` into the discovery hub, working entirely without client-side JavaScript:

- **A server-rendered static map** of the currently viewed city (default: Odense, Denmark) with every approved Restaurant in that city shown as a positioned marker displaying its RatingAvg.
- **A nearby-cities sidebar** listing the 5 largest cities within an adjustable radius of the current city; clicking one reloads the page scoped to that city.
- **A city timeline** of the latest Reviews for Restaurants in the viewed city, with mutually exclusive filter tabs (All / Following / Favorites) and button pagination — not infinite scroll.
- **A global search dialog**, opened from a search icon in the header on every page, searching people, Restaurants, and cities from a single input and showing grouped results.

Every interaction is a full page load driven by query parameters, so every view is shareable, bookmarkable, and back-button friendly.

## User Stories

1. As a User, I want to see a map of a city with every kebab Restaurant marked, so that I can understand the geographic spread of restaurants at a glance.
2. As a User, I want each map marker to show the Restaurant's RatingAvg, so that I can spot the best-rated places without clicking anything.
3. As a User, I want the page to default to Odense, Denmark when I haven't chosen a city, so that the page is never empty on first visit.
4. As a User, I want the current city clearly indicated, so that I always know which city's map and timeline I am viewing.
5. As a User, I want to click a Restaurant marker to see that Restaurant highlighted, so that I can connect a map position to a specific place.
6. As a User, I want map markers to be real anchor links, so that I can open a Restaurant's view in a new tab or copy its link.
7. As a User on a slow connection, I want the map to be pre-generated and cached, so that the page loads quickly.
8. As a User, I want a graceful fallback when no map data exists for a city, so that Restaurants are still visible and clickable.
9. As a User, I want to switch cities by clicking a city in the sidebar, so that I can explore restaurants elsewhere.
10. As a User, I want city switching to be a normal link that reloads the page with a query parameter, so that I can share and bookmark a city view.
11. As a User, I want the sidebar to show the 5 cities with the most Restaurants within a radius of the current city, so that suggestions are nearby and likely to have content.
12. As a User, I want to adjust that radius with a slider, so that I can widen or narrow which nearby cities are suggested.
13. As a User, I want each sidebar city to show its Restaurant count, so that I can judge whether it is worth exploring.
14. As a User, I want to see the latest Reviews in the currently viewed city, so that I can discover what people are saying there and find new people to follow.
15. As a User, I want the timeline to only contain Reviews for Restaurants in the viewed city, so that what I read matches what I see on the map.
16. As a User, I want each timeline entry to show the author's avatar and Username, the Restaurant's name, the Rating, an excerpt of the Review, a relative timestamp, and the LikeCount, so that I can judge at a glance whether to read more.
17. As a User, I want to filter the timeline to only Reviews by people I Follow, so that I can keep up with friends' activity in this city.
18. As a User, I want to filter the timeline to only Reviews of my Favorites, so that I can see new activity at Restaurants I love.
19. As a User, I want only one filter active at a time, so that the view is predictable.
20. As a User, I want the filter tabs to be plain links carrying a query parameter, so that I can share a filtered view.
21. As a User, I want button pagination instead of infinite scroll, so that navigation is deterministic and a specific page is linkable.
22. As a User, I want changing city or filter to return me to page 1, so that I never land on a meaningless empty page.
23. As a User, I want changing page to preserve my city, radius, and filter, so that I don't lose my place while browsing.
24. As a User, I want a clear message when a city has no Restaurants, no Reviews, or no results under the active filter, so that I understand why a section is empty.
25. As a User, I want a search icon in the header on every page, so that search is always one click away.
26. As a User, I want clicking the search icon to open a dialog, so that I can search without losing my current context.
27. As a User, I want to search people (by Username), Restaurants (by name), and cities (by name) from a single input, so that I don't have to pick a search type first.
28. As a User, I want search results grouped by type — Restaurants, Cities, People — so that I can scan them quickly.
29. As a User, I want submitting a search to land on the explore page with the dialog open and results inside, so that I can act on them immediately.
30. As a User, I want a city result to take me to that city's explore view, and a Restaurant result to take me to its city view with that Restaurant highlighted, so that search leads directly to discovery.
31. As a User, I want a clear "no results" indication when a search group matches nothing, so that I know the search ran.
32. As a User, I want to close the dialog with a close button or by clicking the backdrop, so that I can return to the page underneath.
33. As a User, I want the whole page to work with client-side JavaScript disabled, so that it is fast, robust, and consistent with the rest of the app.
34. As a User on mobile, I want the sections to stack vertically — map, cities, timeline — so that the page is usable on a small screen.
35. As a logged-out visitor, I want to be redirected to login, so that private social data (Follows, Favorites) is never exposed.

## Implementation Decisions

- **ExplorePage (modified module)** — the `/explore` route, owning this query-parameter contract:
  - `city` (string, optional; default `Odense`) — the viewed city, matched against `Location.city`.
  - `radius` (integer km, optional; default `50`; allowed steps 5/10/25/50/100) — affects the nearby-cities sidebar only, not the map or timeline.
  - `filter` (optional; `followers` | `favorites`; absent = All) — the timeline filter. Exactly one at a time; tabs are anchor links.
  - `page` (integer ≥ 1, optional; default 1) — timeline page.
  - `search` (string, optional) — when present, the search dialog renders open with grouped results.
  - `highlight` (integer Restaurant id, optional) — highlights one Restaurant's marker; set by marker clicks and Restaurant search results.
  - Param-preservation rules: links that change `city` or `filter` drop `page`; pagination links preserve `city`, `radius`, `filter`; `search` and `highlight` never appear in timeline, pagination, or filter links.
- **CityDirectory (new module)** — city-level read queries over Location and Restaurant:
  - `getDefaultCity()` — constant `"Odense"` (future: nearest city to the User's stored coordinates).
  - `getCityCenter(city)` — centroid of the city's Restaurants' coordinates; no city table, no schema change.
  - `getRestaurantsInCity(city)` — approved Restaurants with id, name, RatingAvg, ReviewCount, and coordinates.
  - `getNearbyCities(centerCity, radiusKm)` — distinct cities (excluding the current one) whose centroid is within `radiusKm` (haversine) of the current city's centroid, each with its Restaurant count, ordered by count descending, limited to 5.
  - City identity is the raw `Location.city` string; null-city rows are excluded everywhere.
- **CityMap (new module)** — server-rendered static map per city:
  - `getCityMap(city)` — returns a map artifact (inline SVG or a cached image URL) plus the lat/lng bounding box it covers. Generated from a popular geospatial dataset (OSM-derived), lazily on first request, cached on disk per city; cache invalidated when a Restaurant is approved or added for that city. Build-time pre-rendering of known cities is a permitted optimization.
  - `projectToPercent(lat, lng, bounds)` — maps coordinates to `{x%, y%}` so markers can be absolutely positioned over the map container with inline styles.
  - Markers are anchor elements to `?city=<city>&highlight=<id>`, showing RatingAvg (in the 1.0–5.0 display convention from the glossary), with a CSS-only tooltip for the Restaurant name.
  - Fallback: when no map data exists for a city, render a plain bounded coordinate grid so markers still appear.
- **CityTimeline (new query module)** — `getCityTimeline({city, filter, userId, page, perPage: 10})`:
  - Latest Reviews (newest first) for Restaurants in the viewed city.
  - `filter=followers` restricts to Reviews whose author the current User Follows; `filter=favorites` restricts to Reviews of Restaurants in the current User's Favorites.
  - Applies the ReviewWindow visibility rule from the glossary — only a user's 3 most recent Reviews per Restaurant are publicly surfaced. No existing query code implements this yet; the implementing ticket establishes the canonical visibility predicate.
  - Returns author (Username, profile picture), Restaurant (id, name), Rating, excerpt, createdAt, LikeCount, and the total count needed for pagination.
- **GlobalSearch (new module)** — `search(term)` → `{ restaurants, cities, users }`:
  - Case-insensitive substring matching on Restaurant name, Location city, and Username, capped at 5 results per group.
  - Link targets: city → `?city=<name>`; Restaurant → `?city=<city>&highlight=<id>`; User results render without links (no profile page exists yet — see Further Notes).
- **Header / SearchDialog (modified components)**:
  - The header gains a search icon at `navbar-end`, present on every page.
  - The dialog uses the DaisyUI **checkbox-hack modal** (`modal-toggle`), not the popover API chosen earlier: a popover has no declarative open-on-load, but the design requires the dialog to render open after the full-page reload that follows a search. The server sets `checked` on the toggle when `?search=` is present. The interaction (icon → dialog) is unchanged; this is a forced revision, documented here.
  - The search form inside the dialog issues a GET to `/explore` with `search=<term>`, so searching from any page lands on `/explore` with the dialog open and results inside.
  - Dialog content: input on top; when results exist, three grouped sections (Restaurants, Cities, People) below; backdrop label closes the dialog.
- **Radius control** — a GET form with a DaisyUI `range` input (steps 5/10/25/50/100 km) and an Apply submit button; a hidden input preserves the current `city`. Range inputs cannot submit on drag without JS, so applying requires the button.
- **Pagination** — a DaisyUI `join` of `join-item` anchor buttons (previous, numbered window around the current page, next), hidden when only one page exists.
- **Forms** — every form on this page is an idempotent view-state GET, not a mutation, so plain GET forms are used rather than Astro Actions (none exist in the repo yet; Actions are for mutations and this feature has none).
- **Layout** — desktop: two-column grid (map left, nearby-cities sidebar right), timeline full-width below; mobile: single column stacked map → cities → timeline. The page declares `prefetchUrls` per AGENTS.md (`/`, `/reviews`, plus cheap pagination neighbors).
- **Auth** — unchanged session guard; timeline filters take the current User's Follow and Favorites relationships.
- **Schema** — no changes. Everything derives from existing tables (Location city/coordinates, Restaurant status, Followers, Favorites, Reviews). User coordinates stay unused for now.
- **Component conventions** — new Astro components forward child props via `ComponentProps<typeof Child>` and spread `{...props}` per AGENTS.md; `pnpm check` must pass.

## Testing Decisions

- **One seam: HTTP.** Render the real `/explore` page against a seeded temporary SQLite database and assert on the returned HTML. Everything on the page is server-rendered, so HTML assertions capture all behavior — no deeper seam is needed.
- **What makes a good test here:** tests assert external behavior only — status codes, element presence/order/content, `href` strings, marker position styles, the dialog's rendered `checked` state — never SQL, module internals, or file layout. Each test seeds exactly the data it needs through Drizzle.
- **New infrastructure (first in the repo):** vitest as the runner, plus a helper that creates a migrated temp database and seeds it. This becomes the pattern for all future page tests.
- **Covered through the seam:** city selection and default; nearby-cities radius and top-5-by-count ordering; timeline city scoping, both filters, mutual exclusivity, pagination, and total counts; search grouping and caps; dialog open-state from `?search=`; marker projection via inline position styles; param-preservation rules in filter/pagination hrefs; empty states; auth redirect.
- **Prior art:** none — the repository has no tests today.
- The exact page-rendering mechanism in tests (Astro container API vs. built preview server) is settled in the first ticket.

## Out of Scope

- Interactive or draggable maps, browser geolocation, and client-side JavaScript of any kind.
- Resolving the default city from the User's stored coordinates (the `users.latitude`/`longitude` columns remain unused).
- Restaurant detail pages and User profile pages — User search results are inert until profiles exist.
- Map zoom/pan, street-level detail guarantees, and themed map styling.
- Infinite scroll.
- Notifications, Like/Favorite management UI, and changes to the home Feed.

## Further Notes

- The one deviation from the design interview: the popover API dialog was revised to the checkbox-hack modal, because the dialog must render open after a full-page reload and popovers have no declarative open-on-load.
- Candidate glossary terms for `/domain-modeling`: **CityView** (the currently selected city scoping map and timeline), **CityTimeline** (latest Reviews in the CityView — deliberately distinct from Feed), **NearbyCities** (the radius-limited sidebar list).
- City identity is the raw `Location.city` string. Cross-country name collisions are theoretically possible; if the data ever spans countries, add country to the `city` parameter.
- Marker overlap in dense cities is acceptable for v1; simple decluttering (rounding or jitter) is delegated to implementation.
- The exact geospatial dataset and artifact format (GeoJSON-sourced SVG vs. static image) is delegated to implementation tickets under the constraints: popular dataset, server-rendered, pre-renderable, no client JS.
- Search submitted from non-explore pages still lands on `/explore?search=...`; the header search is global by design.

## Comments
