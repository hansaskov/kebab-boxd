import { and, eq, getColumns, sql } from "drizzle-orm";
import { generateSecureRandomString } from "@src/auth/hash";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import type { User } from "@src/db/schema";
import { USERNAME_MAX_LENGTH } from "@src/validation/username";

const FALLBACK_USERNAME = "kebab";

function firstNameOf(fullname: string): string {
	return fullname.trim().split(/\s+/).at(0) ?? "";
}

/** Drops accents and every character a username may not contain, then lowercases. */
function toUsernameCharacters(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9_]/g, "")
		.toLowerCase();
}

/**
 * Usernames are derived from the first name and made unique with a suffix,
 * normally the row id. The id is only known after the insert, so callers
 * update the placeholder.
 */
export function buildUsername(fullname: string, suffix: number | string): string {
	const separatedSuffix = `_${suffix}`;
	const maxBaseLength = Math.max(0, USERNAME_MAX_LENGTH - separatedSuffix.length);
	const base = toUsernameCharacters(firstNameOf(fullname)).slice(0, maxBaseLength);

	return `${base || FALLBACK_USERNAME}${separatedSuffix}`;
}

export interface NewUserWithAccount {
	providerId: string;
	accountId: string;
	fullname: string;
	email: string;
	emailVerified: boolean;
}

export type SignInResult =
	| { status: "existing"; user: User }
	| { status: "created"; user: User }
	| { status: "email-taken"; user: Pick<User, "id" | "bannedAt"> };

export function createAccountMutations(client: Client) {
	const userByAccount = client
		.select(getColumns(s.users))
		.from(s.accounts)
		.innerJoin(s.users, eq(s.users.id, s.accounts.userId))
		.where(
			and(
				eq(s.accounts.providerId, sql.placeholder("providerId")),
				eq(s.accounts.accountId, sql.placeholder("accountId")),
			),
		)
		.prepare();

	const userByEmail = client
		.select({ id: s.users.id, bannedAt: s.users.bannedAt })
		.from(s.users)
		.where(sql`lower(${s.users.email}) = lower(${sql.placeholder("email")})`)
		.prepare();

	const userIdByUsername = client
		.select({ id: s.users.id })
		.from(s.users)
		.where(sql`lower(${s.users.username}) = lower(${sql.placeholder("username")})`)
		.prepare();

	const insertUser = client
		.insert(s.users)
		.values({
			fullname: sql.placeholder("fullname"),
			username: sql.placeholder("username"),
			email: sql.placeholder("email"),
			emailVerified: sql.placeholder("emailVerified"),
		})
		.returning()
		.prepare();

	const setUsername = client
		.update(s.users)
		.set({ username: sql.placeholder("username") })
		.where(eq(s.users.id, sql.placeholder("id")))
		.prepare();

	const insertAccount = client
		.insert(s.accounts)
		.values({
			userId: sql.placeholder("userId"),
			providerId: sql.placeholder("providerId"),
			accountId: sql.placeholder("accountId"),
		})
		.prepare();

	return {
		/**
		 * Finds the user who signs in with the account, or creates both. Returns the user who
		 * already has the email, without creating anything, when the account is new but the email
		 * is not.
		 */
		async findOrCreateWithUser(account: NewUserWithAccount): Promise<SignInResult> {
			// Everything from the lookup to the inserts is one transaction, so two sign-ins with the
			// same new account cannot both see it missing. The callback must stay synchronous: the
			// driver commits as soon as it returns. The prepared statements run on the same
			// connection, so they take part in the transaction, and an error rolls all of them back.
			// "immediate" takes the write lock before the first read, so the transaction cannot fail
			// with SQLITE_BUSY part way when another connection writes to the file.
			return client.transaction(
				(): SignInResult => {
					const existing = userByAccount.get({
						providerId: account.providerId,
						accountId: account.accountId,
					});
					if (existing) {
						return { status: "existing", user: existing };
					}

					const emailTakenBy = userByEmail.get({ email: account.email });
					if (emailTakenBy) {
						return { status: "email-taken", user: emailTakenBy };
					}

					// The username must be unique, but the one we want depends on the id this insert creates.
					const inserted = insertUser.get({
						fullname: account.fullname,
						username: `pending-${crypto.randomUUID()}`,
						email: account.email,
						emailVerified: account.emailVerified,
					});

					if (!inserted) {
						throw new Error("Failed to create a user for the provider account.");
					}

					// Someone may already have picked the id-based name in settings.
					const preferredUsername = buildUsername(account.fullname, inserted.id);
					const username = userIdByUsername.get({ username: preferredUsername })
						? buildUsername(account.fullname, generateSecureRandomString())
						: preferredUsername;

          setUsername.run({ id: inserted.id, username });

					insertAccount.run({
						userId: inserted.id,
						providerId: account.providerId,
						accountId: account.accountId,
					});

					return { status: "created", user: { ...inserted, username } };
				},
				{ behavior: "immediate" },
			);
		},
	};
}
