/** Generate a unique ID using crypto.randomUUID (RFC 9562) */
export function generateId(): string {
  return crypto.randomUUID();
}
