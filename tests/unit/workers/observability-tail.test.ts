import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import tailWorker, {
  extractAlerts,
  dedupe,
  stringifyMessage,
  sendAlertEmail,
  renderText,
  escapeHtml,
  CRITICAL_MARKER,
  type Alert,
  type Env,
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

  it('does not throw when logs/exceptions are omitted entirely (real tail shape)', () => {
    // Cloudflare omits fields with no data — the code relies on `?? []`.
    expect(() => extractAlerts([{ outcome: 'ok' }])).not.toThrow();
    expect(extractAlerts([{ outcome: 'ok' }])).toEqual([]);
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

  it('handles an empty batch', () => {
    expect(dedupe([])).toEqual([]);
  });
});

describe('observability-tail escapeHtml', () => {
  it('neutralizes HTML-significant characters', () => {
    expect(escapeHtml('<script>&"</script>')).toBe(
      '&lt;script&gt;&amp;&quot;&lt;/script&gt;'
    );
  });
});

describe('observability-tail renderText overflow footer', () => {
  it('reports the suppressed-fault count when the batch exceeds the cap', () => {
    const shown: Alert[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'critical',
      title: `t${i}`,
    }));
    // overflow = total(7) - shown(5) = 2
    const text = renderText(shown, 2, 'production');
    expect(text).toContain('2 more');
  });

  it('omits the footer when nothing is suppressed', () => {
    const text = renderText([{ kind: 'critical', title: 't' }], 0, 'dev');
    expect(text).not.toContain('more distinct fault');
  });
});

describe('observability-tail sendAlertEmail (Resend delivery)', () => {
  const fullEnv: Env = {
    RESEND_API_KEY: 'rk_test',
    ALERT_EMAIL_TO: 'a@x.com, b@x.com',
    ALERT_EMAIL_FROM: 'alerts@beauteas.com',
    ENVIRONMENT: 'production',
  };
  const alert: Alert = { kind: 'critical', title: 'refund.processing_failed' };
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
  });

  it('posts to Resend with bearer auth and a split/trimmed recipient list', async () => {
    await sendAlertEmail([alert], fullEnv);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rk_test');
    const payload = JSON.parse(init.body as string);
    expect(payload.from).toBe('alerts@beauteas.com');
    expect(payload.to).toEqual(['a@x.com', 'b@x.com']);
    expect(payload.subject).toContain('refund.processing_failed');
  });

  it('does not call fetch and logs when config is missing', async () => {
    await sendAlertEmail([alert], { ...fullEnv, RESEND_API_KEY: '' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not throw on a non-2xx Resend response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(sendAlertEmail([alert], fullEnv)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not throw when fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(sendAlertEmail([alert], fullEnv)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('observability-tail tail() handler wiring', () => {
  const env: Env = {
    RESEND_API_KEY: 'rk',
    ALERT_EMAIL_TO: 'a@x.com',
    ALERT_EMAIL_FROM: 'alerts@beauteas.com',
    ENVIRONMENT: 'dev',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registers no work for clean traffic', async () => {
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    await tailWorker.tail([{ outcome: 'ok', logs: [{ message: ['fine'], level: 'log', timestamp: 1 }] }], env, ctx);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('registers the alert send when a critical trace is present', async () => {
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    await tailWorker.tail(
      [{ outcome: 'exception', exceptions: [{ name: 'Error', message: 'x', timestamp: 1 }] }],
      env,
      ctx
    );
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
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
