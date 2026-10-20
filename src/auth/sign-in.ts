import { eq, sql } from "drizzle-orm";
import { s } from "@src/db";
import type { DB } from "@src/db";
import type { User } from "@src/db/schema";
import { generateSecureRandomString } from "@src/auth/hash";
import type { ProviderAccount } from "@src/auth/provider-account";

const USERNAME_MAX_LENGTH = 30;
const FALLBACK_USERNAME = "kebab";


export class EmailAlreadyRegisteredError extends Error {
	constructor(readonly email: string) {
		super(`An account with the email ${email} already exists.`);
		this.name = "EmailAlreadyRegisteredError";
	}
}

function truncateToLength(value: string, maxLength: number): string {
	return [...value].slice(0, maxLength).join("");
}

function firstNameOf(fullname: string): string {
	return fullname.trim().split(/\s+/).at(0) ?? "";
}

/**
 * Usernames are derived from the first name and made unique with the row id.
 * The id is only known after the insert, so callers update the placeholder.
 */
export function buildUsername(fullname: string, userId: number): string {
	const suffix = `#${userId}`;
	const maxBaseLength = Math.max(0, USERNAME_MAX_LENGTH - suffix.length);
	const base = truncateToLength(firstNameOf(fullname), maxBaseLength).trim();

	return `${base || FALLBACK_USERNAME}${suffix}`;
}

/**
 * Signs in the person behind a verified provider account.
 *
 * The account row is the source of truth for sign-in: a returning person is
 * found by the provider and provider subject id, never by email. A new person
 * gets a user row and an account row in the same transaction, so a half-created
 * login cannot survive a failure.
 */
export async function signInWithProviderAccount(
	db: DB,
	providerAccount: ProviderAccount,
): Promise<User> {
	const email = providerAccount.email.trim().toLowerCase();
	const fullname = providerAccount.fullname.trim();

	const existingAccount = await db.query.accounts.findFirst({
		with: { user: true },
		where: { providerId: providerAccount.providerId, accountId: providerAccount.accountId },
	});

	if (existingAccount) {
		if (providerAccount.emailVerified && !existingAccount.user.emailVerified) {
			await db
				.update(s.users)
				.set({ emailVerified: true })
				.where(eq(s.users.id, existingAccount.user.id));

			return { ...existingAccount.user, emailVerified: true };
		}

		return existingAccount.user;
	}

	return db.transaction((tx) => {
		const conflictingUser = tx
			.select({ id: s.users.id })
			.from(s.users)
			.where(sql`lower(${s.users.email}) = ${email}`)
			.get();

		if (conflictingUser) {
			throw new EmailAlreadyRegisteredError(email);
		}

		const inserted = tx
			.insert(s.users)
			.values({
				fullname,
				username: `pending-${generateSecureRandomString()}`,
				email,
				emailVerified: providerAccount.emailVerified,
			})
			.returning()
			.get();

		if (!inserted) {
			throw new Error("Failed to create a user for the authenticated provider account.");
		}

		const username = buildUsername(fullname, inserted.id);

		tx.update(s.users).set({ username }).where(eq(s.users.id, inserted.id)).run();

		tx.insert(s.accounts)
			.values({
				userId: inserted.id,
				providerId: providerAccount.providerId,
				accountId: providerAccount.accountId,
			})
			.run();

		return { ...inserted, username };
	});
}
