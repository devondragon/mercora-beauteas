import { describe, it, expect } from 'vitest';
import {
  extractAlerts,
  dedupe,
  stringifyMessage,
  CRITICAL_MARKER,
} from '@/workers/observability-tail/src/index';

// The classification + dedupe logic the acceptance criterion depends on
// (BMC-168): a forced money-path failure must become an alert, and normal traffic
// must not. These are the pure helpers behind the Tail Worker's tail() handler.

describe('observability-tail extractAlerts', () => {
  it('turns an uncaught exception into an exception alert', () => {
    const alerts = extractAlerts([
      {
        scriptName: 'beauteas',
        outcome: 'exception',
        event: { request: { url: 'https://beauteas.com/api/orders', cf: { colo: 'SJC' } } },
        exceptions: [{ name: 'TypeError', message: 'boom', timestamp: 1 }],
        logs: [],
      },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'exception',
      title: 'TypeError: boom',
      script: 'beauteas',
      url: 'https://beauteas.com/api/orders',
      colo: 'SJC',
    });
  });

  it('turns a [critical] log line into a critical alert with the marker stripped', () => {
    const alerts = extractAlerts([
      {
        outcome: 'ok',
        logs: [
          { message: [`${CRITICAL_MARKER} refund.processing_failed`, '{"orderId":"o1"}'], level: 'error', timestamp: 1 },
        ],
        exceptions: [],
      },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('critical');
    expect(alerts[0].title).toContain('refund.processing_failed');
    expect(alerts[0].title).not.toContain(CRITICAL_MARKER);
  });

  it('does NOT alert on ordinary (non-critical) logs or clean outcomes', () => {
    const alerts = extractAlerts([
      {
        outcome: 'ok',
        logs: [
          { message: ['just a normal info line'], level: 'log', timestamp: 1 },
          { message: ['[rate-limit] binding not configured'], level: 'warn', timestamp: 2 },
        ],
        exceptions: [],
      },
    ]);
    expect(alerts).toHaveLength(0);
  });

  it('handles a cron (non-fetch) trace with no request and structured message parts', () => {
    const alerts = extractAlerts([
      {
        scriptName: 'beauteas-recommendations-cron',
        outcome: 'ok',
        logs: [{ message: [`${CRITICAL_MARKER} giftcard.fulfillment_errors`, { count: 2 }], level: 'error', timestamp: 1 }],
        exceptions: [],
      },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].url).toBeUndefined();
    expect(alerts[0].colo).toBeUndefined();
    expect(alerts[0].title).toContain('giftcard.fulfillment_errors');
  });

  it('collects across multiple events in one batch', () => {
    const alerts = extractAlerts([
      { outcome: 'exception', exceptions: [{ name: 'Error', message: 'a', timestamp: 1 }], logs: [] },
      { outcome: 'ok', logs: [{ message: [`${CRITICAL_MARKER} webhook.processing_failed`], level: 'error', timestamp: 2 }], exceptions: [] },
    ]);
    expect(alerts).toHaveLength(2);
  });
});

describe('observability-tail dedupe', () => {
  it('collapses identical alerts so one fault = one line', () => {
    const alerts = dedupe([
      { kind: 'critical', title: 'refund.processing_failed' },
      { kind: 'critical', title: 'refund.processing_failed' },
      { kind: 'critical', title: 'refund.settled_but_ledger_flip_failed' },
    ]);
    expect(alerts).toHaveLength(2);
  });

  it('keeps distinct kinds with the same title separate', () => {
    const alerts = dedupe([
      { kind: 'exception', title: 'x' },
      { kind: 'critical', title: 'x' },
    ]);
    expect(alerts).toHaveLength(2);
  });
});

describe('observability-tail stringifyMessage', () => {
  it('joins string parts as-is and JSON-encodes object parts', () => {
    expect(stringifyMessage(['a', 'b'])).toBe('a b');
    expect(stringifyMessage(['x', { n: 1 }])).toBe('x {"n":1}');
  });

  it('does not throw on a circular object part', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stringifyMessage(['x', circular])).not.toThrow();
  });
});
