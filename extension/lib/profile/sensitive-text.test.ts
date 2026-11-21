import { describeSensitiveCategories, detectSensitiveText } from './sensitive-text';

const detect = (text: string) => detectSensitiveText([text]);

describe('detectSensitiveText', () => {
  it.each([
    ['plain', 'Reach me at sam.example@example.com for details.'],
    ['plus tag', 'sam+jobs@example.org'],
    ['subdomain', 'sam@mail.team.example.co.uk'],
    ['unicode local part and domain', 'josé@exemple.fr'],
    ['cjk domain label', '李@例子.中国'],
    ['at the end of a sentence', 'Write to a_b-c@x-y.io.'],
  ])('flags an email: %s', (_n, text) => {
    expect(detect(text)).toContain('email');
  });

  it.each([
    ['international', '+44 20 7946 0958'],
    ['us parentheses', 'Call (555) 123-4567 today'],
    ['us dashes', '555-123-4567'],
    ['us dots', '555.123.4567'],
    ['country code with parentheses', '+1 (555) 123-4567'],
    ['plain digits', 'phone 5551234567'],
    ['seven digits', '555-1234'],
    ['spaces', '555 123 4567'],
    ['long last group', '+44 7911123456'],
    ['leading single digit country code', '1 555 123 4567'],
  ])('flags a phone number: %s', (_n, text) => {
    expect(detect(text)).toContain('phone');
  });

  it.each([
    ['avenue', 'I live at 123 Main Avenue'],
    ['abbreviated street', 'Office: 42 Maple St'],
    ['road with a period', '7 Cedar Rd.'],
    ['two-word street', '1600 Pine Valley Blvd'],
    ['ordinal street', '350 5th Ave'],
    ['drive, lane, court, way', '9 Oak Dr, 10 Elm Ln, 11 Ash Ct, 12 Birch Way'],
    ['house number letter', '221B Baker Street'],
    ['unicode street name', '8 Église Notre Street'],
  ])('flags a street address: %s', (_n, text) => {
    expect(detect(text)).toContain('address');
  });

  it.each([
    ['empty', ''],
    ['an ordinary sentence', 'Built a budgeting tool for a student club.'],
    ['a year', 'Joined the club in 2021.'],
    ['two years', 'Worked there 2019 2021 as a tutor.'],
    ['a year range', 'Served from 2019-2021.'],
    ['an ISO date', 'Shipped on 2024-01-15.'],
    ['a dotted date', 'Released 15.01.2024.'],
    ['a version number', 'Upgraded to v10.0.19045 and 2.4.1.'],
    ['a long version number', 'Version 10.0.19045.1234 of the tool'],
    ['an IPv4 address', 'Server 192.168.100.200 was reused.'],
    ['years of experience', 'I have 3 years of experience in support.'],
    ['short numbers', 'Handled 120 tickets a week for 15 people.'],
    ['a percentage', 'Cut costs by 20 percent along the way.'],
    ['currency', 'Raised $1234567 for the program.'],
    ['one-digit groups', 'Steps 1 2 3 4 5 6 7 8 were followed.'],
    ['a street word without a number', 'Walked down Main Street daily.'],
    ['lowercase suffix', 'Over 10 teams on the way'],
    ['an at sign without a domain', 'Meet @ noon, price 5 @ 3.'],
    ['unicode text', 'Équipe de 4 ingénieurs à Zürich; 東京で3年間働いた 😀'],
    ['fullwidth digits', '０１２３４５６７８９'],
  ])('does not flag: %s', (_n, text) => {
    expect(detect(text)).toEqual([]);
  });

  it('reports categories in a fixed order without duplicates, across several texts', () => {
    const r = detectSensitiveText([
      'Call 555-123-4567',
      '12 Main Street',
      'a@b.co and c@d.co',
      'again 555-123-4567',
    ]);
    expect(r).toEqual(['email', 'phone', 'address']);
  });

  it('returns only category names, never matched text', () => {
    const r = detect('sam.example@example.com 555-123-4567 12 Main Street');
    expect(JSON.stringify(r)).toBe('["email","phone","address"]');
  });

  it('is not slow on long inputs', () => {
    const t = Date.now();
    detect('1 '.repeat(20_000) + 'a'.repeat(50_000) + '9'.repeat(20_000));
    detect('A '.repeat(20_000) + '1 '.repeat(5000));
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('describeSensitiveCategories', () => {
  it('joins category names in plain words', () => {
    expect(describeSensitiveCategories(['email'])).toBe('an email address');
    expect(describeSensitiveCategories(['email', 'phone'])).toBe(
      'an email address and a phone number',
    );
    expect(describeSensitiveCategories(['email', 'phone', 'address'])).toBe(
      'an email address, a phone number and a street address',
    );
  });
});
