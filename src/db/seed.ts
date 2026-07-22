import { reset, seed } from "drizzle-seed";
import * as schema from "./schema";
import type { DB } from "./index";
import { pronouns } from "@data/pronouns";
import { createSession } from "@auth/session";

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
    const key = `${l}:${r}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push([l, r]);
    }
  }

  return result;
}

export async function seedDatabase(db: DB) {
  await seed(db, parentSchema).refine((funcs) => ({
    users: {
      count: 50,
      columns: {
        username: funcs.firstName({ isUnique: true }),
        email: funcs.email(),
        googleId: funcs.string({ isUnique: true }),
        isAdmin: funcs.weightedRandom([
          { weight: 0.9, value: funcs.default({ defaultValue: false }) },
          { weight: 0.1, value: funcs.default({ defaultValue: true }) },
        ]),
        bio: funcs.weightedRandom([
          { weight: 0.6, value: funcs.loremIpsum() },
          { weight: 0.4, value: funcs.default({ defaultValue: null }) },
        ]),
        pronoun: funcs.valuesFromArray({ values: [...pronouns] }),
        latitude: funcs.number({ minValue: -90, maxValue: 90, precision: 10000 }),
        longitude: funcs.number({ minValue: -180, maxValue: 180, precision: 10000 }),
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
        latitude: funcs.number({ minValue: -90, maxValue: 90, precision: 10000 }),
        longitude: funcs.number({ minValue: -180, maxValue: 180, precision: 10000 }),
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
        googlePlaceId: funcs.string({ isUnique: true }),
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

  const userIds = (await db.select({ id: schema.users.id }).from(schema.users)).map((r) => r.id);
  const restaurantIds = (await db.select({ id: schema.restaurants.id }).from(schema.restaurants)).map((r) => r.id);
  const reviewIds = (await db.select({ id: schema.reviews.id }).from(schema.reviews)).map((r) => r.id);
  const pictureIds = (await db.select({ id: schema.pictures.id }).from(schema.pictures)).map((r) => r.id);

  const now = new Date();

  userIds.slice(10).forEach(async id => { await createSession(id, db) })
   
  const favoritesRows = uniquePairs(250, userIds, restaurantIds).map(([userId, restaurantId]) => ({
    userId,
    restaurantId,
    updatedAt: now,
  }));
  if (favoritesRows.length > 0) {
    await db.insert(schema.favorites).values(favoritesRows);
  }

  const likesRows = uniquePairs(500, userIds, reviewIds).map(([userId, reviewId]) => ({
    userId,
    reviewId,
    updatedAt: now,
  }));
  if (likesRows.length > 0) {
    await db.insert(schema.likes).values(likesRows);
  }

  const bucketListRows = uniquePairs(100, userIds, restaurantIds).map(([userId, restaurantId]) => ({
    userId,
    restaurantId,
    updatedAt: now,
  }));
  if (bucketListRows.length > 0) {
    await db.insert(schema.bucketList).values(bucketListRows);
  }

  const reviewPicturesRows = uniquePairs(150, reviewIds, pictureIds).map(([reviewId, pictureId]) => ({
    reviewId,
    pictureId,
    updatedAt: now,
  }));
  if (reviewPicturesRows.length > 0) {
    await db.insert(schema.reviewPictures).values(reviewPicturesRows);
  }
}

export async function nukeDatabase(db: DB) {
  await reset(db, schema)
}