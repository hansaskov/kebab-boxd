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
A person with a Kebab-Boxd account. Signs in through one or more Accounts. Has a profile (picture, bio, pronouns) and optional coordinates for the nearby-Restaurants feature. May have the Admin role.
_Avoid_: Member, Account, Person

**Account**:
One authentication method linked to a User, identified by the Provider and the Provider's stable subject id rather than by email. Holds the Provider's tokens once the app needs them, and the password hash once local sign-in exists. A User may have several.
_Avoid_: Identity, Login, Credential

**Provider**:
An external service that vouches for an Account, named by a stable id such as `google`. Google is the only Provider configured today.
_Avoid_: IdP, OAuth client, Issuer

**Username**:
The unique handle identifying a User. 3–30 characters from `A–Z`, `a–z`, `0–9` and `_`, stored in lowercase, so `KebabKing` and `kebabking` are the same Username. Route names and names that suggest speaking for the site (such as `admin`) are reserved. Used for profile URLs and search. Enforced as unique, ignoring letter case, at the database level.
_Avoid_: Handle, DisplayName, Nickname

**Admin**:
A role on a User. Admins can approve or reject suggested Restaurants and seed Restaurants from the Google Places API. Not a separate entity type. An Admin is able to manage all users and content, this entails banning users, suspending reviews, and restaurants. An Admin can give the role to another User or take it away, but cannot change their own role, so there is always at least one Admin. A banned User cannot be given the role or have it taken away until the ban is lifted, and an Admin cannot be banned, so a banned Admin cannot exist.
_Avoid_: Moderator, Staff, Manager

**Permission**:
A named operation on a kind of resource, written `resource:operation`, such as `user:edit-settings`. A Policy decides whether a User has a Permission from attributes of the User (such as their id and role) and of the resource (such as the User it belongs to). Every access check names a Permission. No check reads the role directly, so each rule is written once, in `src/auth/permissions.ts`.
_Avoid_: Right, Privilege, Scope, Grant

**Picture**:
A hosted image stored in blob storage (only the URL is in the database). Used for profile pictures, Review pictures, and potentially future picture types. Kept in a single generic table to centralize image logic.
_Avoid_: Image, Photo, Avatar

**Location**:
A structured physical address for a Restaurant: address lines, city, postal code, region, country, plus required latitude/longitude coordinates. Not used for Users, users store coordinates directly on their own record.
_Avoid_: Address, Spot, Place

**ReviewCount**:
The cached count of total Reviews a Restaurant has received. A display field only (e.g. "123 reviews"). Does not participate in the RatingAvg calculation, which requires the actual Review data to compute user-weighted averages.

**LikeCount**:
The cached count of Likes a Review has received. A display field updated synchronously with Like creation/deletion.
_Avoid_: LikeAmount, LikeTotal

**Notification**:
A message sent to a User in response to a relevant event: someone Follows them, someone Likes their Review, or their Restaurant Suggestion is approved or rejected. Planned but deferred for a future stage.
_Avoid_: Alert, Update, Ping
