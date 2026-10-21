import { describe, it, expect } from "vitest";
import type { Client } from "@src/db/client";
import { users } from "@src/db/schema";
import { getSQLiteError, isUniqueConstraintError } from "@src/db/sqlite-errors";
import { createTestDatabase } from "@src/tests/database";

function insertUser(
  client: Client,
  overrides: { username: string; email: string },
) {
  const user = client
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
    const { client } = createTestDatabase("constraint-username-case");

    insertUser(client, { username: "kebabking", email: "first@example.com" });

    let error: unknown;
    try {
      insertUser(client, { username: "KebabKing", email: "second@example.com" });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(isUniqueConstraintError(getSQLiteError(error))).toBe(true);
  });

  it("enforces unique emails regardless of letter case", () => {
    const { client } = createTestDatabase("constraint-email-case");

    insertUser(client, { username: "first", email: "ada@example.com" });

    let error: unknown;
    try {
      insertUser(client, { username: "second", email: "Ada@Example.com" });
    } catch (caughtError) {
      error = caughtError;
    }

    expect(isUniqueConstraintError(getSQLiteError(error))).toBe(true);
  });
});
