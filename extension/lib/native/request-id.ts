// A UUID v4 with hyphens satisfies the requestId rule (1-64 of [A-Za-z0-9_-]).
export function newRequestId(): string {
  return crypto.randomUUID();
}
