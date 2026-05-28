# Kebab-Boxd

Review your favorite kebabs.

## Installation

Run the following command in your terminal

```bash
pnpm install
```
```bash
pnpm db:migrate
```
```bash
pnpm run dev
```

## Tech Stack

- [Astro](https://astro.build)
- [tailwindcss](https://tailwindcss.com/)
- [DaisyUI](https://daisyui.com/)
- [Drizzle](https://orm.drizzle.team)

## Functionality
1. A user can create, edit and delete a review for a restaurant.
2. A user can like reviews.
3. A user can view their own feed.
4. A user can follow friends to add them to their feed.
5. A user can unfollow friends.
6. A user can search for people to follow.
7. A user can view their followers feed.
8. A user can view another users profile.
9. A user can suggest a missing restaurant.
10. An admin can approve or reject restaurant suggestions.
11. A user can upload pictures to a review.
12. A user can view nearby restaurants on a map.
13. A user can browse all of the restaurants and reviews.
14. A user can add restaurants to their BucketList.
15. A user can remove restaurants from their BucketList and Favorites.
16. A user can save their favorite restaurants.
17. A user can view another user's profile.

1. A user can create an account.
2. A user can login/logout.
3. A user can update their settings.
4. A user can update their profile picture.
5. A user can delete their account.
6. A user can request all their data. (GDPR)

## Data Layout
Terminology
- Table
- Field:X

Table is a collection of items like users, items and so forth.
Field is the data that is on the table, like name, age and such.
X is the type of Field used, like a singular value, multiple values or derived values.

Field:1 (Singular instance of name)
Field:n (Multiple instances of name)
Field:c (Derived count)
Field:a (Derived average)

All tables include an Id, updated_at and created_at field.

- **Users**
  - Username:1, Email:1, GoogleId:1, ProfilePictureId:1, Bio:1, Pronoun:1, Latitude:1, Longitude:1, IsAdmin:1

- **Location**
  - AddressLine1:1, AddressLine2:1, City:1, PostalCode:1, Region:1, Country:1, Latitude:1, Longitude:1

- **Restaurants**
  - Name:1, LocationId:1, SuggestedBy:1, Status:1, GooglePlaceId:1, RatingAvg:a, ReviewCount:c

- **Reviews**
  - Author:1, Restaurant:1, Rating:1, Description:1, LikeCount:c

- **Followers**
  - Follower:1, Following:1

- **Favorites**
  - User:1, Restaurant:1

- **Likes**
  - User:1, Review:1

- **BucketList**
  - User:1, Restaurant:1

- **Pictures**
  - Url:1

- **ReviewPictures**
  - Review:1, Picture:1

- **Session**
  - User:1, ExpiresAt:1

## Relations
Terminology
- Relation:h1 (has one)
- Relation:hn (has many)
- Relation:b1 (belongs to one)

- **Users**
  - Reviews:hn, Followers:hn (as follower), Following:hn (as following), Favorites:hn, BucketList:hn, Likes:hn, ProfilePicture:h1

- **Restaurants**
  - Reviews:hn, Favorites:hn, BucketList:hn, Location:h1

- **Reviews**
  - Author:b1, Restaurant:b1, Likes:hn, ReviewPictures:hn

- **Followers**
  - Follower:b1 (User), Following:b1 (User)

- **Favorites**
  - User:b1, Restaurant:b1

- **BucketList**
  - User:b1, Restaurant:b1

- **Likes**
  - User:b1, Review:b1

- **ReviewPictures**
  - Review:b1, Picture:b1

- **Session**
  - User:b1

## Considerations

### Favorites and BucketList are kept as separate tables
Despite having an identical structure of `User:1, Restaurant:1`, these two tables are intentionally kept separate. Favorites represents restaurants a user loves and has visited, while BucketList represents restaurants a user wants to visit. They are expected to diverge in functionality over time — for example Favorites may gain a `VisitedAt` date, and BucketList may gain a priority or planned visit date.

### Cached RatingAvg:a and LikeCount:c are updated synchronously
`RatingAvg:a` on Restaurants and `LikeCount:c` on Reviews are stored as cached values rather than computed on the fly, to prioritise fast page loads. These are updated synchronously on every relevant change (a new review, a new like, a deletion). If synchronous updates become a performance bottleneck, the plan is to move to a background process that recalculates values periodically.

### RatingAvg:a uses user-weighted averaging
The cached restaurant rating is not a simple average of all reviews. Instead, each user's reviews for a restaurant are averaged first, and then those per-user averages are averaged to produce the final rating. This prevents a single user from having an outsized influence on a restaurant's score by submitting many reviews. This is paired with a hard limit of 3 reviews per user per restaurant, enforced at the application level.

### Rating:1 is stored as an integer 2–10
Review ratings are displayed as 0.5–5 stars in 0.5 increments, but stored in the database as integers 2–10 (the display value multiplied by 2). This avoids floating point precision issues entirely. Divide by 2 when displaying.

### User location is stored as optional coordinates directly on Users
Rather than linking Users to the Location table, users have optional `Latitude:1` and `Longitude:1` fields directly on their record. The Location table is reserved for Restaurants, which require a full structured address. Storing a full address for users is unnecessary for the app's proximity features and raises privacy concerns under the app's own GDPR data request functionality.

### Restaurants.SuggestedBy:1 is nullable
Restaurants can enter the database in two ways: seeded from the Google Places API by an admin, or suggested by a user. Seeded restaurants have no user author, so `SuggestedBy:1` is nullable. A null `SuggestedBy` combined with `Status: approved` clearly identifies a seeded restaurant.

### Restaurants follow a hybrid addition model
The initial restaurant data is seeded from the Google Places API. If a user wants to review a restaurant that does not exist in the database, they can suggest it. Suggestions enter the database with `Status: pending` and must be approved by an admin before becoming publicly visible. Rejected suggestions are kept in the database with `Status: rejected` to maintain an audit trail and prevent duplicate submissions.

### GooglePlaceId:1 on Restaurants is nullable and unique
When a user suggests a restaurant, the app checks for a matching `GooglePlaceId` before the suggestion enters the approval queue. This catches duplicates early. The field is nullable because manually suggested or obscure restaurants may not have a corresponding Google Places entry.

### Pictures is a generic table used for all image types
Rather than embedding image references directly in each table, a single `Pictures` table stores all image URLs. Profile pictures are referenced via `ProfilePictureId:1` on Users. Review images use a `ReviewPictures` junction table to support multiple images per review. This keeps image storage logic in one place and makes it straightforward to add images to other entities in the future. Images are hosted in blob storage; only the URL is stored in the database.

### Username:1 is unique and case-sensitive
Usernames are enforced as unique at the database level to support clean profile URLs and unambiguous search results. Case-sensitivity is intentional — `KebabKing` and `kebabking` are treated as distinct usernames.

### Pronoun:1 is a predefined enum
Pronouns are stored as one of the following enum values: `They | He | HeThem | She | SheThem | Xe | ZeHir | ZeZir | It`. A predefined enum ensures consistent display across the app without normalisation logic.

### Authentication is Google-only via Lucia and Arctic
Only Google OAuth is supported for login. This eliminates the need for password hashing, email verification, and password reset flows. The session schema follows Lucia's documentation directly. Additional auth providers can be added later.

### Junction tables use composite primary keys
Tables like `Followers`, `Likes`, `Favorites`, `BucketList` and `ReviewPictures` use a composite primary key across their two foreign key columns rather than a separate auto-increment `id`. The combination of the two foreign keys IS the identity of the row, making a separate id column redundant. Uniqueness is enforced by the primary key itself.

### ReviewCount:c on Restaurants is a display field only
`ReviewCount` tracks the total number of reviews a restaurant has received and is used for display purposes (e.g. "123 reviews"). It does not participate in the `RatingAvg:a` calculation. The user-weighted average always requires querying the `Reviews` table directly to compute per-user averages — `ReviewCount` is not sufficient for this and is not used in that calculation.

### Coordinates are stored as real numbers
`Latitude` and `Longitude` are stored as `real` (decimal) values on both `Users` and `Location`. Using integers would truncate coordinates and make the map feature useless. Coordinates on `Location` are required since restaurants must be mappable. Coordinates on `Users` are optional since user location is only used for the nearby restaurants feature.

### PostalCode is stored as text
Despite appearing numeric in some countries (e.g. Denmark's `6700`), postal codes are stored as `text` to support international formats such as UK postcodes (`SW1A 1AA`) and Dutch codes (`1234 AB`), and to preserve any leading zeros.

### Notifications are planned but deferred
A notifications system (for follows, likes, and restaurant suggestion outcomes) is a planned feature but is out of scope for the current stage. It will be introduced as a separate table once the core functionality is stable.

## Roadmap
1. Database schema
2. Login with Google