// A page the browser prefetched or prerendered before a change still shows the old state, and the browser
// would show that copy on the next visit instead of asking the server again.
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

// The browser loads a page in advance when it guesses the user opens it next, and says so in Sec-Purpose:
// "prefetch" for a prefetch and "prefetch;prerender" for a prerender.
export function isSpeculative(request: Request) {
	return request.headers.get("Sec-Purpose")?.startsWith("prefetch") ?? false;
}

// Refuses a page loaded in advance. The browser throws away a response that is not a success and asks
// again when the user opens the page.
export function refuseSpeculation() {
	return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
}
