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
