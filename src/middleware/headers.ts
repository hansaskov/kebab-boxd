// The response with its headers changed. A response whose headers cannot change, such as one that
// Response.redirect makes, is copied. Its first change throws before it changes anything, so none is made twice.
export function withChangedHeaders(response: Response, change: (headers: Headers) => void): Response {
	try {
		change(response.headers);
		return response;
	} catch {
		const copy = new Response(response.body, response);
		change(copy.headers);
		return copy;
	}
}
