/**
 * Names a session after the device it runs on. The session in use is "This device";
 * the others are numbered in the order they signed in, so using a device does not renumber it.
 */
export function deviceName(session: { id: string; signInOrder: number }, currentSessionId: string): string {
  if (session.id === currentSessionId) return "This device";

  return `Device ${session.signInOrder}`;
}
