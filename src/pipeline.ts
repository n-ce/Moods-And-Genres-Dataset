import { join } from "node:path";
import type {
  ScrapeDatasetOptions,
  ScrapeDatasetStats,
  CategoriesDataset,
  CategoryItem,
} from "./types";
import {
  fetchMoodsAndGenresHtml,
  extractInnertubeConfig,
  extractBrowseData,
  extractCategories,
  fetchCategoryData,
  fetchPlaylistTracksWithRetry,
} from "./innertube";
import { extractPlaylistItem, extractTrackItem } from "./parsers";
import { loadBaselineData, saveDataset, type DatasetState } from "./storage";
import { cleanId } from "./utils";

/**
 * Main scraping and dataset generation pipeline.
 *
 * Implements category discovery, logical shelf filtering (Songs, Music Videos,
 * Albums, Community Playlists, Curated Playlists), track harvesting,
 * normalization, and atomic persistence.
 */
export async function scrapeDataset(
  options: ScrapeDatasetOptions = {},
): Promise<ScrapeDatasetStats> {
  const startTime = performance.now();
  const baseDir = options.baseDir || process.cwd();
  const dataDir = options.dataDir || join(baseDir, "data");
  const concurrency = options.concurrency ?? 5;

  console.log("[1/4] Fetching moods and genres landing page...");
  const html = await fetchMoodsAndGenresHtml();
  const { apiKey, clientVersion } = extractInnertubeConfig(html);
  const browseData = extractBrowseData(html);
  const { moods: scrapedMoods, genres: scrapedGenres } =
    extractCategories(browseData);

  console.log(
    `Discovered ${scrapedMoods.length} moods and ${scrapedGenres.length} genres from YouTube Music.`,
  );

  const categories: CategoriesDataset = { moods: {}, genres: {} };
  for (const m of scrapedMoods) {
    categories.moods[m.slug] = { id: m.id, title: m.name };
  }
  for (const g of scrapedGenres) {
    categories.genres[g.slug] = {
      id: g.id,
      title: g.name,
      featuredSongs: [],
      featuredVideos: [],
    };
  }

  // Load baseline if not --clean
  const baseline = options.clean
    ? {
        playlists: {},
        albums: {},
        songs: {},
        videos: {},
        counterparts: {},
        trackIndex: {},
      }
    : loadBaselineData(dataDir);

  const { playlists, albums, songs, videos, counterparts, trackIndex } =
    baseline;

  const queueToFetch = new Set<string>();

  console.log("[2/4] Fetching category pages & applying shelf filters...");

  const allCategories: Array<{
    type: "mood" | "genre";
    slug: string;
    item: CategoryItem;
  }> = [
    ...scrapedMoods.map((m) => ({
      type: "mood" as const,
      slug: m.slug,
      item: m,
    })),
    ...scrapedGenres.map((g) => ({
      type: "genre" as const,
      slug: g.slug,
      item: g,
    })),
  ];

  let catIdx = 0;
  for (const { type, slug, item } of allCategories) {
    catIdx++;
    console.log(
      `  [${catIdx}/${allCategories.length}] Scraping ${type} "${item.name}" (${slug})...`,
    );

    let catData: any;
    try {
      catData = await fetchCategoryData(apiKey, clientVersion, item.id);
    } catch (err: any) {
      console.warn(
        `    [Warn] Failed to fetch category ${item.name}:`,
        err.message,
      );
      continue;
    }

    const sectionList =
      catData?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents;

    if (!Array.isArray(sectionList)) continue;

    for (const section of sectionList) {
      const shelf = section.musicCarouselShelfRenderer || section.gridRenderer;
      const sectionTitle =
        shelf?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]
          ?.text ||
        shelf?.header?.gridHeaderRenderer?.title?.runs?.[0]?.text ||
        "";

      if (!sectionTitle) continue;

      const shelfItems = shelf?.contents || shelf?.items || [];
      const lowerSection = sectionTitle.toLowerCase();

      const isSongsShelf =
        lowerSection === "songs" || lowerSection.includes("top songs");
      const isVideosShelf =
        lowerSection === "music videos" || lowerSection === "videos";
      const isAlbumsShelf =
        lowerSection === "albums" || lowerSection.includes("new releases");
      const isCommunityShelf = lowerSection.includes("community playlist");

      for (const rawItem of shelfItems) {
        // 1. Songs Shelf (Responsive items containing full metadata)
        if (isSongsShelf) {
          const track = extractTrackItem(rawItem);
          const playlistItem = !track ? extractPlaylistItem(rawItem) : null;
          const id = track?.id || playlistItem?.id;
          if (!id) continue;

          if (type === "genre") {
            const g = categories.genres[slug];
            if (g) {
              const fSongs = (g.featuredSongs ??= []);
              if (!fSongs.includes(id)) {
                fSongs.push(id);
              }
            }
          }

          if (track) {
            songs[id] = {
              id,
              title: track.title,
              author: track.author,
              authorId: track.authorId || "",
              ...(track.albumId ? { albumId: track.albumId } : {}),
              ...(track.duration > 0
                ? { duration: track.duration, durationStr: track.durationStr }
                : {}),
              ...(track.thumbnailId ? { thumbnailId: track.thumbnailId } : {}),
            };
          } else if (playlistItem && !songs[id]) {
            songs[id] = {
              id,
              title: playlistItem.name,
              author: playlistItem.author || "",
              authorId: playlistItem.authorId || "",
              ...(playlistItem.thumbnailId
                ? { thumbnailId: playlistItem.thumbnailId }
                : {}),
            };
          }
          continue;
        }

        // 2. Music Videos Shelf
        if (isVideosShelf) {
          const extracted = extractPlaylistItem(rawItem);
          if (!extracted?.id) continue;
          const id = extracted.id;

          if (type === "genre") {
            const g = categories.genres[slug];
            if (g) {
              const fVideos = (g.featuredVideos ??= []);
              if (!fVideos.includes(id)) {
                fVideos.push(id);
              }
            }
          }
          if (!videos[id]) {
            videos[id] = {
              id,
              title: extracted.name || "",
              author: extracted.author || "",
              authorId: extracted.authorId || "",
            };
          }
          continue;
        }

        const extracted = extractPlaylistItem(rawItem);
        if (!extracted?.id) continue;
        const id = extracted.id;

        // If an item in another shelf is an individual video/song (11 chars), route to songs or videos
        if (
          id.length === 11 &&
          !id.startsWith("PL") &&
          !id.startsWith("RDCLAK")
        ) {
          if (!songs[id] && !videos[id]) {
            songs[id] = {
              id,
              title: extracted.name || "",
              author: extracted.author || "",
              authorId: extracted.authorId || "",
              ...(extracted.thumbnailId
                ? { thumbnailId: extracted.thumbnailId }
                : {}),
            };
          }
          continue;
        }

        // 3. Albums Shelf (OLAK... / MPREb...)
        if (isAlbumsShelf || id.startsWith("OLAK") || id.startsWith("MPREb")) {
          if (!albums[id]) {
            albums[id] = {
              title: extracted.name || "Untitled Album",
              author: extracted.author || "",
              authorId: extracted.authorId || undefined,
              thumbnailId: extracted.thumbnailId || "",
              trackIds: [],
            };
          }
          if (!albums[id].trackIds || albums[id].trackIds.length === 0) {
            queueToFetch.add(id);
          }
          continue;
        }

        // 4. Community Playlists Shelf
        if (isCommunityShelf) {
          queueToFetch.add(id);
          continue;
        }

        // 5. Curated Playlists Shelf (Default)
        // Only allow valid curated playlists (RDCLAK... or PL...)
        if (id.length <= 11) {
          continue;
        }

        if (!playlists[id]) {
          playlists[id] = {
            title: extracted.name || "Untitled Playlist",
            ...(type === "mood"
              ? { moods: [{ slug, section: sectionTitle }] }
              : {}),
            ...(type === "genre" ? { genres: [slug] } : {}),
            thumbnailId: extracted.thumbnailId || "",
            trackIds: [],
          };
        } else {
          if (type === "mood") {
            const moods = (playlists[id].moods ??= []);
            if (
              !moods.some((m) => m.slug === slug && m.section === sectionTitle)
            ) {
              moods.push({ slug, section: sectionTitle });
            }
          } else if (type === "genre") {
            const genres = (playlists[id].genres ??= []);
            if (!genres.includes(slug)) {
              genres.push(slug);
            }
          }
        }

        if (!playlists[id].trackIds || playlists[id].trackIds.length === 0) {
          queueToFetch.add(id);
        }
      }
    }

    await Bun.sleep(120);
  }

  // Filter queue for items needing tracks
  const toFetch = Array.from(queueToFetch).filter((id) => {
    if (playlists[id] && playlists[id].trackIds.length > 0) return false;
    if (albums[id] && albums[id].trackIds.length > 0) return false;
    return true;
  });

  const finalFetchList =
    options.limitPlaylists && options.limitPlaylists > 0
      ? toFetch.slice(0, options.limitPlaylists)
      : toFetch;

  console.log(
    `[3/4] Fetching tracks for ${finalFetchList.length} playlists and albums (concurrency: ${concurrency})...`,
  );

  let fetchedCount = 0;
  for (let i = 0; i < finalFetchList.length; i += concurrency) {
    const chunk = finalFetchList.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (entityId) => {
        const { tracks: rawTracks, albumHeader } =
          await fetchPlaylistTracksWithRetry(apiKey, clientVersion, entityId);

        if (albumHeader && albums[entityId]) {
          if (
            albumHeader.title &&
            (!albums[entityId].title ||
              albums[entityId].title === "Untitled Album")
          ) {
            albums[entityId].title = albumHeader.title;
          }
          if (albumHeader.author && !albums[entityId].author) {
            albums[entityId].author = albumHeader.author;
          }
          if (albumHeader.authorId && !albums[entityId].authorId) {
            albums[entityId].authorId = albumHeader.authorId;
          }
          if (albumHeader.year && !albums[entityId].year) {
            albums[entityId].year = albumHeader.year;
          }
        }

        const trackIds: string[] = [];
        for (const t of rawTracks) {
          trackIds.push(t.id);

          if (t.isSong) {
            const existing = songs[t.id];
            songs[t.id] = {
              id: t.id,
              title: t.title || existing?.title || "",
              author: t.author || existing?.author || "",
              authorId: t.authorId || existing?.authorId || "",
              ...(t.albumId || existing?.albumId
                ? { albumId: t.albumId || existing?.albumId }
                : {}),
              ...(t.duration > 0 ||
              (existing?.duration && existing.duration > 0)
                ? {
                    duration: t.duration || existing?.duration,
                    durationStr: t.durationStr || existing?.durationStr,
                  }
                : {}),
              ...(t.thumbnailId || existing?.thumbnailId
                ? { thumbnailId: t.thumbnailId || existing?.thumbnailId }
                : {}),
            };
          } else {
            const existing = videos[t.id];
            videos[t.id] = {
              id: t.id,
              title: t.title || existing?.title || "",
              author: t.author || existing?.author || "",
              authorId: t.authorId || existing?.authorId || "",
              ...(t.duration > 0 ||
              (existing?.duration && existing.duration > 0)
                ? {
                    duration: t.duration || existing?.duration,
                    durationStr: t.durationStr || existing?.durationStr,
                  }
                : {}),
            };
          }
        }

        if (playlists[entityId]) {
          playlists[entityId].trackIds = trackIds;
          for (const tid of trackIds) {
            if (!trackIndex[tid]) trackIndex[tid] = [];
            if (!trackIndex[tid].includes(entityId)) {
              trackIndex[tid].push(entityId);
            }
          }
        }

        if (albums[entityId]) {
          albums[entityId].trackIds = trackIds;
        }

        fetchedCount++;
      }),
    );

    if (fetchedCount % 50 === 0 || i + concurrency >= finalFetchList.length) {
      console.log(
        `  -> Progress: ${fetchedCount}/${finalFetchList.length} (${Math.round((fetchedCount / finalFetchList.length) * 100)}%)`,
      );
    }

    await Bun.sleep(100);
  }

  // 4. Save deterministic key-sorted JSON files in data/
  console.log(
    `[4/4] Writing deterministic, key-sorted JSON dataset to ${dataDir}...`,
  );

  const datasetState: DatasetState = {
    categories,
    playlists,
    albums,
    songs,
    videos,
    counterparts,
    trackIndex,
  };

  const stats = saveDataset(dataDir, datasetState);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Build] Completed successfully in ${elapsed}s:`);
  console.log(
    `  - categories:   ${stats.categoriesCount} (${Object.keys(categories.moods).length} moods, ${Object.keys(categories.genres).length} genres)`,
  );
  console.log(`  - playlists:    ${stats.playlistsCount} (Curated only)`);
  console.log(
    `  - albums:       ${stats.albumsCount} (OLAK albums with trackIds)`,
  );
  console.log(`  - songs:        ${stats.songsCount}`);
  console.log(`  - videos:       ${stats.videosCount}`);
  console.log(`  - counterparts: ${stats.counterpartsCount}`);
  console.log(`  - trackIndex:   ${stats.trackIndexCount}`);

  return stats;
}
