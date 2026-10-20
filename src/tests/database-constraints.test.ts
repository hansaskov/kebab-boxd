import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createDrizzleDatabase, migrateDrizzleDatabase } from "@src/db/index";
import { accounts, users } from "@src/db/schema";
import {
  getSQLiteError,
  isBusyError,
  isConstraintError,
  isUniqueConstraintError,
} from "@src/db/sqlite-errors";

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
  it("enforces unique constraint on username", () => {
    const db = createTestDb("constraint-username");

    insertUser(db, { username: "testuser", email: "first@example.com" });

    let error: unknown;
    try {
      insertUser(db, { username: "testuser", email: "second@example.com" });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeDefined();
    const sqlite = getSQLiteError(error);
    expect(isConstraintError(sqlite)).toBe(true);
    expect(isUniqueConstraintError(sqlite)).toBe(true);
    expect(isBusyError(sqlite)).toBe(false);
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

describe("accounts table constraints", () => {
  it("accepts an account that only has the provider ids", async () => {
    const db = createTestDb("constraint-account-minimal");
    const user = insertUser(db, { username: "ada", email: "ada@example.com" });

    db.insert(accounts)
      .values({
        userId: user.id,
        providerId: "google",
        accountId: "google-sub-1",
      })
      .run();

    const account = await db.query.accounts.findFirst();

    expect(account).toMatchObject({
      userId: user.id,
      providerId: "google",
      accountId: "google-sub-1",
    });
  });

  it("enforces uniqueness of the provider and account id pair", async () => {
    const db = createTestDb("constraint-account-unique");
    const firstUser = insertUser(db, { username: "first", email: "first@example.com" });
    const secondUser = insertUser(db, { username: "second", email: "second@example.com" });

    db.insert(accounts)
      .values({ userId: firstUser.id, providerId: "google", accountId: "shared-sub" })
      .run();

    let error: unknown;
    try {
      db.insert(accounts)
        .values({ userId: secondUser.id, providerId: "google", accountId: "shared-sub" })
        .run();
    } catch (caughtError) {
      error = caughtError;
    }

    expect(isUniqueConstraintError(getSQLiteError(error))).toBe(true);
  });

  it("allows the same provider account id for different providers", async () => {
    const db = createTestDb("constraint-account-providers");
    const firstUser = insertUser(db, { username: "first", email: "first@example.com" });
    const secondUser = insertUser(db, { username: "second", email: "second@example.com" });

    db.insert(accounts)
      .values({ userId: firstUser.id, providerId: "google", accountId: "shared-sub" })
      .run();
    db.insert(accounts)
      .values({ userId: secondUser.id, providerId: "github", accountId: "shared-sub" })
      .run();

    expect(await db.$count(accounts)).toBe(2);
  });

  it("removes accounts when their user is deleted", async () => {
    const db = createTestDb("constraint-account-cascade");
    const user = insertUser(db, { username: "ada", email: "ada@example.com" });

    db.insert(accounts)
      .values({ userId: user.id, providerId: "google", accountId: "google-sub-1" })
      .run();

    db.delete(users).where(eq(users.id, user.id)).run();

    expect(await db.$count(accounts)).toBe(0);
  });
});
