import type { Database } from "@src/db";
import type { User } from "@src/db/schema";
import type { ProviderAccount } from "@src/auth/provider-account";

export class EmailAlreadyRegisteredError extends Error {
	constructor(readonly email: string) {
		super(`An account with the email ${email} already exists.`);
		this.name = "EmailAlreadyRegisteredError";
	}
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
	db: Database,
	providerAccount: ProviderAccount,
): Promise<User> {
	const email = providerAccount.email.trim().toLowerCase();
	const fullname = providerAccount.fullname.trim();

	const existingAccount = await db.queries.accounts.findWithUser(
		providerAccount.providerId,
		providerAccount.accountId,
	);

	if (existingAccount) {
		if (providerAccount.emailVerified && !existingAccount.user.emailVerified) {
			await db.mutations.users.verifyEmail(existingAccount.user.id);

			return { ...existingAccount.user, emailVerified: true };
		}

		return existingAccount.user;
	}

	const created = await db.mutations.accounts.createWithUser({ ...providerAccount, email, fullname });

	if (created === "email-taken") {
		throw new EmailAlreadyRegisteredError(email);
	}

	return created;
}
