import type { Client } from "@src/db/client";

const oldestFirst = { orderBy: { createdAt: "asc" } } as const;

const collectedRestaurant = {
	columns: { createdAt: true },
	with: { restaurant: { columns: { name: true } } },
	...oldestFirst,
} as const;

export function createPersonalData(client: Client) {
	return {
		async findByUser(userId: number) {
			return client.query.users.findFirst({
				columns: {
					fullname: true,
					username: true,
					email: true,
					emailVerified: true,
					role: true,
					bio: true,
					pronoun: true,
					latitude: true,
					longitude: true,
					isPrivate: true,
					followNotifications: true,
					likeNotifications: true,
					suggestionNotifications: true,
					bannedAt: true,
					createdAt: true,
					updatedAt: true,
				},
				with: {
					profilePicture: { columns: { url: true } },
					accounts: { columns: { providerId: true, accountId: true, createdAt: true }, ...oldestFirst },
					sessions: {
						columns: { createdAt: true, lastVerifiedAt: true, theme: true },
						with: {
							history: {
								columns: { requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
								orderBy: { requestedAt: "asc", id: "asc" },
							},
						},
						...oldestFirst,
					},
					reviews: {
						columns: { rating: true, description: true, likeCount: true, createdAt: true, updatedAt: true },
						with: {
							restaurant: { columns: { name: true } },
							pictures: { columns: { url: true } },
						},
						...oldestFirst,
					},
					likes: {
						columns: { createdAt: true },
						with: {
							review: {
								columns: {},
								with: {
									author: { columns: { username: true } },
									restaurant: { columns: { name: true } },
								},
							},
						},
						...oldestFirst,
					},
					following: { columns: { createdAt: true }, with: { following: { columns: { username: true } } }, ...oldestFirst },
					followers: { columns: { createdAt: true }, with: { follower: { columns: { username: true } } }, ...oldestFirst },
					sentFollowRequests: { columns: { createdAt: true }, with: { following: { columns: { username: true } } }, ...oldestFirst },
					receivedFollowRequests: { columns: { createdAt: true }, with: { follower: { columns: { username: true } } }, ...oldestFirst },
					favorites: collectedRestaurant,
					bucketList: collectedRestaurant,
					suggestions: { columns: { name: true, status: true, createdAt: true }, ...oldestFirst },
					queuedSuggestions: { columns: { link: true, status: true, name: true, createdAt: true }, ...oldestFirst },
					citySearches: { columns: { name: true, countryCode: true, status: true, createdAt: true }, ...oldestFirst },
					cityListUpdates: { columns: { status: true, cityCount: true, createdAt: true }, ...oldestFirst },
					notifications: {
						columns: { kind: true, readAt: true, createdAt: true },
						with: {
							actor: { columns: { username: true } },
							review: { columns: {}, with: { restaurant: { columns: { name: true } } } },
							restaurant: { columns: { name: true } },
							citySearch: { columns: { name: true } },
						},
						orderBy: { createdAt: "asc", id: "asc" },
					},
				},
				where: { id: userId },
			});
		},
	};
}
