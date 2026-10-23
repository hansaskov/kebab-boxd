# Kebab-Boxd

Review your favorite kebab restaurants.

## Installation

Copy `.env.example` to `.env`. and add the google credentials before you begin. Uploaded pictures are stored in the folder `PICTURES_DIR`.

```bash
pnpm install
pnpm db:migrate
pnpm astro check
pnpm run dev
```


## Tech Stack

- [Astro](https://astro.build)
- [Tailwind](https://tailwindcss.com)
- [Drizzle](https://orm.drizzle.team)
- [Sqlite](https://sqlite.org/docs.html)

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
- An admin can approve or reject restaurant suggestions.
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
