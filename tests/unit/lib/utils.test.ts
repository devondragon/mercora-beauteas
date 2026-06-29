import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cn, formatPrice, debounce } from '@/lib/utils';

describe('cn', () => {
  it('merges two class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', false as unknown as string, undefined)).toBe('foo');
  });

  it('handles conditional object syntax', () => {
    expect(cn('foo', { bar: true, baz: false })).toBe('foo bar');
  });

  it('resolves Tailwind class conflicts (later wins)', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('handles array input', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar');
  });
});

describe('formatPrice', () => {
  it('formats zero cents as $0.00', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('formats 100 cents as $1.00', () => {
    expect(formatPrice(100)).toBe('$1.00');
  });

  it('formats 1999 cents as $19.99', () => {
    expect(formatPrice(1999)).toBe('$19.99');
  });

  it('formats large amounts correctly', () => {
    expect(formatPrice(100000)).toBe('$1,000.00');
  });

  it('handles odd cent amounts', () => {
    expect(formatPrice(5050)).toBe('$50.50');
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays function execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('resets timer on subsequent calls (only fires once)', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    vi.advanceTimersByTime(50);
    debounced('second');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('passes all arguments to the underlying function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a', 'b');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('a', 'b');
  });

  it('does not fire before the delay elapses', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });
});
