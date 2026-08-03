const LOCAL_E2E_AUTH_BYPASS_MARKER = 'local-playwright-only';

/**
 * Clerk may only be bypassed by the hermetic Playwright Worker on localhost.
 * Requiring both conditions keeps this fail-closed if the marker is ever
 * copied into a deployed environment by mistake.
 */
export function shouldBypassClerkForLocalE2E(
  marker: string | undefined,
  hostname: string
): boolean {
  return marker === LOCAL_E2E_AUTH_BYPASS_MARKER && hostname === 'localhost';
}
