import { sitePath } from "@src/auth/return-path";

export function sameOriginReferer(request: Request, origin: string): string | undefined {
	const referer = request.headers.get("Referer");
	if (!referer) return undefined;
	const url = URL.parse(referer);
	return url?.origin === origin ? sitePath(url) : undefined;
}
