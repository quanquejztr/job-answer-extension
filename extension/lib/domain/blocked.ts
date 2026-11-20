// Supported-domain rule (PRD 15.2): LinkedIn and Indeed are never captured.
// A host is blocked when it equals a blocked domain or is a subdomain of one.
const BLOCKED_DOMAINS = ['linkedin.com', 'indeed.com'] as const;

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

/** True only for http(s) URLs whose host is not blocked. Anything else is unsupported. */
export function isSupportedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.hostname !== '' && !isBlockedHost(parsed.hostname);
}

/**
 * Fails closed: the page is supported only if at least one URL is known and
 * every known URL is supported. Pass the top-level tab URL and the clicked frame URL.
 */
export function arePagesSupported(urls: readonly (string | undefined)[]): boolean {
  const known = urls.filter((u): u is string => u !== undefined);
  return known.length > 0 && known.every(isSupportedUrl);
}
