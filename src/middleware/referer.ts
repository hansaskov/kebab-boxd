import { sitePath } from "@src/validation/return-path";

// The page on this site that sent the request, or undefined when another site, or no page, sent it.
export function sameOriginReferer(request: Request, origin: string): string | undefined {
	const referer = request.headers.get("Referer");
	if (!referer) return undefined;
	const url = URL.parse(referer);
	return url?.origin === origin ? sitePath(url) : undefined;
}
