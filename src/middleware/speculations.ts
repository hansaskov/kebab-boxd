export function redirectClearingSpeculations(location: string) {
	return new Response(null, {
		status: 302,
		headers: {
			Location: location,
			"Cache-Control": "no-store",
			"Clear-Site-Data": "\"prefetchCache\", \"prerenderCache\"",
		},
	});
}

export function isSpeculative(request: Request) {
	return request.headers.get("Sec-Purpose")?.startsWith("prefetch") ?? false;
}

export function refuseSpeculation() {
	return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
}
