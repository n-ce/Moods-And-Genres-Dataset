import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CategoriesDataset,
  PlaylistEntry,
  AlbumEntry,
  SongEntry,
  VideoEntry,
  ScrapeDatasetStats,
  MoodAppearance,
} from "./types";
import { cleanId, sortKeys } from "./utils";

export interface DatasetState {
  categories: CategoriesDataset;
  playlists: Record<string, PlaylistEntry>;
  albums: Record<string, AlbumEntry>;
  songs: Record<string, SongEntry>;
  videos: Record<string, VideoEntry>;
  counterparts: Record<string, string>;
  trackIndex: Record<string, string[]>;
}

export type BaselineData = Omit<DatasetState, "categories">;

/**
 * Loads baseline data from dataDir if files exist.
 * Sanitizes legacy anomalies (converts categories to moods/genres, removes single videos/MPED, filters out empty albums).
 */
export function loadBaselineData(dataDir: string): BaselineData {
  const playlists: Record<string, PlaylistEntry> = {};
  const albums: Record<string, AlbumEntry> = {};
  const songs: Record<string, SongEntry> = {};
  const videos: Record<string, VideoEntry> = {};
  let counterparts: Record<string, string> = {};
  let trackIndex: Record<string, string[]> = {};

  try {
    const pPath = join(dataDir, "playlists.json");
    if (existsSync(pPath)) {
      const rawP: Record<string, any> = JSON.parse(
        readFileSync(pPath, "utf-8"),
      );
      for (const [rawId, entry] of Object.entries(rawP)) {
        const id = cleanId(rawId);

        // Exclude single videos (11-char IDs or MPED) and albums from playlists.json
        if (
          rawId.startsWith("MPED") ||
          id.length === 11 ||
          id.startsWith("OLAK") ||
          id.startsWith("MPREb")
        ) {
          continue;
        }

        const lowerSection = (
          entry.sectionTitle ||
          entry.categories?.[0]?.section ||
          ""
        ).toLowerCase();
        if (
          lowerSection.includes("community playlist") ||
          lowerSection.includes("music video")
        ) {
          continue;
        }

        // Migrate categories to moods [{ slug, section }] and genres [slug, ...]
        const moods: MoodAppearance[] = Array.isArray(entry.moods)
          ? [...entry.moods]
          : [];
        const genres: string[] = Array.isArray(entry.genres)
          ? [...entry.genres]
          : [];

        if (Array.isArray(entry.categories)) {
          for (const c of entry.categories) {
            if (c.type === "mood" && c.slug) {
              if (
                !moods.some((m) => m.slug === c.slug && m.section === c.section)
              ) {
                moods.push({ slug: c.slug, section: c.section || "" });
              }
            } else if (c.type === "genre" && c.slug) {
              if (!genres.includes(c.slug)) {
                genres.push(c.slug);
              }
            }
          }
        }

        if (entry.categoryType === "mood" && entry.categorySlug) {
          if (!moods.some((m) => m.slug === entry.categorySlug)) {
            moods.push({
              slug: entry.categorySlug,
              section: entry.sectionTitle || "",
            });
          }
        } else if (entry.categoryType === "genre" && entry.categorySlug) {
          if (!genres.includes(entry.categorySlug)) {
            genres.push(entry.categorySlug);
          }
        }

        playlists[id] = {
          title: entry.title || "Untitled Playlist",
          ...(moods.length > 0 ? { moods } : {}),
          ...(genres.length > 0 ? { genres } : {}),
          thumbnailId: entry.thumbnailId || "",
          trackIds: Array.isArray(entry.trackIds) ? entry.trackIds : [],
        };
      }
    }

    const aPath = join(dataDir, "albums.json");
    if (existsSync(aPath)) {
      const rawA = JSON.parse(readFileSync(aPath, "utf-8"));
      for (const [rawId, a] of Object.entries(rawA)) {
        const id = cleanId(rawId);
        const album = a as any;
        const trackIds = Array.isArray(album.trackIds) ? album.trackIds : [];

        // Skip empty album stubs without trackIds
        if (trackIds.length === 0) {
          continue;
        }

        albums[id] = {
          title: album.title || "Untitled Album",
          author: album.author || "",
          ...(album.authorId ? { authorId: album.authorId } : {}),
          thumbnailId: album.thumbnailId || "",
          ...(album.year ? { year: album.year } : {}),
          trackIds,
        };
      }
    }

    const sPath = join(dataDir, "songs.json");
    if (existsSync(sPath)) {
      const rawS = JSON.parse(readFileSync(sPath, "utf-8"));
      for (const [rawId, s] of Object.entries(rawS)) {
        const id = cleanId(rawId);
        const song = s as any;
        songs[id] = {
          id,
          title: song.title || "",
          author: (song.author || "").replace(/\s+-\s+Topic$/, "").trim(),
          authorId: song.authorId || "",
          ...(song.albumId ? { albumId: cleanId(song.albumId) } : {}),
          ...(song.duration && song.duration > 0
            ? { duration: song.duration, durationStr: song.durationStr || "" }
            : {}),
          ...(song.thumbnailId ? { thumbnailId: song.thumbnailId } : {}),
        };
      }
    }

    const vPath = join(dataDir, "videos.json");
    if (existsSync(vPath)) {
      const rawV = JSON.parse(readFileSync(vPath, "utf-8"));
      for (const [rawId, v] of Object.entries(rawV)) {
        const id = cleanId(rawId);
        const video = v as any;
        videos[id] = {
          id,
          title: video.title || "",
          author: (video.author || "").replace(/\s+-\s+Topic$/, "").trim(),
          authorId: video.authorId || "",
          ...(video.duration && video.duration > 0
            ? { duration: video.duration, durationStr: video.durationStr || "" }
            : {}),
        };
      }
    }

    const cPath = join(dataDir, "counterparts.json");
    if (existsSync(cPath)) {
      counterparts = JSON.parse(readFileSync(cPath, "utf-8"));
    }

    const tPath = join(dataDir, "trackIndex.json");
    if (existsSync(tPath)) {
      const rawT: Record<string, string[]> = JSON.parse(
        readFileSync(tPath, "utf-8"),
      );
      for (const [trackId, playlistIds] of Object.entries(rawT)) {
        const cleanTrackId = cleanId(trackId);
        const validPlaylistIds = (playlistIds || []).filter(
          (pid) => playlists[pid] !== undefined,
        );
        if (validPlaylistIds.length > 0) {
          trackIndex[cleanTrackId] = validPlaylistIds;
        }
      }
    }
  } catch (e: any) {
    console.warn("[Warn] Error loading baseline data:", e.message);
  }

  return { playlists, albums, songs, videos, counterparts, trackIndex };
}

