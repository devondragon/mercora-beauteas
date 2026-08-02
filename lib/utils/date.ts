/** Convert a CMS timestamp to Date, accepting Unix seconds, Unix milliseconds, or ISO text. */
export function cmsTimestampToDate(value: string | number | Date | null | undefined): Date {
  if (value instanceof Date) return new Date(value.getTime());

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Current Unix-second values are ~1.8e9; milliseconds are ~1.8e12.
    return new Date(Math.abs(value) < 100_000_000_000 ? value * 1000 : value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return cmsTimestampToDate(Number(trimmed));
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

/** Formats an ISO date string as a long human-readable date. */
export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
