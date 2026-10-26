import type { CategoryItem, TrackItem } from "./types";
import { slugify } from "./utils";
import { extractTrackItem } from "./parsers";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * Fetches the raw HTML of the YouTube Music Moods & Genres landing page.
 */
export async function fetchMoodsAndGenresHtml(): Promise<string> {
  const url = "https://music.youtube.com/moods_and_genres";
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  return await response.text();
}

/**
 * Extracts the InnerTube API key and clientVersion from page HTML.
 */
export function extractInnertubeConfig(html: string): {
  apiKey: string;
  clientVersion: string;
} {
  const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const versionMatch = html.match(/"clientVersion":"([^"]+)"/);

  return {
    apiKey: keyMatch?.[1] || "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
    clientVersion: versionMatch?.[1] || "1.20261020.10.00",
  };
}

/**
 * Extracts ytInitialData / browse initialData from page script tags.
 */
export function extractBrowseData(html: string): any {
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    if (!code) continue;
    if (code.includes("initialData.push") && code.includes("browse")) {
      try {
        const modified =
          code.replace(/const initialData = \[\];/, "initialData = [];") +
          "\nreturn initialData;";
        const fn = new Function("window", modified);
        const result = fn({});
        for (const item of result) {
          if (item.path?.includes("browse")) {
            return typeof item.data === "string"
              ? JSON.parse(item.data)
              : item.data;
          }
        }
      } catch {
        // Fall through
      }

      const hexMatch = code.match(
        /path:\s*['"]\\\/browse['"][\s\S]*?data:\s*['"]([\s\S]*?)['"]\s*\}\s*\)/,
      );
      if (hexMatch?.[1]) {
        const decoded = hexMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)),
        );
        return JSON.parse(decoded);
      }
    }
  }

  const ytInitialMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});/s);
  if (ytInitialMatch?.[1]) {
    return JSON.parse(ytInitialMatch[1]);
  }

  throw new Error(
    "Unable to locate browse initial data in YouTube Music page response",
  );
}

/**
 * Extracts mood and genre chips from browseData.
 */
export function extractCategories(browseData: any): {
  moods: CategoryItem[];
  genres: CategoryItem[];
} {
  const sections =
    browseData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
      ?.tabRenderer?.content?.sectionListRenderer?.contents;

  if (!Array.isArray(sections)) {
    throw new Error("No sections found in browse contents");
  }

  const moods: CategoryItem[] = [];
  const genres: CategoryItem[] = [];

  for (const section of sections) {
    const grid = section.gridRenderer;
    const title =
      grid?.header?.gridHeaderRenderer?.title?.runs?.[0]?.text || "";
    const items = grid?.items;
    if (!Array.isArray(items)) continue;

    const isMood = /mood/i.test(title);
    const isGenre = /genre/i.test(title);

    for (const item of items) {
      const button = item.musicNavigationButtonRenderer;
      const name = button?.buttonText?.runs?.[0]?.text;
      const paramsId = button?.clickCommand?.browseEndpoint?.params;

      if (name && paramsId) {
        const categoryItem: CategoryItem = {
          name: name.trim(),
          slug: slugify(name),
          id: paramsId,
        };

        if (isMood) {
          moods.push(categoryItem);
        } else if (isGenre) {
          genres.push(categoryItem);
        }
      }
    }
  }

  return { moods, genres };
}

/**
 * Fetches category page data using the InnerTube browse API.
 */
export async function fetchCategoryData(
  apiKey: string,
  clientVersion: string,
  params: string,
): Promise<any> {
  const browseUrl = `https://music.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`;

  const response = await fetch(browseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/moods_and_genres",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB_REMIX",
          clientVersion,
          hl: "en",
          gl: "US",
        },
      },
      browseId: "FEmusic_moods_and_genres_category",
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch category data: HTTP ${response.status} ${response.statusText}`,
    );
  }

  return await response.json();
}

/**
 * Fetches the track list for a playlist or album using InnerTube browse API.
 */
export async function fetchPlaylistTracks(
  apiKey: string,
  clientVersion: string,
  playlistId: string,
): Promise<{
  tracks: TrackItem[];
  albumHeader?: {
    title?: string;
    author?: string;
    authorId?: string;
    year?: string;
    thumbnailId?: string;
  };
}> {
  const browseId = playlistId.startsWith("MPREb")
    ? playlistId
    : playlistId.startsWith("VL")
      ? playlistId
      : `VL${playlistId}`;
  const browseUrl = `https://music.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`;

  const response = await fetch(browseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Origin: "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB_REMIX",
          clientVersion,
          hl: "en",
          gl: "US",
        },
      },
      browseId,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const json: any = await response.json();
  const shelf =
    json?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents
      ?.sectionListRenderer?.contents?.[0]?.musicPlaylistShelfRenderer ||
    json?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents
      ?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer ||
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]
      ?.musicPlaylistShelfRenderer ||
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]?.musicShelfRenderer;

  const rawContents = shelf?.contents || [];
  const tracks: TrackItem[] = [];

  for (const item of rawContents) {
    const track = extractTrackItem(item);
    if (track) {
      tracks.push(track);
    }
  }

  let albumHeader:
    | {
        title?: string;
        author?: string;
        authorId?: string;
        year?: string;
        thumbnailId?: string;
      }
    | undefined;

  const header =
    json?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]
      ?.musicResponsiveHeaderRenderer ||
    json?.header?.musicDetailHeaderRenderer ||
    json?.header?.musicResponsiveHeaderRenderer;

  if (header) {
    const title = header.title?.runs?.[0]?.text?.trim();
    const subtitleRuns: any[] = header.subtitle?.runs || [];
    const artistRuns = subtitleRuns.filter(
      (x: any) =>
        x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC") ||
        x.navigationEndpoint?.browseEndpoint
          ?.browseEndpointContextSupportedConfigs
          ?.browseEndpointContextMusicConfig?.pageType ===
          "MUSIC_PAGE_TYPE_ARTIST",
    );
    const author = artistRuns.map((x: any) => x.text).join(", ");
    const authorId =
      artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    const yearMatch = subtitleRuns.find((x: any) =>
      /^\d{4}$/.test(x.text?.trim()),
    );
    const year = yearMatch?.text?.trim();

    albumHeader = {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
      ...(authorId ? { authorId } : {}),
      ...(year ? { year } : {}),
    };
  }

  return { tracks, albumHeader };
}

/**
 * Fetches playlist tracks with exponential/stepped backoff retry.
 */
export async function fetchPlaylistTracksWithRetry(
  apiKey: string,
  clientVersion: string,
  playlistId: string,
  retries = 2,
): Promise<{
  tracks: TrackItem[];
  albumHeader?: {
    title?: string;
    author?: string;
    authorId?: string;
    year?: string;
    thumbnailId?: string;
  };
}> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchPlaylistTracks(apiKey, clientVersion, playlistId);
    } catch {
      if (attempt === retries) {
        return { tracks: [] };
      }
      await Bun.sleep(attempt * 800);
    }
  }
  return { tracks: [] };
}
