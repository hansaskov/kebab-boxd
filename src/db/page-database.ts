import type { SessionWithUser } from "@src/auth/sessions.db";
import { loadingWith, pageDatabaseWith, sendQueries, type DatabaseRpc, type PageDatabase, type Queries, type SessionToOpen, type Trip } from "@src/db/remote";

type Opened = SessionWithUser | null;

interface Unopened {
	toOpen: SessionToOpen;
	onOpened: (session: Opened) => void;
}

export type PageSession = Unopened | { opened: Opened };

export interface PageConnection {
	db: PageDatabase;
	session: () => Promise<Opened>;
	openedSession: () => Opened | undefined;
}

export async function openSession(rpc: DatabaseRpc, toOpen: SessionToOpen): Promise<Opened> {
	return (await sendQueries(rpc, {}, { session: toOpen })).session ?? null;
}

export function connectPage(rpc: DatabaseRpc, pageSession: PageSession): PageConnection {
	let opened = "opened" in pageSession ? pageSession.opened : undefined;
	let state: Unopened | { session: Promise<Opened> } = "opened" in pageSession ? { session: Promise.resolve(pageSession.opened) } : pageSession;
	let firstLoad: Error | undefined;

	async function settle(trip: Promise<Trip>, onOpened: Unopened["onOpened"]) {
		opened = (await trip).session ?? null;
		onOpened(opened);
		return opened;
	}

	async function open(queries: Queries, { toOpen, onOpened }: Unopened): Promise<Trip> {
		const trip = sendQueries(rpc, queries, { session: toOpen });
		const session = settle(trip, onOpened);
		state = { session };
		await session;
		return trip;
	}

	async function travel(queries: Queries): Promise<Trip> {
		if (firstLoad) throw new Error("A page loads from the database once. Put every query of the page in the same load.", { cause: firstLoad });
		firstLoad = new Error("The first load of the page");

		if ("toOpen" in state) return open(queries, state);
		const viewer = await state.session;
		return sendQueries(rpc, queries, { viewerId: viewer?.user.id ?? null });
	}

	async function sessionOfPage(): Promise<Opened> {
		if ("session" in state) return state.session;
		return (await travel({})).session ?? null;
	}

	return {
		db: pageDatabaseWith(loadingWith(async (queries) => (await travel(queries)).loaded)),
		session: sessionOfPage,
		openedSession: () => opened,
	};
}
