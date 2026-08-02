## Agent skills

### Domain docs

Single-context: root `CONTEXT.md`

## Coding standards

- No Client side javascript is allowed.
- Forms should use Astro Actions. 
- Each page needs to specify which sites can be pre-fetched immdiately. 
- CSS-only UI with DaisyUI. Reach for the DaisyUI skill. Never reach for JS-dependent components.
- Astro components must extend `ComponentProps<typeof Child>` (from `astro/types`) for every forwarded child and spread `{...props}` at the call site.
- Write unit and integration tests under `@src/tests/`, verify with pnpm test and pnpm check. 

## Response style

Only report to me in ASD-STE100 Simplified Technical English. 