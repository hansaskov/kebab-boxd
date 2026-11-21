import type { SessionWithUser } from "@src/auth/sessions.db";
import { loadingWith, pageDatabaseWith, sendQueries, type DatabaseRpc, type PageDatabase, type Queries, type SessionToOpen, type Trip } from "@src/db/remote";

type Opened = SessionWithUser | null;

interface SessionNotYetOpened {
	toOpen: SessionToOpen;
	onOpened: (session: Opened) => void;
}

export type PageSession = SessionNotYetOpened | { opened: Opened };

type SessionOfPage = { opensWithFirstLoad: SessionNotYetOpened } | { opening: Promise<Opened> };

export interface PageConnection {
	db: PageDatabase;
	session: () => Promise<Opened>;
	openedSession: () => Opened | undefined;
}

export async function openSession(rpc: DatabaseRpc, toOpen: SessionToOpen): Promise<Opened> {
	return (await sendQueries(rpc, {}, { session: toOpen })).session ?? null;
}

export function connectPage(rpc: DatabaseRpc, pageSession: PageSession): PageConnection {
	let openedSession = "opened" in pageSession ? pageSession.opened : undefined;
	let sessionOfPage: SessionOfPage = "opened" in pageSession ? { opening: Promise.resolve(pageSession.opened) } : { opensWithFirstLoad: pageSession };
	let firstLoadOfPage: Error | undefined;

	function refuseSecondLoad() {
		if (firstLoadOfPage) throw new Error("A page loads from the database once. Put every query of the page in the same load.", { cause: firstLoadOfPage });
		firstLoadOfPage = new Error("The first load of the page");
	}

	async function loadOpeningSession(queries: Queries, { toOpen, onOpened }: SessionNotYetOpened): Promise<Trip> {
		const trip = sendQueries(rpc, queries, { session: toOpen });
		const opening = trip.then((arrived) => {
			openedSession = arrived.session ?? null;
			onOpened(openedSession);
			return openedSession;
		});
		sessionOfPage = { opening };
		await opening;
		return trip;
	}

	async function loadAsViewer(queries: Queries, opening: Promise<Opened>): Promise<Trip> {
		const viewer = await opening;
		return sendQueries(rpc, queries, { viewerId: viewer?.user.id ?? null });
	}

	async function load(queries: Queries): Promise<Trip> {
		refuseSecondLoad();
		if ("opening" in sessionOfPage) return loadAsViewer(queries, sessionOfPage.opening);
		return loadOpeningSession(queries, sessionOfPage.opensWithFirstLoad);
	}

	async function session(): Promise<Opened> {
		if ("opening" in sessionOfPage) return sessionOfPage.opening;
		return (await load({})).session ?? null;
	}

	return {
		db: pageDatabaseWith(loadingWith(async (queries) => (await load(queries)).loaded)),
		session,
		openedSession: () => openedSession,
	};
}
