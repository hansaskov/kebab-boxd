// Heavily inspired/copies from Hono's compression middleware: https://raw.githubusercontent.com/honojs/hono/192768fbaf9aa99a45404dc2f171541227c11d20/src/middleware/compress/index.ts

import { defineMiddleware } from "astro:middleware";

/** Content types that are normally safe and useful to compress. */
export const COMPRESSIBLE_CONTENT_TYPE_REGEX =
	/^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|msgpack|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|vnd\.msgpack|wasm|x-httpd-php|x-javascript|x-msgpack|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml|msgpack))(?:[;\s]|$)/i;

const ENCODING_TYPES = ["gzip", "deflate"] as const;
type Encoding = (typeof ENCODING_TYPES)[number];
const cacheControlNoTransformRegExp = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i;
const varyAcceptEncodingRegExp = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;

type ContentTypeFilter = RegExp | ((contentType: string) => boolean);

export interface CompressionOptions {
	encoding?: Encoding;
	threshold?: number;
	contentTypeFilter?: ContentTypeFilter;
}

interface Accept {
	type: string;
	params: Record<string, string>;
	q: number;
}

const isWhitespace = (char: number): boolean =>
	char === 32 || char === 9 || char === 10 || char === 13;

const consumeWhitespace = (header: string, startIndex: number): number => {
	while (startIndex < header.length && isWhitespace(header.charCodeAt(startIndex))) {
		startIndex++;
	}
	return startIndex;
};

const ignoreTrailingWhitespace = (header: string, startIndex: number): number => {
	while (startIndex > 0 && isWhitespace(header.charCodeAt(startIndex - 1))) {
		startIndex--;
	}
	return startIndex;
};

const skipInvalidParam = (
	header: string,
	startIndex: number,
): [number, boolean] => {
	while (startIndex < header.length) {
		const char = header.charCodeAt(startIndex);
		if (char === 59) {
			return [startIndex + 1, true];
		}
		if (char === 44) {
			return [startIndex + 1, false];
		}
		startIndex++;
	}
	return [startIndex, false];
};

const skipInvalidAcceptValue = (header: string, startIndex: number): number => {
	let index = startIndex;
	let inQuotes = false;
	while (index < header.length) {
		const char = header.charCodeAt(index);
		if (inQuotes && char === 92) {
			index++;
		} else if (char === 34) {
			inQuotes = !inQuotes;
		} else if (!inQuotes && char === 44) {
			return index + 1;
		}
		index++;
	}
	return index;
};

const getNextParam = (
	header: string,
	startIndex: number,
): [number, string | undefined, string | undefined, boolean] => {
	startIndex = consumeWhitespace(header, startIndex);
	let index = startIndex;
	let key: string | undefined;
	let value: string | undefined;
	let hasNext = false;

	while (index < header.length) {
		const char = header.charCodeAt(index);
		if (char === 61) {
			key = header.slice(startIndex, ignoreTrailingWhitespace(header, index));
			index++;
			break;
		}
		if (char === 59) {
			return [index + 1, undefined, undefined, true];
		}
		if (char === 44) {
			return [index + 1, undefined, undefined, false];
		}
		index++;
	}
	if (key === undefined) {
		return [index, undefined, undefined, false];
	}

	index = consumeWhitespace(header, index);
	if (header.charCodeAt(index) === 61) {
		const skipResult = skipInvalidParam(header, index + 1);
		return [skipResult[0], key, undefined, skipResult[1]];
	}

	let inQuotes = false;
	const valueStartIndex = index;
	while (index < header.length) {
		const char = header.charCodeAt(index);
		if (inQuotes && char === 92) {
			index++;
		} else if (char === 34) {
			if (inQuotes) {
				let nextIndex = consumeWhitespace(header, index + 1);
				const nextChar = header.charCodeAt(nextIndex);
				if (
					nextIndex < header.length &&
					!(nextChar === 59 || nextChar === 44)
				) {
					const skipResult = skipInvalidParam(header, nextIndex);
					return [skipResult[0], key, undefined, skipResult[1]];
				}
				value = header.slice(valueStartIndex + 1, index);
				if (value.includes("\\")) {
					value = value.replace(/\\(.)/g, "$1");
				}
				if (nextChar === 44) {
					return [nextIndex + 1, key, value, false];
				}
				if (nextChar === 59) {
					nextIndex++;
					hasNext = true;
				}
				index = nextIndex;
				break;
			}
			inQuotes = true;
		} else if (!inQuotes && (char === 59 || char === 44)) {
			value = header.slice(valueStartIndex, ignoreTrailingWhitespace(header, index));
			if (char === 59) {
				hasNext = true;
			}
			index++;
			break;
		}
		index++;
	}

	return [
		index,
		key,
		value ?? header.slice(valueStartIndex, ignoreTrailingWhitespace(header, index)),
		hasNext,
	];
};

