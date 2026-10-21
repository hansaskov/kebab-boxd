import { describe, it, expect } from "vitest";
import { seedDatabase } from "@src/db/seed";
import * as s from "@src/db/schema";
import { createTestDatabase } from "@src/tests/database";

describe("seedDatabase", () => {

  it("populates all tables without constraint violations", async () => {
    const { client: db } = createTestDatabase("database-seed");

    await expect(seedDatabase(db)).resolves.not.toThrow();

    const counts = {
      pictures: await db.$count(s.pictures),
      users: await db.$count(s.users),
      accounts: await db.$count(s.accounts),
      locations: await db.$count(s.locations),
      restaurants: await db.$count(s.restaurants),
      reviews: await db.$count(s.reviews),
      sessions: await db.$count(s.sessions),
      favorites: await db.$count(s.favorites),
      likes: await db.$count(s.likes),
      bucketList: await db.$count(s.bucketList),
      reviewPictures: await db.$count(s.reviewPictures),
    };

    expect(counts.pictures).toBeGreaterThan(0);
    expect(counts.users).toBeGreaterThan(0);
    expect(counts.accounts).toBe(counts.users);
    expect(counts.locations).toBeGreaterThan(0);
    expect(counts.restaurants).toBeGreaterThan(0);
    expect(counts.reviews).toBeGreaterThan(0);
    expect(counts.sessions).toBeGreaterThan(0);
    expect(counts.favorites).toBeGreaterThan(0);
    expect(counts.likes).toBeGreaterThan(0);
    expect(counts.bucketList).toBeGreaterThan(0);
    expect(counts.reviewPictures).toBeGreaterThan(0);
  });
});
