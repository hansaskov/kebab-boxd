import type { APIRoute } from "astro";
import type { experimental_AstroContainer as AstroContainer, ContainerRenderOptions } from "astro/container";

type Endpoint = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", APIRoute>>;

type Component = Parameters<AstroContainer["renderToResponse"]>[0];

export function renderEndpoint(
	container: AstroContainer,
	endpoint: Endpoint,
	options: Omit<ContainerRenderOptions, "routeType">,
) {
	return container.renderToResponse(endpoint as unknown as Component, { ...options, routeType: "endpoint" });
}
