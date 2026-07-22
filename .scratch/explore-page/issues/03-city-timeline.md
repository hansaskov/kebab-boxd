# 03 — City timeline with pagination and filter tabs

**What to build:** Below the map, the viewed city's latest publicly visible Reviews render as a timeline — 10 per page, newest first — each entry showing the author's avatar and Username, the Restaurant's name, the Rating, an excerpt, a relative timestamp, and the LikeCount. This ticket establishes the canonical ReviewWindow visibility predicate (only a User's 3 most recent Reviews per Restaurant are publicly surfaced) for the first time in the codebase. DaisyUI `join` pagination anchors (`?page=`) preserve city, radius, and filter; changing city or filter returns to page 1. All / Following / Favorites tabs are anchor links (`?filter=followers|favorites`; absent = All), mutually exclusive, preserving city + radius and dropping page on change. Empty states distinguish "no Reviews in this city" from "no Reviews under this filter".

**Blocked by:** 02 — City view

**Status:** ready-for-agent

- [ ] Timeline shows latest publicly visible Reviews for Restaurants in the viewed city only, newest first, 10 per page
- [ ] Entry content: author avatar + Username, Restaurant name, Rating, excerpt, relative timestamp, LikeCount
- [ ] ReviewWindow visibility predicate implemented canonically and applied to the timeline
- [ ] Pagination via `join` anchors preserving city/radius/filter; hidden when only one page; changing city or filter drops `page`
- [ ] Tabs All / Following (`?filter=followers`) / Favorites (`?filter=favorites`): mutually exclusive, exactly one active, links preserve city + radius and drop `page`
- [ ] Following restricts to Reviews by authors the current User Follows; Favorites restricts to Reviews of the current User's Favorites
- [ ] Empty states for no-Reviews-in-city and no-Reviews-under-filter
- [ ] HTTP-seam tests cover: city scoping, ordering, pagination, both filters, mutual exclusivity, param preservation, ReviewWindow visibility, empty states

## Comments
