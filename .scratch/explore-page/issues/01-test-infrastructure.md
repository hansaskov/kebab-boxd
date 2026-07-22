# 01 — Test infrastructure: vitest + temp DB + page render

**What to build:** The repo's first automated test setup, so every later explore-page ticket can be verified at the HTTP seam: a test can render the real `/explore` page against a seeded temporary SQLite database and assert on the returned HTML. A smoke test proves the seam end to end using existing behavior — a request to `/explore` without a session redirects to `/login`.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A test script (e.g. `pnpm test`) runs the suite and exits green
- [ ] Test helper creates a fresh, migrated, temporary SQLite database per test run and seeds it via Drizzle
- [ ] Test helper can render a real Astro page response (status + HTML body); the chosen mechanism (Astro container API vs. built preview server) is documented in this ticket's Comments
- [ ] Smoke test: unauthenticated GET `/explore` responds with a redirect to `/login`
- [ ] No production code behavior changed

## Comments

**Rendering mechanism:** Astro Container API (`experimental_AstroContainer` from `astro/container`). This creates an internal Vite dev server that resolves `astro:env/server` and other Astro virtual modules naturally. Pages are imported as Astro component factories and rendered via `container.renderToResponse(Component, { partial: false })`, which returns a standard `Response` object with status code and headers. This avoids the overhead of building the full app or managing a preview server process.
