import { describe, it, expect } from 'vitest';
import { formatCurrency, formatDate } from '../utils/formatCurrency';

describe('formatCurrency', () => {
  it('formats a negative debit with a proper minus sign prefix', () => {
    expect(formatCurrency(-4250)).toBe('−$42.50');
  });

  it('formats a positive credit with a plus sign prefix', () => {
    expect(formatCurrency(2000)).toBe('+$20.00');
  });

  it('formats zero with a plus sign prefix', () => {
    // 0 is not < 0, so the + branch is taken
    expect(formatCurrency(0)).toBe('+$0.00');
  });

  it('formats large amounts with comma separators', () => {
    expect(formatCurrency(-100000)).toBe('−$1,000.00');
  });

  it('uses proper minus sign (U+2212) not a hyphen-minus for negatives', () => {
    const result = formatCurrency(-100);
    // U+2212 (minus sign) vs U+002D (hyphen-minus)
    expect(result.startsWith('\u2212')).toBe(true);
  });

  it('always shows two decimal places', () => {
    expect(formatCurrency(100)).toBe('+$1.00');
    expect(formatCurrency(-100)).toBe('−$1.00');
  });
});

describe('formatDate', () => {
  it('formats an ISO date string to a readable en-US date', () => {
    // new Date(2024, 5, 15) = June 15, 2024 in local time (month is 0-indexed)
    expect(formatDate('2024-06-15')).toMatch(/Jun 15, 2024/);
  });

  it('formats January correctly', () => {
    expect(formatDate('2024-01-01')).toMatch(/Jan 1, 2024/);
  });

  it('formats December correctly', () => {
    expect(formatDate('2023-12-31')).toMatch(/Dec 31, 2023/);
  });
});
