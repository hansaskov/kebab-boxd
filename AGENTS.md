## Agent skills

### Domain docs

Single context root `CONTEXT.md`

## Coding standards

- No Client side javascript is allowed.
- Forms should use Astro Actions. 
- Each page needs to specify which sites can be pre-fetched immdiately. 
- CSS-only UI with DaisyUI.
- Astro components must extend `ComponentProps<typeof Child>` (from `astro/types`) for every forwarded child and spread `{...props}` at the call site.
- Verify with `pnpm lint`, `pnpm check` and `pnpm test`
- Write unit and integration tests under `@src/tests/`

## Response style

Alsays respond to the user in plain language using ISO-24495-1:2023.
