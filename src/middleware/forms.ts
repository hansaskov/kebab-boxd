import { feedHref, signInHref } from "@src/hrefs";
import { sameOriginReferer } from "@src/middleware/referer";
import { redirectClearingSpeculations } from "@src/middleware/speculations";
import { isSitePath } from "@src/validation/return-path";

// The page a form was sent from, which the answer to it leads back to. The form is sent to the address of its page,
// so that address stands in for a missing Referer. A page at `//evil.com` would send the browser to evil.com, so the
// Feed stands in for it.
export function formPage(request: Request, origin: string, pathname: string): string {
	return sameOriginReferer(request, origin) ?? (isSitePath(pathname) ? pathname : feedHref);
}

// Every action changes something, which a Visitor may not do. A Visitor sees no form, so whoever sent one was logged
// out after its page loaded. They log in, are told why, and come back to the form. Like the answer to every other
// form, the answer clears the pages loaded in advance.
export function answerFormOfVisitor(page: string): Response {
	return redirectClearingSpeculations(signInHref(page, "logged-out"));
}
