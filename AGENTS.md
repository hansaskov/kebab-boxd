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
- A page waits for the database once. Each call is a trip to the Durable Object of about 35 ms, and the session already takes one. Send every call of a page at once with `Promise.all`. A call that needs another row takes what the address names, such as a Username, and finds and authorizes that row itself with `authorizedRead`. `src/tests/database-trips.test.ts` checks every page.
- Keep each Worker small, since it loads all its code each time Cloudflare starts it. Name each file as "Where code goes" says.
- Verify with `pnpm lint`, `pnpm check` and `pnpm test`.
- Write tests under `@src/tests/`, mocking is forbidden. 

## Where code goes

Each feature has one folder, named after its concept in `CONTEXT.md`: `admin`, `auth`, `cities`, `follows`, `map`, `notifications`, `pictures`, `privacy`, `restaurants`, `reviews`, `settings` and `users`. To change a feature, open its folder. Put new code in the folder of the feature it serves.

The name of a file says which Worker loads it:

- `x.db.ts` is database code, which only the Durable Object loads. Only these files and `src/db` may use Drizzle. Other code imports their types only.
- `x.ts` next to `x.db.ts` holds what the pages share with it, such as a limit or the options of a list.
- `actions.ts` holds the Astro Actions of the feature and the Zod schemas of its forms.
- Any other `.ts` file is plain code of the feature. A file that database code imports must not import Astro or Zod, even through another file. `src/tests/backend-bundle.test.ts` checks this.
- An `.astro` file in a feature folder is a component that only this feature uses.

`pnpm lint` refuses Drizzle outside database code, and Astro, Zod and actions inside it.

What no single feature owns:

- `src/db`: the database itself and the rules that several concepts share, such as `visibility.ts`.
- `src/actions`: the entry point of Astro Actions, and the schemas that the forms of several features share.
- `src/components`: components that belong to no feature, such as fields, dialogs and tabs.
- `src/pages`, `src/layouts` and `src/middleware`: where Astro expects them.
- `src/hrefs.ts` writes the address of every page, and `src/params.ts` reads what an address asks for.

## Response style

Alsays respond to the user in plain language using ISO-24495-1:2023.
