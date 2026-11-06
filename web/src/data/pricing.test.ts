import { describe, expect, it } from 'vitest';
import { parsePrice, savedPrice } from './pricing';

describe('savedPrice (3% tax)', () => {
  const cases: [number, number][] = [
    [3.29, 3.5], // 3.3887: 39¢ over $3.00 → up
    [2.0, 2.0], // 2.06: 6¢ over $2.00 → down
    [5.45, 6.0], // 5.6135: 11¢ over $5.50 → up
    [5.39, 5.5], // 5.5517: 5¢ over $5.50 → down
    [4.99, 5.5], // 5.1397: 14¢ over $5.00 → up
    [9.7, 10.0], // 9.991: 49¢ over $9.50 → up
    [9.71, 10.0], // 10.0013: right on $10.00 → down
    [0.24, 0.5], // 0.2472 → up to $0.50
    [0.05, 0.5] // would round down to $0.00; never free
  ];
  for (const [shelf, expected] of cases) {
    it(`${shelf} → ${expected}`, () => expect(savedPrice(shelf, 3)).toBe(expected));
  }

  it('treats exactly 10¢ over as "within" (rounds down)', () => {
    expect(savedPrice(3.1, 0)).toBe(3.0);
    expect(savedPrice(3.11, 0)).toBe(3.5);
  });

  it('returns 0 for an empty or invalid price', () => {
    expect(savedPrice(0, 3)).toBe(0);
    expect(savedPrice(NaN, 3)).toBe(0);
  });
});

describe('parsePrice', () => {
  it('accepts common ways of typing a price', () => {
    expect(parsePrice('3.29')).toBe(3.29);
    expect(parsePrice('$3.29')).toBe(3.29);
    expect(parsePrice(' 3,29 ')).toBe(3.29);
    expect(parsePrice('.99')).toBe(0.99);
    expect(parsePrice('')).toBeNaN();
    expect(parsePrice('abc')).toBeNaN();
  });
});
