/**
 * Regression test: the admin settings page must NOT save when the stored
 * settings failed to load.
 *
 * The page seeds every field with a hardcoded default, then overwrites those
 * defaults with stored values once `/api/admin/settings` loads. If the load
 * fails, the form is still showing defaults, and a Save at that point POSTs the
 * defaults over every stored setting on the site (including shipping methods and
 * refund policy). The `settingsLoaded` guard is the safety net: until the load
 * succeeds, the Save button is disabled, an explanatory banner shows, and
 * `handleSave` refuses to POST even if called. This test pins that net —
 * `settings-parse.test.ts` covers the parser, but the parser is only half the
 * fix.
 *
 * No @testing-library/react in this repo, so this uses react-dom/client with
 * React 19's own `act` (same pattern as product-editor-variant-save.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import AdminSettingsPage from '@/app/admin/settings/page';

let container: HTMLDivElement;
let root: Root;

/**
 * Stub fetch, routing by URL. The settings GET result is caller-controlled; the
 * admin-users GET (also fired on mount) always succeeds so it is not the thing
 * under test.
 */
function stubFetch(settingsResponse: { ok: boolean; status?: number; settings?: unknown[] }) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/admin/settings')) {
      return Promise.resolve({
        ok: settingsResponse.ok,
        status: settingsResponse.status ?? (settingsResponse.ok ? 200 : 500),
        json: async () => ({ settings: settingsResponse.settings ?? [] }),
      } as Response);
    }
    if (url.startsWith('/api/admin/users')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ adminUsers: [] }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function postCallsTo(fetchMock: ReturnType<typeof vi.fn>, urlPrefix: string): unknown[] {
  return fetchMock.mock.calls.filter((call) => {
    const [input, init] = call as [RequestInfo | URL, RequestInit?];
    const url = typeof input === 'string' ? input : String(input);
    return url.startsWith(urlPrefix) && init?.method === 'POST';
  });
}

function findSaveButton(): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const save = buttons.find((b) => /save changes/i.test(b.textContent ?? ''));
  if (!save) throw new Error('save button not found in the rendered settings page');
  return save as HTMLButtonElement;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AdminSettingsPage — save guard when settings fail to load', () => {
  it('disables Save, shows the banner, and never POSTs after a failed load', async () => {
    const fetchMock = stubFetch({ ok: false, status: 500 });

    await act(async () => {
      root.render(<AdminSettingsPage />);
    });
    // Let the mount effects (loadSettings / loadAdminUsers) settle.
    await act(async () => {});

    expect(container.textContent).toContain('Settings could not be loaded');
    expect(findSaveButton().disabled).toBe(true);

    // Attempt a save anyway: a disabled button won't fire onClick, and the
    // handleSave guard refuses regardless. Either way, no POST must occur.
    await act(async () => {
      findSaveButton().click();
    });
    expect(postCallsTo(fetchMock, '/api/admin/settings')).toHaveLength(0);
  });

  it('enables Save and hides the banner once settings load successfully', async () => {
    const fetchMock = stubFetch({
      ok: true,
      settings: [
        { key: 'store.tax_rate', value: JSON.stringify(0.05), category: 'store' },
        // A legacy bare-string row must not break the load or block Save.
        { key: 'currency', value: 'USD', category: 'store' },
      ],
    });

    await act(async () => {
      root.render(<AdminSettingsPage />);
    });
    await act(async () => {});

    expect(container.textContent).not.toContain('Settings could not be loaded');
    expect(findSaveButton().disabled).toBe(false);

    // With settings loaded, a save is allowed to POST.
    await act(async () => {
      findSaveButton().click();
    });
    expect(postCallsTo(fetchMock, '/api/admin/settings').length).toBeGreaterThan(0);
  });
});
