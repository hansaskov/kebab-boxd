import { describe, it, expect } from "vitest";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db/index";
import { users } from "@src/db/schema";
import {
  getSQLiteError,
  isBusyError,
  isConstraintError,
  isUniqueConstraintError,
} from "@src/db/sqlite-errors";

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

    let error: unknown;
    try {
      db.insert(users).values({
        username: "testuser",
        fullname: "Test User 2",
        email: "second@example.com",
        googleId: "google-222",
      }).run();
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeDefined();
    const sqlite = getSQLiteError(error);
    expect(isConstraintError(sqlite)).toBe(true);
    expect(isUniqueConstraintError(sqlite)).toBe(true);
    expect(isBusyError(sqlite)).toBe(false);
  });
});
