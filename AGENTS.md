## Agent skills

### Domain docs

Single context root `CONTEXT.md`

## Coding standards

- No Client side javascript is allowed.
- Each page needs to specify which sites can be pre-fetched immdiately.
- Three tier design system: tokens `--pr-*`, primitives `--ds-*`, semantics, `@theme inline`. Use semantic tokens and the component classes already defined.
- Astro components must extend `ComponentProps<typeof Child>` (from `astro/types`) for every forwarded child and spread `{...props}` at the call site.
- Write no comments. Name things so the code explains itself.
- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- Forms should use Astro Actions. 
- Database queries should use the Drizzle relational queries v2 syntax.
- A page waits for the database once: it puts every query in one `Astro.locals.db.load(...)`, and a second load fails. The load also opens the session: pass `db.viewer` where a query needs the viewer, and `await Astro.locals.session()` after the load. Components never load; the page passes them their data, the session too, through props. Each load is a trip to the Durable Object of about 35 ms.
- When a page shows one of several lists, load it with `db.choose`.
- Keep each Worker small, since it loads all its code each time Cloudflare starts it.
- Verify with `pnpm lint`, `pnpm check` and `pnpm test`.
- Write tests under `@src/tests/`, mocking is forbidden.

## Response style

Alsays respond to the user in plain language using ISO-24495-1:2023.
