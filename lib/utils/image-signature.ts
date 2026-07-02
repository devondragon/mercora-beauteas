/**
 * Image MIME/extension trust boundary (BMC-146).
 *
 * `file.type` and `file.name` are both supplied by the client and are
 * therefore both attacker-controlled. Storage code must never derive the
 * on-disk extension or Content-Type from `file.name` — an attacker can send
 * `file.type: "image/png"` with `file.name: "x.svg"` to get arbitrary bytes
 * stored as `.svg` with an `image/png` label.
 *
 * This module is the single source of truth for:
 *  - which extension to use for a validated MIME type (never the filename)
 *  - verifying the file's actual leading bytes (magic number) match the
 *    declared MIME type, so a relabeled payload (e.g. real SVG/HTML content
 *    declared as `image/png`) is rejected before it reaches R2.
 *
 * Pure/no Cloudflare bindings — safe to unit test outside the Workers runtime.
 */

/** Extension to store, keyed by validated MIME type. Never derive from `file.name`. */
export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg", // non-standard but occasionally sent by clients; treat as JPEG
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function matchesAt(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Returns true only if `bytes` starts with a known file signature for the
 * declared MIME type. Unrecognized/unsupported declared types always fail.
 */
export function matchesImageSignature(bytes: Uint8Array, declaredType: string): boolean {
  const normalized = declaredType === "image/jpg" ? "image/jpeg" : declaredType;

  switch (normalized) {
    case "image/png":
      // 89 50 4E 47 0D 0A 1A 0A
      return matchesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      // FF D8 FF
      return matchesAt(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/gif":
      // GIF87a or GIF89a
      return (
        matchesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        matchesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      );
    case "image/webp":
      // "RIFF" .... "WEBP"
      return matchesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matchesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
    default:
      return false;
  }
}
