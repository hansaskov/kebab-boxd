import { feeds, type Feed } from "@src/db/queries/reviews";

export function parseFeed(params: URLSearchParams): Feed {
	return feeds.find((feed) => feed === params.get("feed")) ?? "following";
}
