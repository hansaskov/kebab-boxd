import type { APIRoute } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";

type Component = Parameters<AstroContainer["renderToResponse"]>[0];

type Endpoint = { GET: APIRoute };

async function createContainer() {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	return container;
}

export async function renderPage(page: Component, locals: App.Locals, path: string, params: Record<string, string> = {}) {
	const response = await (await createContainer()).renderToResponse(page, {
		locals,
		params,
		request: new Request(`http://localhost${path}`),
	});
	return { response, html: await response.text() };
}

export async function requestEndpoint(endpoint: Endpoint, locals: App.Locals, path: string, params: Record<string, string> = {}, headers: HeadersInit = {}) {
	return (await createContainer()).renderToResponse(endpoint as unknown as Component, {
		locals,
		params,
		request: new Request(`http://localhost${path}`, { headers }),
		routeType: "endpoint",
	});
}
