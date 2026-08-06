/**
 * Route-level regression tests for Chai factual accuracy (BMC-215).
 *
 * The unit tests for `deterministic-answers` and `response-guard` prove those
 * modules behave. These prove the ROUTE actually uses them:
 *   - a contact question short-circuits before any billable AI work;
 *   - a hallucinated model reply is scrubbed on the way out;
 *   - the easter-egg and no-AI-binding fallback exits are scrubbed too (no exit
 *     path bypasses the guard);
 *   - the admin-gated content-generation mode is exempt.
 *
 * Same mocking shape as `agent-chat-hardening.test.ts` — the handler never
 * touches the Workers runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => authMock(),
}));

const enforceRateLimit = vi.fn();
const getClientIp = vi.fn((..._args: unknown[]) => '1.2.3.4');
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
  getClientIp: (...args: unknown[]) => getClientIp(...args),
}));

const requireAuth = vi.fn();
vi.mock('@/lib/auth/unified-auth', () => ({
  requireAuth: (...args: unknown[]) => requireAuth(...args),
  PERMISSIONS: { ADMIN_FULL: ['admin:*'] },
}));

const getCloudflareContext = vi.fn();
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));
const getRefundPolicy = vi.fn();
vi.mock('@/lib/utils/settings', () => ({
  getRefundPolicy: (...args: unknown[]) => getRefundPolicy(...args),
}));
const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: (...args: unknown[]) => getSaleRules(...args),
}));
vi.mock('@/lib/ai/config', () => ({
  runAI: vi.fn(),
  getCurrentEmbeddingModel: vi.fn(() => '@cf/baai/bge-base-en-v1.5'),
  extractAIResponse: vi.fn(() => ''),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/agent-chat/route';
import { runAI, extractAIResponse } from '@/lib/ai/config';
import { CONTACT_EMAIL, ORDER_HISTORY_URL, SITE_URL } from '@/lib/ai/canonical-facts';

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/agent-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const answerOf = async (res: Response) => ((await res.json()) as { answer: string }).answer;

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: null, sessionClaims: null });
  enforceRateLimit.mockResolvedValue(null);
  requireAuth.mockResolvedValue(null);
  getCloudflareContext.mockResolvedValue({ env: {} });
  // The route appends a personality quip on a 30% coin flip. Left unpinned, any
  // exact-output assertion here is flaky ~30% of the time — pin it above the
  // threshold so the flair never fires and the assertions stay deterministic.
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  getRefundPolicy.mockResolvedValue({ returnWindowDays: 30 });
  // Pre-sale posture so this route-level suite (predates the GOOB sale) keeps
  // exercising the return-window path it was written for.
  getSaleRules.mockResolvedValue({
    minimumBoxes: 10,
    finalSale: false,
    subscriptionsEnabled: false,
    tiers: [],
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('/api/agent-chat deterministic answers (BMC-215)', () => {
  it('answers the question that hallucinated in production, without any AI work', async () => {
    const res = await post({
      question: 'What email address should I use to contact support about my order?',
    });

    expect(res.status).toBe(200);
    expect(await answerOf(res)).toContain(CONTACT_EMAIL);
    // Short-circuits ahead of retrieval AND generation — cheaper than the model
    // path it replaces.
    expect(getCloudflareContext).not.toHaveBeenCalled();
    expect(runAI).not.toHaveBeenCalled();
  });

  it('answers varied contact phrasings deterministically', async () => {
    for (const question of [
      'What is your customer support email address?',
      'How do I contact BeauTeas?',
      'how can i reach you',
      'I want to speak to a human',
    ]) {
      const answer = await answerOf(await post({ question }));
      expect(answer).toContain(CONTACT_EMAIL);
    }
    expect(runAI).not.toHaveBeenCalled();
  });

  it('routes order-status questions to the account page', async () => {
    const answer = await answerOf(await post({ question: 'Where is my order?' }));
    expect(answer).toContain(ORDER_HISTORY_URL);
    expect(runAI).not.toHaveBeenCalled();
  });

  it('records the deterministic answer in the returned history', async () => {
    const res = await post({ question: "What's your email?" });
    const json = (await res.json()) as { history: Array<{ role: string; content: string }> };
    const assistantTurn = json.history.at(-1)!;
    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.content).toContain(CONTACT_EMAIL);
  });

  it('answers the refund window from settings without any AI work (BMC-243)', async () => {
    const answer = await answerOf(await post({ question: 'What is your return policy?' }));

    expect(answer).toContain('30 days');
    expect(getRefundPolicy).toHaveBeenCalled();
    expect(runAI).not.toHaveBeenCalled();
  });

  it('does not read settings for an ordinary product question (BMC-243)', async () => {
    // Classification is sync and does no I/O — a miss must not touch D1.
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    vi.mocked(extractAIResponse).mockReturnValue('Try the Evening blend!');

    await post({ question: 'Which tea helps with breakouts?' });

    expect(getRefundPolicy).not.toHaveBeenCalled();
  });

  it('still sends ordinary product questions down the retrieval path', async () => {
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    vi.mocked(extractAIResponse).mockReturnValue('Try the Evening blend!');

    await post({ question: 'Which tea helps with breakouts?' });

    expect(runAI).toHaveBeenCalled();
  });
});

describe('/api/agent-chat response guard (BMC-215)', () => {
  it('scrubs an invented address out of a model-generated reply', async () => {
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    vi.mocked(extractAIResponse).mockReturnValue(
      'Ooh, for that just email support@beauteteas.com and they will sort you out!'
    );

    const answer = await answerOf(await post({ question: 'who handles a damaged tin?' }));

    expect(answer).not.toContain('beauteteas.com');
    expect(answer).toContain(CONTACT_EMAIL);
  });

  it('scrubs an invented off-site link out of a model-generated reply', async () => {
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    vi.mocked(extractAIResponse).mockReturnValue('Track it at https://tracking.notreal.io/abc 💕');

    const answer = await answerOf(await post({ question: 'any update on the tin I bought?' }));

    expect(answer).not.toContain('notreal.io');
    expect(answer).toContain(SITE_URL);
  });

  it('leaves a correct model reply untouched', async () => {
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    const clean = `Sure! Email ${CONTACT_EMAIL} and check ${SITE_URL}/faq 💕`;
    vi.mocked(extractAIResponse).mockReturnValue(clean);

    expect(await answerOf(await post({ question: 'help with a subscription' }))).toBe(clean);
  });

  it('scrubs the easter-egg exit path too', async () => {
    // No exit may bypass the guard. The easter egg returns canned copy, so the
    // assertion is that it routes through the same choke point at all.
    const answer = await answerOf(await post({ question: "what's your secret brewing ritual?" }));
    expect(answer).toContain('Brewing Ritual');
    const addresses = answer.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    for (const address of addresses) expect(address).toBe(CONTACT_EMAIL);
  });

  it('scrubs the no-AI-binding fallback exit path', async () => {
    // env has no AI binding → canned fallback copy, still guarded.
    const res = await post({ question: 'recommend a tea for dull skin' });
    expect(res.status).toBe(200);
    const answer = await answerOf(res);
    const addresses = answer.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    for (const address of addresses) expect(address).toBe(CONTACT_EMAIL);
  });

  it('exempts the admin-gated content-generation mode', async () => {
    // The CMS HTML writer legitimately authors off-site links; scrubbing it would
    // corrupt admin output. It is admin-authenticated, not customer-facing.
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    const html = '<p>See <a href="https://www.usda.gov/organic">USDA organic</a>.</p>';
    vi.mocked(extractAIResponse).mockReturnValue(html);

    const answer = await answerOf(
      await post({ question: 'Generate ONLY the inner HTML for an about section', userContext: 'content-generation' })
    );

    expect(answer).toBe(html);
    expect(answer).toContain('usda.gov');
  });

  it('does not run the deterministic classifier for content generation', async () => {
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    vi.mocked(extractAIResponse).mockReturnValue('<p>Contact copy</p>');

    await post({
      question: 'Generate ONLY the inner HTML for a page about how to contact BeauTeas',
      userContext: 'content-generation',
    });

    // Reached the model rather than being short-circuited by the classifier.
    expect(runAI).toHaveBeenCalled();
  });
});

describe('/api/agent-chat verified-facts prompt block (BMC-215)', () => {
  it('injects the canonical values into the system prompt', async () => {
    getCloudflareContext.mockResolvedValue({ env: { AI: {} } });
    vi.mocked(runAI).mockResolvedValue({});
    vi.mocked(extractAIResponse).mockReturnValue('ok');

    await post({ question: 'which blend is best before bed?' });

    const opts = vi.mocked(runAI).mock.calls[0][2] as { messages: Array<{ content: string }> };
    const systemPrompt = opts.messages[0].content;
    expect(systemPrompt).toContain('VERIFIED FACTS');
    expect(systemPrompt).toContain(CONTACT_EMAIL);
    expect(systemPrompt).toContain(ORDER_HISTORY_URL);
  });
});
