/**
 * Converts a string (e.g. category name) into a deterministic slug for JSON keys and file systems.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[\/\\?%*:|"<>]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Deterministically sorts the keys of an object alphabetically.
 */
export function sortKeys<T extends Record<string, any>>(obj: T): T {
  const sorted: any = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  return sorted;
}

/**
 * Normalizes video/browse IDs by stripping prefixes like VL or MPED.
 */
export function cleanId(rawId: string | undefined): string {
  if (!rawId) return "";
  let id = rawId.trim();
  if (id.startsWith("VL")) id = id.substring(2);
  if (id.startsWith("MPED")) id = id.substring(4);
  return id;
}

/**
 * Extracts a thumbnail identifier from a Google CDN or YouTube image URL.
 */
export function extractThumbnailId(url: string | undefined): string {
  if (!url) return "";
  const googleMatch = url.match(
    /(?:googleusercontent\.com|ggpht\.com)\/([^=?/]+)/,
  );
  if (googleMatch?.[1]) return googleMatch[1];
  const ytMatch = url.match(/i\.ytimg\.com\/vi\/([^/?]+)/);
  if (ytMatch?.[1]) return ytMatch[1];
  return "";
}

/**
 * Parses duration strings like "3:45" or "1:05:20" into total seconds.
 */
export function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  const parts = durationStr
    .trim()
    .split(":")
    .map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  if (
    parts.length === 3 &&
    parts[0] !== undefined &&
    parts[1] !== undefined &&
    parts[2] !== undefined
  ) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1 && parts[0] !== undefined) {
    return parts[0];
  }
  return 0;
}
