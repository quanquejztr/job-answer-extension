import { arePagesSupported, isBlockedHost, isSupportedUrl } from './blocked';

describe('isBlockedHost', () => {
  it.each([
    ['linkedin.com', true],
    ['www.linkedin.com', true],
    ['WWW.LinkedIn.COM', true],
    ['linkedin.com.', true],
    ['jobs.indeed.com', true],
    ['indeed.com', true],
    ['a.b.c.indeed.com', true],
    ['notlinkedin.com', false],
    ['linkedin.com.evil.example', false],
    ['myindeed.com', false],
    ['indeed.co', false],
    ['example.com', false],
    ['boards.greenhouse.io', false],
  ])('%s -> %s', (host, expected) => {
    expect(isBlockedHost(host)).toBe(expected);
  });
});

describe('isSupportedUrl', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/1', false],
    ['https://WWW.LINKEDIN.COM/jobs', false],
    ['https://linkedin.com./jobs', false],
    ['http://linkedin.com:8080/x', false],
    ['https://jobs.indeed.com:443/apply', false],
    ['https://user:pw@indeed.com/', false],
    ['https://notlinkedin.com/', true],
    ['https://linkedin.com.evil.example/', true],
    ['http://127.0.0.1:4310/basic-question.html', true],
    ['https://boards.greenhouse.io/acme/jobs/1', true],
    ['chrome://extensions', false],
    ['chrome-extension://abc/sidepanel.html', false],
    ['file:///tmp/x.html', false],
    ['about:blank', false],
    ['data:text/html,hi', false],
    ['javascript:alert(1)', false],
    ['blob:https://example.com/uuid', false],
    ['', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isSupportedUrl(url)).toBe(expected);
  });
});

describe('arePagesSupported', () => {
  it('requires every known URL to be supported', () => {
    expect(arePagesSupported(['https://example.com/', 'https://example.org/'])).toBe(true);
    expect(arePagesSupported(['https://example.com/', 'https://www.linkedin.com/x'])).toBe(false);
    expect(arePagesSupported(['https://www.indeed.com/', 'https://example.com/'])).toBe(false);
  });

  it('fails closed when no URL is known', () => {
    expect(arePagesSupported([undefined, undefined])).toBe(false);
    expect(arePagesSupported([])).toBe(false);
  });

  it('ignores an unknown frame URL when another URL is known', () => {
    expect(arePagesSupported(['https://example.com/', undefined])).toBe(true);
  });
});
