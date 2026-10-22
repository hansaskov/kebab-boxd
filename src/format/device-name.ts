export function deviceName(session: { id: string; signInOrder: number }, currentSessionId: string): string {
  if (session.id === currentSessionId) return "This device";

  return `Device ${session.signInOrder}`;
}
