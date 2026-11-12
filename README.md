# Kebab-Boxd

Review your favorite kebab restaurants.

## Installation

The app runs on Cloudflare and is deployed with [SST](https://sst.dev). Copy `.env.example` to `.env` and add the Google credentials before you begin. You also need a Cloudflare API token in `CLOUDFLARE_API_TOKEN` and your account ID in `CLOUDFLARE_DEFAULT_ACCOUNT_ID`.

```bash
pnpm install
pnpm sst:dev
```

`sst dev` deploys the database and the picture bucket to your own stage, then runs `astro dev` against them.

## Deployment

Set the secrets once for the stage, then deploy:

```bash
pnpm sst secret set GoogleClientId <id> --stage production
pnpm sst secret set GoogleClientSecret <secret> --stage production
pnpm sst secret set GoogleRedirectUri https://<domain>/api/google/callback --stage production
pnpm sst secret set DataControllerName <name> --stage production
pnpm sst secret set DataControllerEmail <email> --stage production
pnpm sst secret set BootstrapAdminEmail <your Google email> --stage production
pnpm sst:deploy
```

The production stage also blocks AI crawlers. This is a setting of the whole zone, `kebab-boxd.com`, so the API token needs permission to edit its Bot Management. Bot Fight Mode stays off: it puts a script of Cloudflare on every page, which the site does without.

| Part | Cloudflare service |
| --- | --- |
| Website | Worker made by `sst.cloudflare.Astro` |
| Database | SQLite in a Durable Object, in the `Backend` Worker |
| Pictures | R2 bucket, made into WebP by Cloudflare Images |
| Suggestion queue, city searches, city list downloads and data purge | Alarms of the Durable Object |
| Pages that Visitors see | Workers Cache of the Web Worker, for 60 seconds |
| Rows each database call reads | Workers Logs of the Backend Worker |

## Rows read

The free plan stops the database for the rest of the day once it has read 5 million rows.

- Each database call that reads or writes rows logs `Database call` with its `call`, `rowsRead` and `rowsWritten`. In Workers Logs of the Backend Worker, group by `call` and add up `rowsRead` to find the calls that cost most.
- `src/tests/rows-read.test.ts` measures every call in a Durable Object run by Miniflare, which counts rows as Cloudflare does. A call must read the same rows when the rest of the site is four times as large, stay within its budget, and read no table from start to end, unless the test says why.
- Every Visitor sees the same page at an address, so Cloudflare keeps it for 60 seconds and serves it without the database. A User never gets a kept page. `src/middleware/visitor-cache.ts` decides which pages are kept.

To check the cache after a deploy, ask for a page twice without a cookie. The second answer has `cf-cache-status: HIT`:

```bash
curl -sI https://kebab-boxd.com/feed | grep -i cf-cache-status
```

After a change to `src/db/schema.ts`, run `pnpm db:generate`. The Durable Object applies new migrations when it starts.

`pnpm test` runs without the network. `pnpm test:e2e` runs a city search from start to end against the real GeoNames, Overpass and Nominatim, and takes a few minutes.

## Page latency

Every call of the database is a trip from the Web Worker to the Durable Object, about 35 ms in production. A page takes as long as the trips it waits for one after another, so a signed-in page waits for two: one for the session, and one for everything the page shows. A Visitor's page waits for one. `src/tests/database-trips.test.ts` fails when a page waits for more.

Every page tells how long it took in its `Server-Timing` header, which the Network panel of the browser shows under Timing. `db` is the time it waited for the database, with its trips, and says when the database woke up. `app` shows only when the Web Worker had to start for the request:

```bash
curl -sI https://kebab-boxd.com/feed | grep -i server-timing
```

Cloudflare stops a Worker that gets no requests and lets the Durable Object sleep, so the first request after a while waits for them to start. A site with few visitors meets a Worker that must start on many requests, since Cloudflare spreads them over many machines. Both Workers load all their code when they start, so each carries only what it needs:

- The Web Worker never loads the code of the database or Drizzle. A value that the pages and the database share, such as a limit or the options of a list, lives in `src/data`. `pnpm lint` refuses any other import from `src/db` outside it, except types.
- The Backend Worker never loads Zod or Astro, which only the forms need. `src/tests/backend-bundle.test.ts` checks it, and that it stays small.
- The styles go in each page from one copy in `BaseLayout.astro`. Astro's own inlining kept a copy for every route in the Web Worker.

`pnpm bench:live` measures the live site as a Visitor after it has been idle, and again at once:

```bash
pnpm bench:live --rounds 3 --idle 200 /privacy /feed
```

`pnpm bench:pages` builds the site and measures every page as a Visitor, a User and an Admin. It runs the Web Worker and the Backend Worker in workerd, with the large database of the row tests and the trip to the database as long as in production. It tells the median time of each page, its calls and its trips. A page should answer within 100 000 µs, and must within 200 000 µs.

```bash
pnpm bench:pages --only "viewer /feed"      # only the pages whose role and path contain the text
pnpm bench:pages --round-trip 0 --profile    # the CPU time alone, with a .cpuprofile of each Worker for each page
node tools/page-latency/flame.ts .cache/page-latency/profiles/viewer-feed.web.cpuprofile
```

Chrome DevTools and [speedscope](https://www.speedscope.app) show a `.cpuprofile` as a flame graph.

## Tech Stack

- [Astro](https://astro.build)
- [Tailwind](https://tailwindcss.com)
- [Drizzle](https://orm.drizzle.team)
- [Sqlite](https://sqlite.org/docs.html)
- [Cloudflare](https://developers.cloudflare.com) and [SST](https://sst.dev)

## Functionality

- A user can create, edit and delete a review for a restaurant.
- A user can like reviews.
- A user can view their own feed.
- A user can follow other users to add their reviews to their feed.
- A user can unfollow other users.
- A user can search for other users to follow.
- A user can view their followers feed.
- A user can view another user's profile.
- A user can suggest a missing restaurant.
- A user can upload pictures to a review.
- A user can view nearby restaurants on a map.
- A user can browse all of the restaurants and reviews.
- A user can add restaurants to their BucketList.
- A user can remove restaurants from their BucketList and Favorites.
- A user can save their favorite restaurants.
- A user can create an account, login and logout.
- A user can update their settings and profile picture.
- A user can delete their account.
- A user can download all their data. (GDPR)
- An admin can approve or reject restaurant suggestions, several at once.
- An admin can search a city for kebab restaurants in OpenStreetMap, and is notified when the search is done.
- An admin can download the list of cities from GeoNames, and update it later.
- An admin can find any user, change their role, and ban them.

## Roadmap

- [x] Database schema
- [x] Login with Google
- [x] Sidebar layout and placeholder pages
- [x] Admin console with user management
- [x] GDPR basics
- [x] Profile page with Follow
- [x] Reviews with pictures and likes
- [x] Feeds, people search and follower lists
- [x] Restaurants, suggestions and moderation
- [x] Favorites and BucketList
- [x] Map of nearby restaurants
- [ ] Notifications
