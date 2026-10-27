import type { APIRoute } from "astro";
import { experimental_AstroContainer as AstroContainer, type ContainerRenderOptions } from "astro/container";
import ForbiddenPage from "@src/pages/403.astro";
import NotFoundPage from "@src/pages/404.astro";

type Endpoint = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", APIRoute>>;

type Component = Parameters<AstroContainer["renderToResponse"]>[0];

export function renderEndpoint(
	container: AstroContainer,
	endpoint: Endpoint,
	options: Omit<ContainerRenderOptions, "routeType">,
) {
	return container.renderToResponse(endpoint as unknown as Component, { ...options, routeType: "endpoint" });
}

export async function renderPage(page: Component, locals: App.Locals, path: string, params: Record<string, string> = {}) {
	const container = await AstroContainer.create();
	container.insertPageRoute("/403", ForbiddenPage);
	container.insertPageRoute("/404", NotFoundPage);
	const response = await container.renderToResponse(page, {
		locals,
		params,
		request: new Request(`http://localhost${path}`),
	});
	return { response, html: await response.text() };
}

export function decode(html: string) {
	return html.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

export function linkHref(html: string, rel: "prev" | "next") {
	const href = html.match(new RegExp(`rel="${rel}" href="([^"]*)"`))?.[1];
	return href && decode(href);
}

export function listRowLinks(html: string) {
	return [...html.matchAll(/<a class="list-row-link[^"]*" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
		href: decode(match[1]!),
		text: decode(match[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()),
	}));
}
