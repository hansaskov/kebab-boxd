// What the browser may load and do on the pages of the site.
//
// The site sends no JavaScript, so the policy allows none but the speculation rules, which are data. Styles are
// inline, in style elements and attributes. Pictures come from the site, and the map tiles from OpenStreetMap.
// Forms go only to the site, and no other site may show a page in a frame, where it could trick a user into
// clicking a button.
function contentSecurityPolicy(isDev: boolean) {
	const directives = {
		"default-src": ["'self'"],
		// The dev server adds a script of its own that reloads the page when a file changes.
		"script-src": [...(isDev ? ["'self'"] : []), "'inline-speculation-rules'"],
		"style-src": ["'self'", "'unsafe-inline'"],
		// The seed data of a development database links to example pictures.
		"img-src": ["'self'", "https://tile.openstreetmap.org", ...(isDev ? ["https://images.unsplash.com"] : [])],
		"form-action": ["'self'"],
		"frame-ancestors": ["'none'"],
		"base-uri": ["'none'"],
		"object-src": ["'none'"],
	};
	return Object.entries(directives)
		.map(([name, sources]) => `${name} ${sources.join(" ")}`)
		.join("; ");
}

function securityHeaders(isDev: boolean) {
	return {
		"Content-Security-Policy": contentSecurityPolicy(isDev),
		"X-Content-Type-Options": "nosniff",
		// The default, written out because the site needs it: the middleware reads the page a form was sent from,
		// and OpenStreetMap asks the maps that show its tiles to name themselves.
		"Referrer-Policy": "strict-origin-when-cross-origin",
		// The browser ignores it on a response that did not come over HTTPS, such as one from the dev server.
		"Strict-Transport-Security": "max-age=31536000",
	};
}

// The response with the headers that protect the user. A response whose headers cannot change, such as one
// that Response.redirect makes, is copied.
export function withSecurityHeaders(response: Response, isDev: boolean = import.meta.env.DEV): Response {
	const headers = Object.entries(securityHeaders(isDev));
	try {
		for (const [name, value] of headers) response.headers.set(name, value);
		return response;
	} catch {
		const copy = new Response(response.body, response);
		for (const [name, value] of headers) copy.headers.set(name, value);
		return copy;
	}
}
