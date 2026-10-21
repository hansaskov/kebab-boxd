import type { Database } from "@src/db";
import type { User } from "@src/db/schema";
import type { ProviderAccount } from "@src/auth/provider-account";

export class EmailAlreadyRegisteredError extends Error {
	constructor(readonly email: string) {
		super(`An account with the email ${email} already exists.`);
		this.name = "EmailAlreadyRegisteredError";
	}
}

export class UserBannedError extends Error {
	constructor(readonly userId: number) {
		super(`User ${userId} is banned.`);
		this.name = "UserBannedError";
	}
}

export async function signInWithProviderAccount(
	db: Database,
	providerAccount: ProviderAccount,
): Promise<User> {
	const email = providerAccount.email.trim().toLowerCase();
	const fullname = providerAccount.fullname.trim();

	const result = await db.mutations.accounts.findOrCreateWithUser({ ...providerAccount, email, fullname });

	switch (result.status) {
		case "created":
			return result.user;

		case "email-taken":
			// A banned user who signs in with another provider account is told about the ban.
			if (result.user.bannedAt) {
				throw new UserBannedError(result.user.id);
			}
			throw new EmailAlreadyRegisteredError(email);

		case "existing":
			if (result.user.bannedAt) {
				throw new UserBannedError(result.user.id);
			}

			if (providerAccount.emailVerified && !result.user.emailVerified) {
				await db.mutations.users.verifyEmail(result.user.id);

				return { ...result.user, emailVerified: true };
			}

			return result.user;
	}
}
