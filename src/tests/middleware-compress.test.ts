import { describe, expect, it } from "vitest";
import { compress } from "@src/middleware/compress";

const runMiddleware = async (
	request: Request,
	response: Response,
	options?: Parameters<typeof compress>[0],
) => {
	const middleware = compress({ threshold: 0, ...options });
	const result = await middleware(
		{ request } as Parameters<typeof middleware>[0],
		async () => response,
	);
	if (!(result instanceof Response)) {
		throw new Error("Compression middleware did not return a response");
	}
	return result;
};

describe("compress middleware", () => {
	it("compresses an accepted response and weakens its ETag", async () => {
		const response = await runMiddleware(
			new Request("http://localhost/", {
				headers: { "Accept-Encoding": "deflate, gzip" },
			}),
			new Response("compressible response", {
				headers: {
					"Content-Type": "text/plain",
					"Content-Length": "20",
					ETag: '"response"',
				},
			}),
		);

		expect(response.headers.get("Content-Encoding")).toBe("gzip");
		expect(response.headers.get("Content-Length")).toBeNull();
		expect(response.headers.get("Vary")).toBe("Accept-Encoding");
		expect(response.headers.get("ETag")).toBe('W/"response"');

		const body = await new Response(
			response.body!.pipeThrough(new DecompressionStream("gzip")),
		).text();
		expect(body).toBe("compressible response");
	});
});
