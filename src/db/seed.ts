import { reset, seed } from "drizzle-seed";
import * as schema from "@src/db/schema";
import { createDatabase } from "@src/db";
import type { Client } from "@src/db/client";
import { pronouns } from "@src/data/pronouns";
import { createSession } from "@src/auth/session";
import { buildUsername } from "@src/db/accounts";
import { eq } from "drizzle-orm";
import { refreshLikeCounts, refreshRestaurantStats } from "@src/db/cached-stats";
import type { PictureStore } from "@src/pictures/store";

const imageUrls = [
  "https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=800",
  "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800",
  "https://images.unsplash.com/photo-1604467715878-191e088f0358?w=800",
  "https://images.unsplash.com/photo-1633321702512-4748487b2f67?w=800",
  "https://images.unsplash.com/photo-1617692855027-33b8811ffaa0?w=800",
  "https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=800",
  "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800",
  "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800",
  "https://images.unsplash.com/photo-1559329007-40df8a9345d8?w=800",
  "https://images.unsplash.com/photo-1579027989536-b7b1f875659b?w=800",
];

const kebabNames = [
  "Dursty Döner",
  "Bosporus Grill",
  "Kebab Connection",
  "Berlin Döner House",
  "Sultan's Kitchen",
  "Anatolia Kebap",
  "Istanbul Grill House",
  "Hasir Kebab",
  "Mangal Express",
  "Saray Döner",
  "Pamukkale Grill",
  "Antalya Kebab House",
  "Marmaris Döner & Pizza",
  "Urfa Grillhaus",
  "Dergah Kebab",
  "Adana Ocakbasi",
  "Kösk Kebap",
  "Firin Döner",
  "Zeytin Kebap Evi",
  "Yaprak Döner World",
];

const parentSchema = {
  pictures: schema.pictures,
  users: schema.users,
  locations: schema.locations,
  restaurants: schema.restaurants,
  reviews: schema.reviews,
};

