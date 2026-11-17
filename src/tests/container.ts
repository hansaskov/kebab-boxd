import type { APIRoute } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import type { ActionOutcome } from "@src/actions/outcome";
import type { Database } from "@src/db";
import { connectPage } from "@src/db/page-database";
import { localRpc, type DatabaseRequest, type DatabaseRpc } from "@src/db/remote";
import type { TestSession } from "@src/tests/database";

type Component = Parameters<AstroContainer["renderToResponse"]>[0];

type Endpoint = { GET: APIRoute };

export interface TestLocals {
	db: Database;
	session: TestSession | null;
	actionOutcome?: ActionOutcome | undefined;
	onTrip?: (request: DatabaseRequest) => void;
}

function watched(rpc: DatabaseRpc, onTrip: TestLocals["onTrip"]): DatabaseRpc {
	return {
		call: (request) => {
			onTrip?.(request);
			return rpc.call(request);
		},
	};
}

function localsOf({ db, session, actionOutcome, onTrip }: TestLocals): App.Locals {
	const page = connectPage(
		watched(localRpc(db), onTrip),
		session
			? {
					toOpen: { token: session.token, takeActionOutcome: true },
					onOpened: (opened) => {
						if (opened?.actionOutcome) locals.actionOutcome = opened.actionOutcome;
					},
				}
			: { opened: null },
	);
	const locals: Omit<App.Locals, "cfContext"> = { db: page.db, session: page.session, actionOutcome };
	return locals as App.Locals;
}

async function createContainer() {
	const container = await AstroContainer.create({ astroConfig: { site: import.meta.env.SITE } });
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	return container;
}

function requestFor(path: string, headers: HeadersInit) {
	return new Request(/^https?:\/\//.test(path) ? path : `http://localhost${path}`, { headers });
}

export async function renderPage(page: Component, locals: TestLocals, path: string, params: Record<string, string> = {}, headers: HeadersInit = {}) {
	const response = await (await createContainer()).renderToResponse(page, {
		locals: localsOf(locals),
		params,
		request: requestFor(path, headers),
	});
	return { response, html: await response.text() };
}

export async function requestEndpoint(endpoint: Endpoint, locals: TestLocals, path: string, params: Record<string, string> = {}, headers: HeadersInit = {}) {
	return (await createContainer()).renderToResponse(endpoint as unknown as Component, {
		locals: localsOf(locals),
		params,
		request: requestFor(path, headers),
		routeType: "endpoint",
	});
}
