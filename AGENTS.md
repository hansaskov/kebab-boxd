## Agent skills

### Domain docs

Single context root `CONTEXT.md`

## Coding standards

- No Client side javascript is allowed.
- Each page needs to specify which sites can be pre-fetched immdiately. 
- Three tier design system: tokens `--pr-*`, primitives `--ds-*`, semantics, `@theme inline`. Use semantic tokens and the component classes already defined.
- Only create a component when it is used in two or more places. Otherwise write the markup directly in the page, layout or component that uses it.
- Astro components must extend `ComponentProps<typeof Child>` (from `astro/types`) for every forwarded child and spread `{...props}` at the call site.
- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- Forms should use Astro Actions. 
- Database queries should use the Drizzle relational queries v2 syntax.
- Verify with `pnpm lint`, `pnpm check` and `pnpm test`.
- Write tests under `@src/tests/`, mocking is forbidden. 

## Response style

Alsays respond to the user in plain language using ISO-24495-1:2023.