function uniquePairs(
  count: number,
  leftPool: number[],
  rightPool: number[],
): Array<[number, number]> {
  const max = leftPool.length * rightPool.length;
  const n = Math.min(count, max);
  const seen = new Set<string>();
  const result: Array<[number, number]> = [];

  while (result.length < n) {
    const l = leftPool[Math.floor(Math.random() * leftPool.length)];
    const r = rightPool[Math.floor(Math.random() * rightPool.length)];
    if (l === undefined || r === undefined) {
      break;
    }
    const key = `${l}:${r}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push([l, r]);
    }
  }

  return result;
}

// Around Funen, so that the restaurants show up near each other on the map.
const area = { minLatitude: 55.0, maxLatitude: 55.7, minLongitude: 9.7, maxLongitude: 10.9 };

export async function seedDatabase(client: Client, pictures: PictureStore) {
  await seed(client, parentSchema).refine((funcs) => ({
    users: {
      count: 50,
      columns: {
        username: funcs.firstName({ isUnique: true }),
        email: funcs.email(),
        role: funcs.weightedRandom([
          { weight: 0.9, value: funcs.default({ defaultValue: "user" }) },
          { weight: 0.1, value: funcs.default({ defaultValue: "admin" }) },
        ]),
        bio: funcs.weightedRandom([
          { weight: 0.6, value: funcs.loremIpsum() },
          { weight: 0.4, value: funcs.default({ defaultValue: null }) },
        ]),
        pronoun: funcs.valuesFromArray({ values: [...pronouns] }),
        latitude: funcs.number({ minValue: area.minLatitude, maxValue: area.maxLatitude, precision: 10000 }),
        longitude: funcs.number({ minValue: area.minLongitude, maxValue: area.maxLongitude, precision: 10000 }),
        bannedAt: funcs.default({ defaultValue: null }),
      },
    },

    locations: {
      count: 80,
      columns: {
        addressLine1: funcs.streetAddress(),
        addressLine2: funcs.weightedRandom([
          { weight: 0.9, value: funcs.default({ defaultValue: null }) },
          { weight: 0.1, value: funcs.streetAddress() },
        ]),
        city: funcs.city(),
        postalCode: funcs.postcode(),
        region: funcs.state(),
        country: funcs.country(),
        latitude: funcs.number({ minValue: area.minLatitude, maxValue: area.maxLatitude, precision: 10000 }),
        longitude: funcs.number({ minValue: area.minLongitude, maxValue: area.maxLongitude, precision: 10000 }),
      },
    },

    restaurants: {
      count: 30,
      columns: {
        name: funcs.valuesFromArray({ values: kebabNames }),
        status: funcs.valuesFromArray({
          values: [
            { weight: 0.65, values: ["approved"] },
            { weight: 0.25, values: ["pending"] },
            { weight: 0.1, values: ["rejected"] },
          ],
        }),
      },
    },

    reviews: {
      count: 200,
      columns: {
        rating: funcs.weightedRandom([
          { weight: 0.02, value: funcs.int({ minValue: 2, maxValue: 3 }) },
          { weight: 0.05, value: funcs.int({ minValue: 4, maxValue: 5 }) },
          { weight: 0.1, value: funcs.int({ minValue: 6, maxValue: 7 }) },
          { weight: 0.23, value: funcs.int({ minValue: 8, maxValue: 8 }) },
          { weight: 0.35, value: funcs.int({ minValue: 9, maxValue: 9 }) },
          { weight: 0.25, value: funcs.int({ minValue: 10, maxValue: 10 }) },
        ]),
        description: funcs.weightedRandom([
          { weight: 0.7, value: funcs.loremIpsum() },
          { weight: 0.3, value: funcs.default({ defaultValue: null }) },
        ]),
      },
    },

    pictures: {
      count: imageUrls.length,
      columns: {
        url: funcs.valuesFromArray({ values: imageUrls }),
      },
    },


  }));

  const seededUsers = await client.query.users.findMany({ columns: { id: true, username: true } });
  for (const { id, username } of seededUsers) {
    await client.update(schema.users).set({ username: buildUsername(username, id) }).where(eq(schema.users.id, id));
  }

  const userIds = seededUsers.map((user) => user.id);
  const restaurantIds = (await client.query.restaurants.findMany({ columns: { id: true } })).map((restaurant) => restaurant.id);
  const reviewIds = (await client.query.reviews.findMany({ columns: { id: true } })).map((review) => review.id);
  const pictureIds = (await client.query.pictures.findMany({ columns: { id: true } })).map((picture) => picture.id);

  const now = new Date();

  const accountRows = userIds.map((userId) => ({
    userId,
    providerId: "google",
    accountId: `seed-google-${userId}`,
  }));
  if (accountRows.length > 0) {
    await client.insert(schema.accounts).values(accountRows);
  }

  const db = createDatabase(client, pictures);
  for (const id of userIds.slice(10)) {
    await createSession(db, id);
  }

  const admin = await client.query.users.findFirst({ columns: { id: true }, where: { role: "admin" } });
  if (!admin) {
    throw new Error("The seed has no Admin to ban users with.");
  }
  const bannableUsers = await client.query.users.findMany({ columns: { username: true }, where: { role: "user" }, limit: 3 });
  for (const { username } of bannableUsers) {
    await db.users.ban(admin.id, username);
  }

  const favoritesRows = uniquePairs(250, userIds, restaurantIds).map(([userId, restaurantId]) => ({
    userId,
    restaurantId,
    updatedAt: now,
  }));
  if (favoritesRows.length > 0) {
    await client.insert(schema.favorites).values(favoritesRows);
  }

  const likesRows = uniquePairs(500, userIds, reviewIds).map(([userId, reviewId]) => ({
    userId,
    reviewId,
    updatedAt: now,
  }));
  if (likesRows.length > 0) {
    await client.insert(schema.likes).values(likesRows);
  }

  const reviewAuthors = new Map(
    (await client.query.reviews.findMany({ columns: { id: true, authorId: true } })).map((review) => [review.id, review.authorId]),
  );
  const likeNotificationRows = likesRows.flatMap(({ userId, reviewId }) => {
    const recipientId = reviewAuthors.get(reviewId);
    return recipientId === undefined || recipientId === userId ? [] : [{ kind: "like" as const, recipientId, actorId: userId, reviewId }];
  });
  if (likeNotificationRows.length > 0) {
    await client.insert(schema.notifications).values(likeNotificationRows);
  }

  const bucketListRows = uniquePairs(100, userIds, restaurantIds).map(([userId, restaurantId]) => ({
    userId,
    restaurantId,
    updatedAt: now,
  }));
  if (bucketListRows.length > 0) {
    await client.insert(schema.bucketList).values(bucketListRows);
  }

  // A picture belongs to one review at most, so deleting a review never takes the pictures of another.
  const shuffledReviewIds = reviewIds.toSorted(() => Math.random() - 0.5);
  const reviewPicturesRows = pictureIds.flatMap((pictureId, i) => {
    const reviewId = shuffledReviewIds[i];
    return reviewId === undefined ? [] : [{ reviewId, pictureId, updatedAt: now }];
  });
  if (reviewPicturesRows.length > 0) {
    await client.insert(schema.reviewPictures).values(reviewPicturesRows);
  }

  client.transaction((tx) => {
    refreshLikeCounts(tx, reviewIds);
    refreshRestaurantStats(tx, restaurantIds);
  });
}

export async function nukeDatabase(client: Client) {
  await reset(client, schema)
}
