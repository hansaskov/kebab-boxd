import { describe, it, expect } from "vitest";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db/index";
import { seedDatabase } from "@src/db/seed";
import * as s from "@src/db/schema";
import { usernameSchema } from "@src/validation/username";

describe("seedDatabase", () => {

  it("populates all tables without constraint violations", async () => {
    const db = createDrizzleDatabase("file:test?mode=memory");
    migrateDrizzleDatabase(db);

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

  it("only creates valid lowercase usernames", async () => {
    const db = createDrizzleDatabase("file:seed-usernames?mode=memory");
    migrateDrizzleDatabase(db);

    await seedDatabase(db);

    const usernames = (await db.select({ username: s.users.username }).from(s.users)).map(
      (row) => row.username,
    );

    expect(usernames.length).toBeGreaterThan(0);
    for (const username of usernames) {
      expect(username).toBe(username.toLowerCase());
      expect(usernameSchema.safeParse(username)).toMatchObject({ success: true, data: username });
    }
  });
});
