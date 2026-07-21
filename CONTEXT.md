# Kebab-Boxd

A Letterboxd-style social app where users review kebab restaurants, follow each other, and track places they love or want to visit.

## Language

**Restaurant**:
A kebab-serving establishment that users review, rate, favorite, and add to their bucket list. Entered either by an admin seeding from Google Places or by a user suggesting it (goes through pending → approved | rejected). The canonical reviewed subject of the app.
_Avoid_: Kebab, KebabShop, Place, Venue

**Suggest**:
The action of a user proposing a new Restaurant that does not yet exist in the database. Creates a Restaurant with Status:pending, which an admin must review. Duplicate suggestions are caught via GooglePlaceId before entering the queue.
_Avoid_: Propose, Request, Submit

**Review**:
A user's written verdict on a Restaurant, tied to one experience or visit. A user may write unlimited Reviews for a Restaurant, but only their 3 most recent (the ReviewWindow) are publicly visible and count toward RatingAvg.
_Avoid_: Post, Entry, Diary

**ReviewWindow**:
The 3 most recent Reviews a user has written for a given Restaurant. Only Reviews within this window contribute to the Restaurant's RatingAvg and appear to other users. Older Reviews persist but are not publicly surfaced.
_Avoid_: ReviewLimit, VisitCap, ReviewCap

**Rating**:
An integer 2–10 stored on a Review, representing the user's star rating for that visit. Divided by 2 for display (1.0–5.0 stars in 0.5 increments). No 0.5-star rating is possible; the minimum stored value is 2 (1 star displayed).
_Avoid_: Score, Grade, Stars

**RatingAvg**:
The user-weighted average rating cached on a Restaurant. For each user who has reviewed the Restaurant, their Ratings within the ReviewWindow are averaged first into a per-user average; then those per-user averages are averaged to produce the final score. This ensures every user's opinion counts equally, regardless of how many reviews they've written.
_Avoid_: MeanRating, AverageScore, aggregateRating

**Favorites**:
A user's collection of Restaurants they love and have visited. Kept separate from BucketList despite identical structure, since the semantics differ (visited vs not visited) and may diverge in functionality over time.
_Avoid_: Bookmark, Saved, Starred

**BucketList**:
A user's collection of Restaurants they want to visit. Kept separate from Favorites; may gain priority or planned-visit-date fields in the future.
_Avoid_: WishList, WantToGo, Queue

**Follow**:
A directed relationship between two users: a Follower follows a Following. The Follower sees the Following's Reviews in their Feed. Self-follow is prevented.
_Avoid_: Subscribe, Friend, Buddy

**Feed**:
The chronological timeline of Reviews from users the current user Follows. The user's personal stream of social activity.
_Avoid_: Timeline, Wall, Stream

**Like**:
A social signal from one user on another user's Review. Counted in LikeCount:c on the Review. Does not affect Restaurant ratings.
_Avoid_: Upvote, ThumbsUp, Heart

**User**:
A person with a Kebab-Boxd account. Authenticated via Google OAuth. Has a profile (picture, bio, pronouns) and optional coordinates for the nearby-Restaurants feature. May have the Admin role.
_Avoid_: Member, Account, Person

**Username**:
The unique, case-sensitive handle identifying a User. `KebabKing` and `kebabking` are treated as distinct. Used for profile URLs and search. Enforced as unique at the database level.
_Avoid_: Handle, DisplayName, Nickname

**Admin**:
A role on a User. Admins can approve or reject suggested Restaurants and seed Restaurants from the Google Places API. Not a separate entity type. An Admin is able to manage all users and content, this entails banning users, suspending reviews, and restaurants. 
_Avoid_: Moderator, Staff, Manager

**Picture**:
A hosted image stored in blob storage (only the URL is in the database). Used for profile pictures, Review pictures, and potentially future picture types. Kept in a single generic table to centralize image logic.
_Avoid_: Image, Photo, Avatar

**Location**:
A structured physical address for a Restaurant: address lines, city, postal code, region, country, plus required latitude/longitude coordinates. Not used for Users — users store coordinates directly on their own record.
_Avoid_: Address, Spot, Place

**ReviewCount**:
The cached count of total Reviews a Restaurant has received. A display field only (e.g. "123 reviews"). Does not participate in the RatingAvg calculation, which requires the actual Review data to compute user-weighted averages.

**LikeCount**:
The cached count of Likes a Review has received. A display field updated synchronously with Like creation/deletion.
_Avoid_: LikeAmount, LikeTotal

**Notification**:
A message sent to a User in response to a relevant event: someone Follows them, someone Likes their Review, or their Restaurant Suggestion is approved or rejected. Planned but deferred for a future stage.
_Avoid_: Alert, Update, Ping