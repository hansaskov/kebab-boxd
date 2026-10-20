/**
 * Names a session after the device it runs on. The session in use is "This device";
 * the others are numbered in the order they signed in, so using a device does not renumber it.
 */
export function deviceName(
  sessions: { id: string; createdAt: Date }[],
  sessionId: string,
  currentSessionId: string,
): string {
  if (sessionId === currentSessionId) return "This device";

  const signedIn = sessions.find((s) => s.id === sessionId)?.createdAt.getTime() ?? 0;
  // Sign-in times are stored in seconds, so the id settles ties.
  const earlier = sessions.filter((s) => {
    const time = s.createdAt.getTime();
    return time < signedIn || (time === signedIn && s.id < sessionId);
  }).length;

  return `Device ${earlier + 1}`;
}
