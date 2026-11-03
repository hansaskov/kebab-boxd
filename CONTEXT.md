# Kebab-Boxd

A Letterboxd-style social app where users review kebab restaurants, follow each other, and track places they love or want to visit.

## Language

**Restaurant**:
A kebab-serving establishment that users review, rate, favorite, and add to their bucket list. Entered by a user suggesting it (goes through pending → approved | rejected). The canonical reviewed subject of the app.
_Avoid_: Kebab, KebabShop, Place, Venue

**Suggest**:
The action of a user proposing a new Restaurant that does not yet exist in the database, by sending a Google Maps link to it. The link waits in the SuggestionQueue until the server reads the name, position and GoogleMapsId from it and the address from OpenStreetMap; then it becomes a Restaurant with Status:pending, which an admin must approve or reject. A suggestion with the same GoogleMapsId as an approved or pending Restaurant, or the same name, ignoring letter case, within 150 m of one, is a duplicate and does not become a Restaurant. A rejected Restaurant may be suggested again.
_Avoid_: Propose, Request, Submit

**SuggestionQueue**:
The Google Maps links users have suggested that have not become Restaurants. A user may have 5 links waiting at a time. A link is tried up to 5 times while Google or OpenStreetMap cannot be reached. A link that becomes a Restaurant leaves the queue; one that is a duplicate, does not point to a place, or could not be read stays for 30 days so the user can see why.
_Avoid_: Jobs, Imports, Backlog

**GoogleMapsId**:
The id of a place in a Google Maps link, such as `0x464cdf40a60240ff:0x42ef3a5ea295d42e`.
_Avoid_: PlaceId, CID

**Review**:
A user's written verdict on a Restaurant, tied to one experience or visit, with up to 4 Pictures. A user may write unlimited Reviews for a Restaurant, but only their 3 most recent (the ReviewWindow) are publicly visible and count toward RatingAvg. Only the author can edit a Review; the author or an Admin can delete it. A Review is listed (in Feeds, on its Restaurant and to Like) when it is in the ReviewWindow, its Restaurant is approved, and its author is not banned.
_Avoid_: Post, Entry, Diary

**ReviewWindow**:
The 3 most recent Reviews a user has written for a given Restaurant. Only Reviews within this window contribute to the Restaurant's RatingAvg and appear to other users. Older Reviews persist but are not publicly surfaced.
_Avoid_: ReviewLimit, VisitCap, ReviewCap

**Rating**:
An integer 2–10 stored on a Review, representing the user's star rating for that visit. Divided by 2 for display (1.0–5.0 stars in 0.5 increments). No 0.5-star rating is possible; the minimum stored value is 2 (1 star displayed).
_Avoid_: Score, Grade, Stars

**RatingAvg**:
The user-weighted average rating cached on a Restaurant. For each user who has reviewed the Restaurant, their Ratings within the ReviewWindow are averaged first into a per-user average; then those per-user averages are averaged to produce the final score. This ensures every user's opinion counts equally, regardless of how many reviews they've written. The Reviews of banned users do not count until the ban is lifted.
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
The chronological timeline of listed Reviews from users the current user Follows. The user's personal stream of social activity. A second Feed, Everyone, shows the listed Reviews of all users.
_Avoid_: Timeline, Wall, Stream

**Like**:
A social signal from one user on another user's listed Review. Counted in LikeCount on the Review. Does not affect Restaurant ratings.
_Avoid_: Upvote, ThumbsUp, Heart

**User**:
A person with a Kebab-Boxd account. Signs in through one or more Accounts. Has a profile (picture, bio, pronouns) and optional coordinates for the nearby-Restaurants feature. May have the Admin role.
_Avoid_: Member, Account, Person

**Profile**:
The public page of a User. Shows their Picture, name, Username, pronouns, bio and Follow counts, and lists their public Reviews, Favorites and BucketList. On their own Profile, a User also sees their Reviews that are not public, marked as hidden, so it is where they find everything they have written. The Profile of a banned User is visible only to Admins.
_Avoid_: Account page, UserPage, Wall

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
A role on a User. Admins can approve or reject suggested Restaurants. Not a separate entity type. An Admin is able to manage all users and content, this entails banning users, suspending reviews, and restaurants. An Admin can give the role to another User or take it away, but cannot change their own role, so there is always at least one Admin. A banned User cannot be given the role or have it taken away until the ban is lifted, and an Admin cannot be banned, so a banned Admin cannot exist. While a stage has no Admin, the User who signs in with its bootstrap email address, verified by the Provider, becomes the first one.
_Avoid_: Moderator, Staff, Manager

**Permission**:
A named operation on a kind of resource, written `resource:operation`, such as `user:edit-settings`. A Policy decides whether a User has a Permission from attributes of the User (such as their id and role) and of the resource (such as the User it belongs to). Every access check names a Permission. No check reads the role directly, so each rule is written once, in `src/auth/permissions.ts`.
_Avoid_: Right, Privilege, Scope, Grant

**Picture**:
A hosted image stored in blob storage (only the URL is in the database). Used for profile pictures, Review pictures, and potentially future picture types. Kept in a single generic table to centralize image logic. Uploads are re-encoded as WebP, which removes their metadata, and the file is removed with the row.
_Avoid_: Image, Photo, Avatar

**Location**:
A structured physical address for a Restaurant: address lines, city, postal code, region, country, plus required latitude/longitude coordinates. Not used for Users, users store coordinates directly on their own record, and only they can see them. The map starts at the coordinates of the User.
_Avoid_: Address, Spot, Place

**ReviewCount**:
The cached count of total Reviews a Restaurant has received from users who are not banned. A display field only (e.g. "123 reviews"). Does not participate in the RatingAvg calculation, which requires the actual Review data to compute user-weighted averages.

**LikeCount**:
The cached count of Likes a Review has received. A display field updated synchronously with Like creation/deletion.
_Avoid_: LikeAmount, LikeTotal

**Notification**:
A message sent to a User in response to a relevant event: someone Follows them, someone Likes their Review, or an Admin approves or rejects the Restaurant they suggested. No one is notified of their own action. Undoing the event removes the Notification: an unfollow, an unlike, or a deleted Review. A new decision on the same Restaurant replaces the earlier Notification. A Notification is unread until its User sees it in their list of Notifications. The list shows it as new that one time and marks it read. A Notification on a page of the list the User has not opened stays unread. While the User who caused it is banned, a Notification is hidden. Each User can turn off each kind (follows, likes, suggestions). This stops new Notifications of that kind and keeps the existing ones.
_Avoid_: Alert, Update, Ping
