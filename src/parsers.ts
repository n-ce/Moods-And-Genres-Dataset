import type { PlaylistItem, TrackItem } from "./types";
import { cleanId, extractThumbnailId, parseDuration } from "./utils";

/**
 * Extracts author and authorId from runs array.
 */
export function extractArtistRuns(runs: any[] | undefined): {
  author: string;
  authorId: string | null;
} {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { author: "", authorId: null };
  }

  const artistRuns = runs.filter(
    (x: any) =>
      x.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("UC") ||
      x.navigationEndpoint?.browseEndpoint
        ?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType ===
        "MUSIC_PAGE_TYPE_ARTIST",
  );

  let rawAuthor = "";
  if (artistRuns.length > 0) {
    rawAuthor = artistRuns.map((x: any) => x.text).join(", ");
  } else {
    const candidate = runs.find(
      (r: any) =>
        r?.text &&
        r.text.trim() !== "•" &&
        r.text.trim().toLowerCase() !== "song" &&
        r.text.trim().toLowerCase() !== "video" &&
        !/\bviews\b/i.test(r.text),
    );
    rawAuthor = candidate?.text?.trim() || runs[0]?.text?.trim() || "";
  }

  const author = rawAuthor.replace(/\s+-\s+Topic$/, "").trim();
  const authorId =
    artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId || null;

  return { author, authorId };
}

/**
 * Extracts a playlist, album, or shelf item from InnerTube item renderers.
 */
export function extractPlaylistItem(item: any): PlaylistItem | null {
  if (item.musicTwoRowItemRenderer) {
    const r = item.musicTwoRowItemRenderer;
    const name = r.title?.runs?.[0]?.text?.trim();
    const browseId =
      r.navigationEndpoint?.browseEndpoint?.browseId ||
      r.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    const playlistId =
      r.navigationEndpoint?.watchPlaylistEndpoint?.playlistId ||
      r.menu?.menuRenderer?.items?.find(
        (i: any) =>
          i?.menuNavigationItemRenderer?.navigationEndpoint
            ?.watchPlaylistEndpoint,
      )?.menuNavigationItemRenderer?.navigationEndpoint?.watchPlaylistEndpoint
        ?.playlistId;
    const videoId =
      r.navigationEndpoint?.watchEndpoint?.videoId ||
      r.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
        ?.videoId;

    const rawId = playlistId || browseId || videoId;
    const id = cleanId(rawId);

    const thumbnails =
      r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbUrl =
      thumbnails?.[thumbnails.length - 1]?.url || thumbnails?.[0]?.url;
    const thumbnailId =
      extractThumbnailId(thumbUrl) || (videoId ? videoId : "");

    const { author, authorId } = extractArtistRuns(r.subtitle?.runs);

    if (name && id) {
      return { id, name, thumbnailId, ...(author ? { author, authorId } : {}) };
    }
  }

  if (item.musicResponsiveListItemRenderer) {
    const r = item.musicResponsiveListItemRenderer;
    const firstCol =
      r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
        ?.runs?.[0];
    const name = firstCol?.text?.trim();
    const playlistId =
      firstCol?.navigationEndpoint?.watchPlaylistEndpoint?.playlistId;
    const browseId = firstCol?.navigationEndpoint?.browseEndpoint?.browseId;
    const videoId =
      firstCol?.navigationEndpoint?.watchEndpoint?.videoId ||
      r.overlay?.musicItemThumbnailOverlayRenderer?.content
        ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
        ?.videoId ||
      r.playlistItemData?.videoId;

    const rawId = playlistId || browseId || videoId;
    const id = cleanId(rawId);

    const thumbnails =
      r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const thumbUrl =
      thumbnails?.[thumbnails.length - 1]?.url || thumbnails?.[0]?.url;
    const thumbnailId =
      extractThumbnailId(thumbUrl) || (videoId ? videoId : "");

    const col1Runs =
      r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const { author, authorId } = extractArtistRuns(col1Runs);

    if (name && id) {
      return { id, name, thumbnailId, ...(author ? { author, authorId } : {}) };
    }
  }

  return null;
}

/**
 * Extracts normalized track metadata (ATV or OMV) from a music responsive list item renderer.
 */
export function extractTrackItem(renderer: any): TrackItem | null {
  const r = renderer?.musicResponsiveListItemRenderer;
  if (!r) return null;

  const rawVideoId =
    r.playlistItemData?.videoId ||
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
    r.navigationEndpoint?.watchEndpoint?.videoId;

  const videoId = cleanId(rawVideoId);
  if (!videoId) return null;

  const title =
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim() ||
    "";

  // Artists (column 1)
  const col1Runs: any[] =
    r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
    [];
  const { author, authorId } = extractArtistRuns(col1Runs);

  // Duration
  const durationStr =
    r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text?.trim() ||
    "";
  const duration = parseDuration(durationStr);

  // Thumbnail
  const thumbs =
    r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const thumbUrl = thumbs?.[thumbs.length - 1]?.url || thumbs?.[0]?.url;
  const rawThumbnailId = extractThumbnailId(thumbUrl) || videoId;

  // Is Song boolean (MUSIC_VIDEO_TYPE_ATV -> Song)
  const watchCfg =
    r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs?.[0]?.navigationEndpoint?.watchEndpoint
      ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig ||
    r.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
      ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig ||
    r.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig;
  const musicVideoType = watchCfg?.musicVideoType;
  const isSong = musicVideoType === "MUSIC_VIDEO_TYPE_ATV";

  // Album Extraction (Column 2 browseId or Menu)
  let albumId: string | undefined;
  const col2Runs: any[] =
    r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ||
    [];
  for (const run of col2Runs) {
    const browseId = run.navigationEndpoint?.browseEndpoint?.browseId;
    if (
      browseId &&
      (browseId.startsWith("MPREb") || browseId.startsWith("OLAK"))
    ) {
      albumId = browseId;
      break;
    }
  }

  // Menu check for albumId if not found in column 2
  if (!albumId) {
    const menuItems = r.menu?.menuRenderer?.items || [];
    for (const m of menuItems) {
      const nav = m.menuNavigationItemRenderer;
      if (!nav) continue;
      const bId = nav.navigationEndpoint?.browseEndpoint?.browseId;
      if (bId && (bId.startsWith("MPREb") || bId.startsWith("OLAK"))) {
        albumId = bId;
        break;
      }
    }
  }

  const item: TrackItem = {
    id: videoId,
    title,
    isSong,
    duration,
    durationStr,
    author,
    authorId,
    ...(albumId ? { albumId } : {}),
  };

  if (isSong) {
    item.thumbnailId = rawThumbnailId;
  }

  return item;
}
