import { describe, it, expect } from "vitest";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db/index";
import { users } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";

function createTestDb(name: string) {
  const db = createDrizzleDatabase(`file:${name}?mode=memory`);
  migrateDrizzleDatabase(db);
  return db;
}

function insertUser(
  db: ReturnType<typeof createTestDb>,
  overrides: { username: string; email: string },
) {
  const user = db
    .insert(users)
    .values({
      fullname: "Test User",
      ...overrides,
    })
    .returning()
    .get();

  if (!user) {
    throw new Error("Failed to insert test user");
  }

  return user;
}

describe("users table constraints", () => {
  it("enforces unique usernames regardless of letter case", () => {
    const db = createTestDb("constraint-username-case");

    insertUser(db, { username: "kebabking", email: "first@example.com" });

    let error: unknown;
    try {
      insertUser(db, { username: "KebabKing", email: "second@example.com" });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(isUniqueConstraintError(getSQLiteError(error))).toBe(true);
  });

  it("enforces unique emails regardless of letter case", () => {
    const db = createTestDb("constraint-email-case");

    insertUser(db, { username: "first", email: "ada@example.com" });

    let error: unknown;
    try {
      insertUser(db, { username: "second", email: "Ada@Example.com" });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(isUniqueConstraintError(getSQLiteError(error))).toBe(true);
  });
});
