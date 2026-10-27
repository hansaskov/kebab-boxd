import { eq } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import type { ActionOutcome } from "@src/actions/outcome";
import type { NewSession, Session } from "@src/db/schema";

export function deleteAllSessionsOf(tx: Transaction, userId: number) {
	tx.delete(s.sessions).where(eq(s.sessions.userId, userId)).run();
}

export function createSessionMutations(client: Client) {
	return {
		async create({ id, userId, secretHash, lastVerifiedAt }: Pick<NewSession, "id" | "userId" | "secretHash" | "lastVerifiedAt">) {
			await client.insert(s.sessions).values({ id, userId, secretHash, lastVerifiedAt });
		},

		async setLastVerifiedAt(id: string, lastVerifiedAt: Date) {
			await client.update(s.sessions).set({ lastVerifiedAt }).where(eq(s.sessions.id, id));
		},

		async setTheme(id: string, theme: Session["theme"]) {
			await client.update(s.sessions).set({ theme }).where(eq(s.sessions.id, id));
		},

		async setActionData(id: string, actionData: ActionOutcome | null) {
			await client.update(s.sessions).set({ actionData }).where(eq(s.sessions.id, id));
		},

		async delete(id: string) {
			await client.delete(s.sessions).where(eq(s.sessions.id, id));
		},
	};
}
