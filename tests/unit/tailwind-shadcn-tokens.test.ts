/**
 * The shadcn colour tokens used under components/ui/ must resolve in the
 * Tailwind config.
 *
 * Everything in components/ui/ is stock shadcn, written for Tailwind v4 against
 * shadcn's CSS-variable palette. This project is Tailwind v3 with the brand
 * palette, and Tailwind only emits utilities it can RESOLVE — an unknown colour
 * name produces no rule at all, silently. The markup ships `bg-primary`, no CSS
 * ever defines it, and the component renders unstyled in a way that reads as a
 * design choice rather than a bug: the Switch showed a floating thumb with no
 * track, so an admin could not tell whether a setting was on.
 *
 * This is the same failure the `content` glob comment in tailwind.config.ts
 * describes (a purged `line-through` left every sale price without a
 * strikethrough). Both are invisible until someone looks at the right pixel, so
 * they get pinned here instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import config from '../../tailwind.config';

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, any>;

/** Does `name` resolve to a colour a bare utility (bg-x / text-x) can use? */
function resolvesAsBareColor(name: string): boolean {
  const value = colors[name];
  if (typeof value === 'string') return true;
  if (value && typeof value === 'object') return 'DEFAULT' in value;
  return false;
}

/** Does `parent-child` resolve (e.g. muted-foreground, primary-500)? */
function resolvesAsScaleColor(parent: string, child: string): boolean {
  const value = colors[parent];
  if (!value || typeof value !== 'object') return false;
  return child in value;
}

describe('tailwind config — shadcn token coverage', () => {
  // Every bare token components/ui/ uses as `bg-X` / `text-X` / `border-X`.
  const bareTokens = [
    'primary',
    'secondary',
    'accent',
    'muted',
    'popover',
    'card',
    'destructive',
    'input',
    'background',
    'foreground',
    'border',
    'ring',
  ];

  it.each(bareTokens)('resolves `%s`', (token) => {
    expect(resolvesAsBareColor(token)).toBe(true);
  });

  const foregroundTokens: Array<[string, string]> = [
    ['accent', 'foreground'],
    ['muted', 'foreground'],
    ['popover', 'foreground'],
    ['card', 'foreground'],
    ['destructive', 'foreground'],
  ];

  it.each(foregroundTokens)('resolves `%s-%s`', (parent, child) => {
    expect(resolvesAsScaleColor(parent, child)).toBe(true);
  });

  it('resolves the flat -foreground aliases', () => {
    // These are declared as their own top-level keys rather than nested, because
    // `primary` is a numeric scale and a `foreground` key inside it would also
    // emit `bg-primary-foreground` from the scale — same class, less obvious.
    expect(resolvesAsBareColor('primary-foreground')).toBe(true);
    expect(resolvesAsBareColor('secondary-foreground')).toBe(true);
  });

  it('keeps the numeric scales working alongside DEFAULT', () => {
    // Adding DEFAULT must not cost us bg-primary-500, which the admin CSS and
    // the Button component both use.
    expect(resolvesAsScaleColor('primary', '500')).toBe(true);
    expect(resolvesAsScaleColor('primary', 'DEFAULT')).toBe(true);
    expect(resolvesAsScaleColor('secondary', '400')).toBe(true);
  });

  it('has no components/ui file referencing a colour token that is absent', () => {
    // A cheap sweep for tokens added by some future shadcn component. Only the
    // shadcn palette names are checked; brand names (surface, state, text-*) and
    // non-colour utilities are out of scope.
    const shadcnNames = [
      'primary', 'secondary', 'accent', 'muted', 'popover', 'card',
      'destructive', 'input', 'background', 'foreground', 'border', 'ring',
      'sidebar', 'chart',
    ];
    const dir = join(process.cwd(), 'components/ui');
    const missing = new Set<string>();

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(
        /\b(?:bg|text|border|ring|fill|stroke|divide|outline|from|to|via)-([a-z]+)(?:-([a-z0-9]+))?/g
      )) {
        const [, parent, child] = match;
        if (!shadcnNames.includes(parent)) continue;
        const ok = child
          ? resolvesAsScaleColor(parent, child) || resolvesAsBareColor(`${parent}-${child}`)
          : resolvesAsBareColor(parent);
        if (!ok) missing.add(child ? `${parent}-${child}` : parent);
      }
    }

    expect(Array.from(missing).sort()).toEqual([]);
  });
});
