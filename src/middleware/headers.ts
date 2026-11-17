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
