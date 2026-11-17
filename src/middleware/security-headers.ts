import { withChangedHeaders } from "@src/middleware/headers";

function contentSecurityPolicy(isDev: boolean) {
	const directives = {
		"default-src": ["'self'"],
		"script-src": [...(isDev ? ["'self'"] : []), "'inline-speculation-rules'"],
		"style-src": ["'self'", "'unsafe-inline'"],
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
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Strict-Transport-Security": "max-age=31536000",
	};
}

export function withSecurityHeaders(response: Response, isDev: boolean = import.meta.env.DEV): Response {
	return withChangedHeaders(response, (headers) => {
		for (const [name, value] of Object.entries(securityHeaders(isDev))) headers.set(name, value);
	});
}
