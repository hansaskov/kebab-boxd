import type { APIRoute } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";
import type { Database } from "@src/db";
import { localDatabase, loadingOnce } from "@src/db/remote";

type Component = Parameters<AstroContainer["renderToResponse"]>[0];

type Endpoint = { GET: APIRoute };

type TestLocals = Omit<App.Locals, "cfContext" | "db"> & { db: Database };

function localsOf({ db, ...locals }: TestLocals) {
	return { ...locals, db: loadingOnce(localDatabase(db)) } as App.Locals;
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