const getNextAcceptValue = (
	header: string,
	startIndex: number,
): [number, Accept | undefined] => {
	const accept: Accept = {
		type: "",
		params: Object.create(null) as Record<string, string>,
		q: 1,
	};
	startIndex = consumeWhitespace(header, startIndex);
	let index = startIndex;

	while (index < header.length) {
		const char = header.charCodeAt(index);
		if (char === 59 || char === 44) {
			accept.type = header.slice(startIndex, ignoreTrailingWhitespace(header, index));
			index++;
			if (char === 44) {
				return [index, accept.type ? accept : undefined];
			}
			if (!accept.type) {
				return [skipInvalidAcceptValue(header, index), undefined];
			}
			break;
		}
		index++;
	}

	if (!accept.type) {
		accept.type = header.slice(startIndex, ignoreTrailingWhitespace(header, header.length));
		return [header.length, accept.type ? accept : undefined];
	}

	let param: string | undefined;
	let value: string | undefined;
	let hasNext: boolean;
	while (index < header.length) {
		[index, param, value, hasNext] = getNextParam(header, index);
		if (param && value) {
			accept.params[param] = value;
		}
		if (!hasNext) {
			break;
		}
	}

	return [index, accept];
};

const parseQuality = (value?: string): number => {
	if (value === undefined || value === "") {
		return 1;
	}
	if (value === "NaN") {
		return 0;
	}
	const number = Number(value);
	if (number === Infinity) {
		return 1;
	}
	if (number === -Infinity) {
		return 0;
	}
	if (Number.isNaN(number)) {
		return 1;
	}
	if (number < 0 || number > 1) {
		return 1;
	}
	return number;
};

const parseAccept = (header: string): Accept[] => {
	if (!header) {
		return [];
	}

	const values: Accept[] = [];
	let index = 0;
	let accept: Accept | undefined;
	let requiresSort = false;
	let lastAccept: Accept | undefined;
	while (index < header.length) {
		[index, accept] = getNextAcceptValue(header, index);
		if (accept) {
			accept.q = parseQuality(accept.params.q);
			values.push(accept);
			if (lastAccept && lastAccept.q < accept.q) {
				requiresSort = true;
			}
			lastAccept = accept;
		}
	}
	if (requiresSort) {
		values.sort((a, b) => b.q - a.q);
	}
	return values;
};

const selectEncoding = (
	header: string | undefined,
	candidates: readonly Encoding[],
): Encoding | undefined => {
	if (header === undefined) {
		return undefined;
	}

	const accepts = parseAccept(header);
	const wildcardQ = accepts.find((accept) => accept.type === "*")?.q;
	let best: { encoding: Encoding; q: number } | undefined;
	for (const encoding of candidates) {
		const explicit = accepts.find(
			(accept) => accept.type.toLowerCase() === encoding,
		);
		const q = explicit ? explicit.q : (wildcardQ ?? 0);
		if (q === 1) {
			return encoding;
		}
		if (q > 0 && (!best || q > best.q)) {
			best = { encoding, q };
		}
	}
	return best?.encoding;
};

const shouldTransform = (response: Response): boolean => {
	const cacheControl = response.headers.get("Cache-Control");
	return !cacheControl || !cacheControlNoTransformRegExp.test(cacheControl);
};

/**
 * Create Astro compression middleware.
 *
 * If no encoding is configured, gzip is preferred over deflate when both are
 * accepted by the client. The default minimum response size is 1024 bytes.
 */
export const compress = (options?: CompressionOptions) => {
	const threshold = options?.threshold ?? 1024;
	const candidates: readonly Encoding[] = options?.encoding
		? [options.encoding]
		: ENCODING_TYPES;
	const contentTypeFilter =
		options?.contentTypeFilter ?? COMPRESSIBLE_CONTENT_TYPE_REGEX;

	const shouldCompress = (response: Response): boolean => {
		const type = response.headers.get("Content-Type");
		if (!type) {
			return false;
		}
		return typeof contentTypeFilter === "function"
			? contentTypeFilter(type)
			: contentTypeFilter.test(type);
	};

	return defineMiddleware(async (context, next) => {
		const response = await next();
		const contentLength = response.headers.get("Content-Length");

		if (
			response.status === 206 ||
			response.headers.has("Content-Encoding") ||
			response.headers.has("Transfer-Encoding") ||
			context.request.method === "HEAD" ||
			(contentLength !== null && contentLength !== "" && Number(contentLength) < threshold) ||
			!shouldCompress(response) ||
			!shouldTransform(response)
		) {
			return response;
		}

		// The representation varies on Accept-Encoding, including identity
		// responses where no supported encoding was requested.
		const currentVary = response.headers.get("Vary");
		if (
			currentVary !== "*" &&
			!(currentVary && varyAcceptEncodingRegExp.test(currentVary))
		) {
			response.headers.set(
				"Vary",
				currentVary
					? `${currentVary}, Accept-Encoding`
					: "Accept-Encoding",
			);
		}

		const encoding = selectEncoding(
			context.request.headers.get("Accept-Encoding") ?? undefined,
			candidates,
		);
		if (!encoding || !response.body) {
			return response;
		}

		const stream = new CompressionStream(encoding);
		response.headers.delete("Content-Length");
		response.headers.set("Content-Encoding", encoding);

		// Compressed content is not byte-identical to the original content.
		const etag = response.headers.get("ETag");
		if (etag && !etag.startsWith("W/")) {
			response.headers.set("ETag", `W/${etag}`);
		}

		return new Response(response.body.pipeThrough(stream), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	});
};

/** Default middleware instance using gzip/deflate and a 1 KiB threshold. */
export const compressMiddleware = compress();
