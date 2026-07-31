import { describe, it, expect } from "vitest";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@db/index";
import { users } from "@db/schema";

describe("users table constraints", () => {
  it("enforces unique constraint on username", () => {
    const db = createDrizzleDatabase("file:test?mode=memory");
    migrateDrizzleDatabase(db);

    db.insert(users).values({
      username: "testuser",
      fullname: "Test User",
      email: "first@example.com",
      googleId: "google-111",
    }).run();

    expect(() =>
      db.insert(users).values({
        username: "testuser",
        fullname: "Test User 2",
        email: "second@example.com",
        googleId: "google-222",
      }).run()
    ).toThrow();
  });
});
