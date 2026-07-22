# 06 — Global search dialog

**What to build:** A search icon at `navbar-end` in the header (present on every page) opens a checkbox-hack modal containing a single search input. Submitting GETs `/explore?search=<term>`; the response renders the dialog open (the server sets the toggle `checked`) with results grouped Restaurants / Cities / People — case-insensitive substring matches, capped at 5 per group. City results link to `?city=<name>`; Restaurant results link to `?city=<city>&highlight=<id>`; User results render without links because profile pages don't exist yet. The dialog closes via a close control or the backdrop, and each group shows a "no results" state when empty. The checkbox-hack modal is a deliberate revision of the earlier popover choice: a popover has no declarative open-on-load, but this design requires the dialog open after a full-page reload.

**Blocked by:** 02 — City view

**Status:** ready-for-agent

- [ ] Search icon visible in the header on all pages; activating it opens the dialog without JavaScript
- [ ] Form GETs `/explore` with `search=<term>`; the `/explore` response renders the dialog open with results inside
- [ ] Results grouped Restaurants / Cities / People; case-insensitive substring matching; maximum 5 per group
- [ ] City results link to that city's view; Restaurant results link to their city's view with the Restaurant highlighted; User results render inert
- [ ] Per-group "no results" messaging; dialog closes via close control and backdrop
- [ ] Search submitted from a non-explore page still lands on `/explore?search=...`
- [ ] HTTP-seam tests cover: grouping, caps, matching, link targets, dialog open-state from `?search=`, empty groups

## Comments
