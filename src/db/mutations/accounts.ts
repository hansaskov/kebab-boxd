import { eq, sql } from "drizzle-orm";
import { generateSecureRandomString } from "@src/auth/hash";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import type { User } from "@src/db/schema";
import { USERNAME_MAX_LENGTH } from "@src/validation/username";

const FALLBACK_USERNAME = "kebab";

function firstNameOf(fullname: string): string {
	return fullname.trim().split(/\s+/).at(0) ?? "";
}

function toUsernameCharacters(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[^A-Za-z0-9_]/g, "")
		.toLowerCase();
}

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
	return {
		async findOrCreateWithUser(account: NewUserWithAccount): Promise<SignInResult> {
			return client.transaction(
				(tx): SignInResult => {
					const existing = tx.query.accounts
						.findFirst({
							columns: {},
							with: { user: true },
							where: { providerId: account.providerId, accountId: account.accountId },
						})
						.sync();
					if (existing) {
						return { status: "existing", user: existing.user };
					}

					const emailTakenBy = tx.query.users
						.findFirst({ columns: { id: true, bannedAt: true }, where: { RAW: (user) => sql`lower(${user.email}) = lower(${account.email})` } })
						.sync();
					if (emailTakenBy) {
						return { status: "email-taken", user: emailTakenBy };
					}

					const inserted = tx
						.insert(s.users)
						.values({
							fullname: account.fullname,
							username: `pending-${crypto.randomUUID()}`,
							email: account.email,
							emailVerified: account.emailVerified,
						})
						.returning()
						.get();

					const preferredUsername = buildUsername(account.fullname, inserted.id);
					const preferredIsTaken = tx.query.users
						.findFirst({ columns: { id: true }, where: { username: preferredUsername.toLowerCase() } })
						.sync();
					const username = preferredIsTaken
						? buildUsername(account.fullname, generateSecureRandomString())
						: preferredUsername;

					tx.update(s.users).set({ username }).where(eq(s.users.id, inserted.id)).run();
					tx.insert(s.accounts)
						.values({ userId: inserted.id, providerId: account.providerId, accountId: account.accountId })
						.run();

					return { status: "created", user: { ...inserted, username } };
				},
				{ behavior: "immediate" },
			);
		},
	};
}
