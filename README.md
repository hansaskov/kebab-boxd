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

The production stage also blocks AI crawlers. This is a setting of the whole zone, `hjemmet.net`, so the API token needs permission to edit its Bot Management. Bot Fight Mode stays off: it puts a script of Cloudflare on every page, which the site does without.

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
curl -sI https://kebab.hjemmet.net/feed | grep -i cf-cache-status
```

After a change to `src/db/schema.ts`, run `pnpm db:generate`. The Durable Object applies new migrations when it starts.

`pnpm test` runs without the network. `pnpm test:e2e` runs a city search from start to end against the real GeoNames, Overpass and Nominatim, and takes a few minutes.

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
