import { feedHref, signInHref } from "@src/hrefs";
import { sameOriginReferer } from "@src/middleware/referer";
import { redirectClearingSpeculations } from "@src/middleware/speculations";
import { isSitePath } from "@src/auth/return-path";

export function formPage(request: Request, origin: string, pathname: string): string {
	return sameOriginReferer(request, origin) ?? (isSitePath(pathname) ? pathname : feedHref);
}

export function answerFormOfVisitor(page: string): Response {
	return redirectClearingSpeculations(signInHref(page, "logged-out"));
}
