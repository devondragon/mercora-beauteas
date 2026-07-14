// tests/unit/lib/utils/email-footer.test.ts
//
// BMC-184: the physical postal address (CAN-SPAM) is rendered by these shared
// helpers into every email footer. A future edit that drops the address or the
// interpolation should fail here rather than ship a non-compliant email.

import { describe, it, expect } from 'vitest';
import {
  MAILING_ADDRESS,
  mailingAddressLine,
  postalAddressHtml,
  unsubscribeHtml,
} from '@/lib/utils/email-footer';

describe('email-footer', () => {
  it('one-line address includes every required postal component', () => {
    const line = mailingAddressLine();
    for (const part of [
      MAILING_ADDRESS.business,
      MAILING_ADDRESS.line1,
      MAILING_ADDRESS.city,
      MAILING_ADDRESS.state,
      MAILING_ADDRESS.zip,
      MAILING_ADDRESS.country,
    ]) {
      expect(line).toContain(part);
    }
  });

  it('postalAddressHtml renders the address in a <p> with a theme color', () => {
    const light = postalAddressHtml('light');
    expect(light).toContain('<p');
    expect(light).toContain(mailingAddressLine());
    expect(light).toContain('#94a3b8');

    expect(postalAddressHtml('dark')).toContain('#6b7280');
  });

  it('unsubscribeHtml renders the given url as a clickable link', () => {
    const url = 'https://beauteas.com/api/email/unsubscribe?token=abc.def';
    const html = unsubscribeHtml(url, 'dark');
    expect(html).toContain(`href="${url}"`);
    expect(html.toLowerCase()).toContain('unsubscribe');
  });

  it('unsubscribeHtml escapes a hostile url so it cannot break out of the href', () => {
    const hostile = 'https://x.com/"><script>alert(1)</script>';
    const html = unsubscribeHtml(hostile, 'dark');
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});
