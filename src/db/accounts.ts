import { eq, sql } from "drizzle-orm";
import { generateSecureRandomString } from "@src/auth/hash";
import type { ProviderAccount } from "@src/auth/oauth";
import type { Client, Transaction } from "@src/db/client";
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

export type SignIn =
	| { status: "signed-in"; user: User }
	| { status: "banned" }
	// Another Account of a User has the email address. That User must sign in with it.
	| { status: "email-taken" };

// The User is created with a placeholder Username, since the preferred one contains their id.
function createUser(tx: Transaction, account: ProviderAccount): User {
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

	const preferred = buildUsername(account.fullname, inserted.id);
	const isTaken = tx.query.users.findFirst({ columns: { id: true }, where: { username: preferred } }).sync();
	const username = isTaken ? buildUsername(account.fullname, generateSecureRandomString()) : preferred;

	tx.update(s.users).set({ username }).where(eq(s.users.id, inserted.id)).run();
	tx.insert(s.accounts).values({ userId: inserted.id, providerId: account.providerId, accountId: account.accountId }).run();
	return { ...inserted, username };
}

export function createAccounts(client: Client) {
	return {
		// Signs in the User of the Account, and creates both on the first sign-in. While no Admin exists, the
		// User with the verified bootstrap email address becomes one, so each stage gets its first Admin.
		async signIn(providerAccount: ProviderAccount, bootstrapAdminEmail?: string): Promise<SignIn> {
			const account = {
				...providerAccount,
				email: providerAccount.email.trim().toLowerCase(),
				fullname: providerAccount.fullname.trim(),
			};
			const isBootstrapAdmin = account.emailVerified && !!bootstrapAdminEmail && account.email === bootstrapAdminEmail.trim().toLowerCase();
			return client.transaction((tx): SignIn => {
				const signIn = signInUser(tx, account);
				if (signIn.status !== "signed-in" || !isBootstrapAdmin || signIn.user.role === "admin") return signIn;
				if (tx.query.users.findFirst({ columns: { id: true }, where: { role: "admin" } }).sync()) return signIn;

				tx.update(s.users).set({ role: "admin" }).where(eq(s.users.id, signIn.user.id)).run();
				return { status: "signed-in", user: { ...signIn.user, role: "admin" } };
			});
		},
	};
}

function signInUser(tx: Transaction, account: ProviderAccount): SignIn {
	const existing = tx.query.accounts
		.findFirst({
			columns: {},
			with: { user: true },
			where: { providerId: account.providerId, accountId: account.accountId },
		})
		.sync();
	if (existing) {
		const { user } = existing;
		if (user.bannedAt) return { status: "banned" };
		if (account.emailVerified && !user.emailVerified) {
			tx.update(s.users).set({ emailVerified: true }).where(eq(s.users.id, user.id)).run();
			return { status: "signed-in", user: { ...user, emailVerified: true } };
		}
		return { status: "signed-in", user };
	}

	const emailOwner = tx.query.users
		.findFirst({ columns: { bannedAt: true }, where: { RAW: (user) => sql`lower(${user.email}) = ${account.email}` } })
		.sync();
	if (emailOwner) return { status: emailOwner.bannedAt ? "banned" : "email-taken" };

	return { status: "signed-in", user: createUser(tx, account) };
}
