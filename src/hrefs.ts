function userPath(username: string) {
	return `/${encodeURIComponent(username)}`;
}

export function profileHref(username: string) {
	return `${userPath(username)}/profile`;
}

export function settingsHref(username: string) {
	return `${userPath(username)}/settings`;
}

export function sessionHistoryHref(username: string, sessionId: string) {
	return `${settingsHref(username)}/sessions/${encodeURIComponent(sessionId)}`;
}

export function personalDataExportHref(username: string) {
	return `/api/users/${encodeURIComponent(username)}/export`;
}

export function adminUserHref(username: string) {
	return `/admin/users/${encodeURIComponent(username)}`;
}
