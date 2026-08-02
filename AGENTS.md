## Agent skills

### Domain docs

Single-context: root `CONTEXT.md`

## Coding standards

- No Client side javascript is allowed.
- Forms should use Astro Actions. 
- Each page needs to specify which sites can be pre-fetched immdiately. 
- CSS-only UI with DaisyUI. Never reach for JS-dependent components.
- Astro components must extend `ComponentProps<typeof Child>` (from `astro/types`) for every forwarded child and spread `{...props}` at the call site.
- Verify with `pnpm check`, `pnpm lint` and `pnpm test`
- Write unit and integration tests under `@src/tests/`

## Response style

Only report to me in ASD-STE100 Simplified Technical English. 