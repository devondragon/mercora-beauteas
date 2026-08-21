/**
 * The scarcity readout. Renders NOTHING for an unknown count, because
 * `boxesLeft` returns null for untracked and backorder-allowed variants where a
 * number would be a lie rather than an omission.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BoxesLeft from '@/components/sale/BoxesLeft';

describe('BoxesLeft', () => {
  it('states the count', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={250} />)).toContain('250 boxes left');
  });

  it('uses the singular for one', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={1} />)).toContain('1 box left');
  });

  it('groups thousands so a four-digit count stays readable', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={1232} />)).toContain('1,232 boxes left');
  });

  it('says sold out at zero, never "Backordered"', () => {
    const html = renderToStaticMarkup(<BoxesLeft boxes={0} />);
    expect(html).toContain('Sold out');
    expect(html).not.toContain('Backorder');
  });

  it('renders nothing when the count is unknown', () => {
    expect(renderToStaticMarkup(<BoxesLeft boxes={null} />)).toBe('');
  });
});