/**
 * Saves all dataset files to dataDir with deterministic alphabetical key sorting.
 */
export function saveDataset(
  dataDir: string,
  data: DatasetState,
): ScrapeDatasetStats {
  mkdirSync(dataDir, { recursive: true });

  // Clean category featured lists (strip any legacy MPED prefixes)
  for (const chip of Object.values(data.categories.genres)) {
    if (chip.featuredSongs) {
      chip.featuredSongs = Array.from(
        new Set(chip.featuredSongs.map((id) => cleanId(id))),
      );
    }
    if (chip.featuredVideos) {
      chip.featuredVideos = Array.from(
        new Set(chip.featuredVideos.map((id) => cleanId(id))),
      );
    }
  }

  // Filter out any album stubs without tracks
  const cleanAlbums: Record<string, AlbumEntry> = {};
  for (const [id, a] of Object.entries(data.albums)) {
    if (a.trackIds && a.trackIds.length > 0) {
      cleanAlbums[id] = a;
    }
  }

  const sortedCategories = {
    moods: sortKeys(data.categories.moods),
    genres: sortKeys(data.categories.genres),
  };
  const sortedPlaylists = sortKeys(data.playlists);
  const sortedAlbums = sortKeys(cleanAlbums);
  const sortedSongs = sortKeys(data.songs);
  const sortedVideos = sortKeys(data.videos);
  const sortedCounterparts = sortKeys(data.counterparts);
  const sortedTrackIndex = sortKeys(data.trackIndex);

  writeFileSync(
    join(dataDir, "categories.json"),
    JSON.stringify(sortedCategories, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "playlists.json"),
    JSON.stringify(sortedPlaylists, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "albums.json"),
    JSON.stringify(sortedAlbums, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "songs.json"),
    JSON.stringify(sortedSongs, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "videos.json"),
    JSON.stringify(sortedVideos, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "counterparts.json"),
    JSON.stringify(sortedCounterparts, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "trackIndex.json"),
    JSON.stringify(sortedTrackIndex, null, 2) + "\n",
  );

  return {
    categoriesCount:
      Object.keys(sortedCategories.moods).length +
      Object.keys(sortedCategories.genres).length,
    playlistsCount: Object.keys(sortedPlaylists).length,
    albumsCount: Object.keys(sortedAlbums).length,
    songsCount: Object.keys(sortedSongs).length,
    videosCount: Object.keys(sortedVideos).length,
    counterpartsCount: Object.keys(sortedCounterparts).length,
    trackIndexCount: Object.keys(sortedTrackIndex).length,
  };
}
