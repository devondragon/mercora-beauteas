import { describe, it, expect } from 'vitest';
import { EXT_BY_MIME, matchesImageSignature } from '@/lib/utils/image-signature';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('EXT_BY_MIME', () => {
  it('maps each allowed MIME type to its correct extension', () => {
    expect(EXT_BY_MIME['image/png']).toBe('png');
    expect(EXT_BY_MIME['image/jpeg']).toBe('jpg');
    expect(EXT_BY_MIME['image/jpg']).toBe('jpg');
    expect(EXT_BY_MIME['image/webp']).toBe('webp');
    expect(EXT_BY_MIME['image/gif']).toBe('gif');
  });

  it('does not map unknown/unsupported MIME types', () => {
    expect(EXT_BY_MIME['image/svg+xml']).toBeUndefined();
    expect(EXT_BY_MIME['text/html']).toBeUndefined();
    expect(EXT_BY_MIME['application/octet-stream']).toBeUndefined();
  });

  it('derives the extension purely from the declared MIME type, never from a filename', () => {
    // EXT_BY_MIME has no filename parameter at all — a caller cannot pass an
    // attacker-controlled `file.name` into the lookup, so a payload declared
    // as image/png always resolves to "png" regardless of what it's named.
    const attackerFilename = 'totally-not-an-image.svg';
    const ext = EXT_BY_MIME['image/png'];
    expect(ext).toBe('png');
    expect(attackerFilename.endsWith(`.${ext}`)).toBe(false);
  });
});

describe('matchesImageSignature', () => {
  it('accepts a valid PNG signature', () => {
    expect(
      matchesImageSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00), 'image/png')
    ).toBe(true);
  });

  it('accepts a valid JPEG signature', () => {
    expect(matchesImageSignature(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00), 'image/jpeg')).toBe(true);
  });

  it('accepts a valid JPEG signature declared via the non-standard image/jpg alias', () => {
    expect(matchesImageSignature(bytes(0xff, 0xd8, 0xff), 'image/jpg')).toBe(true);
  });

  it('accepts a valid GIF87a signature', () => {
    expect(matchesImageSignature(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61), 'image/gif')).toBe(true);
  });

  it('accepts a valid GIF89a signature', () => {
    expect(matchesImageSignature(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), 'image/gif')).toBe(true);
  });

  it('accepts a valid WEBP (RIFF....WEBP) signature', () => {
    expect(
      matchesImageSignature(
        bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
        'image/webp'
      )
    ).toBe(true);
  });

  it('rejects a PNG-declared file whose actual bytes are SVG/text content', () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(matchesImageSignature(svgBytes, 'image/png')).toBe(false);
  });

  it('rejects an EICAR-style text payload declared as JPEG', () => {
    const eicarLike = new TextEncoder().encode(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    );
    expect(matchesImageSignature(eicarLike, 'image/jpeg')).toBe(false);
  });

  it('rejects mismatched signatures (declared PNG, actual JPEG bytes)', () => {
    expect(matchesImageSignature(bytes(0xff, 0xd8, 0xff), 'image/png')).toBe(false);
  });

  it('rejects mismatched signatures (declared WEBP, actual PNG bytes)', () => {
    expect(
      matchesImageSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/webp')
    ).toBe(false);
  });

  it('rejects an unrecognized/unsupported declared type outright', () => {
    expect(matchesImageSignature(bytes(0x89, 0x50, 0x4e, 0x47), 'image/svg+xml')).toBe(false);
  });

  it('rejects when the buffer is too short to contain the full signature', () => {
    expect(matchesImageSignature(bytes(0x89, 0x50), 'image/png')).toBe(false);
    expect(matchesImageSignature(bytes(), 'image/jpeg')).toBe(false);
  });
});
