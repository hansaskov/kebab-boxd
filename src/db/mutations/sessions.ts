import { eq, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import type { ActionData, NewSession, Session } from "@src/db/schema";

export function prepareDeleteAllForUser(client: Client) {
	return client
		.delete(s.sessions)
		.where(eq(s.sessions.userId, sql.placeholder("userId")))
		.prepare();
}

export function createSessionMutations(client: Client) {
	const insert = client
		.insert(s.sessions)
		.values({
			id: sql.placeholder("id"),
			userId: sql.placeholder("userId"),
			secretHash: sql.placeholder("secretHash"),
			lastVerifiedAt: sql.placeholder("lastVerifiedAt"),
		})
		.prepare();

	const setLastVerifiedAt = client
		.update(s.sessions)
		.set({ lastVerifiedAt: sql.placeholder("lastVerifiedAt") })
		.where(eq(s.sessions.id, sql.placeholder("id")))
		.prepare();

	const setTheme = client
		.update(s.sessions)
		.set({ theme: sql.placeholder("theme") })
		.where(eq(s.sessions.id, sql.placeholder("id")))
		.prepare();

	const setActionData = client
		.update(s.sessions)
		.set({ actionData: sql.placeholder("actionData") })
		.where(eq(s.sessions.id, sql.placeholder("id")))
		.prepare();

	const deleteById = client
		.delete(s.sessions)
		.where(eq(s.sessions.id, sql.placeholder("id")))
		.prepare();

	const deleteByUser = prepareDeleteAllForUser(client);

	return {
		async create(session: Pick<NewSession, "id" | "userId" | "secretHash" | "lastVerifiedAt">) {
			insert.run(session);
		},

		async setLastVerifiedAt(id: string, lastVerifiedAt: Date) {
			setLastVerifiedAt.run({ id, lastVerifiedAt });
		},

		async setTheme(id: string, theme: Session["theme"]) {
			setTheme.run({ id, theme });
		},

		async setActionData(id: string, actionData: ActionData | null) {
			setActionData.run({ id, actionData });
		},

		async delete(id: string) {
			deleteById.run({ id });
		},

		async deleteAllForUser(userId: number) {
			deleteByUser.run({ userId });
		},
	};
}
