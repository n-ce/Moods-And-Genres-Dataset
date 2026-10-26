# Moods & Genres Dataset

A comprehensive, deterministic dataset and automated scraping pipeline for moods, genres, sections, curated playlists, albums, and tracks extracted directly from [YouTube Music Moods & Genres](https://music.youtube.com/moods_and_genres) to power catalog synchronization and the `/featured` recommendation API in **ytify**.

Built with [Bun](https://bun.sh) and TypeScript. Zero external dependencies.

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Consumer Integration: ytify `/featured` API](#consumer-integration-ytify-featured-api)
- [Dataset Specifications (`data/`)](#dataset-specifications-data)
  - [`categories.json`](#categoriesjson)
  - [`playlists.json`](#playlistsjson)
  - [`albums.json`](#albumsjson)
  - [`songs.json`](#songsjson)
  - [`videos.json`](#videosjson)
  - [`trackIndex.json`](#trackindexjson)
  - [`counterparts.json` (Planned Addition)](#counterpartsjson-planned-addition)
- [Automated Scheduled Updates (GitHub Actions)](#automated-scheduled-updates-github-actions)
- [Repository Structure](#repository-structure)
- [Running the Scraper](#running-the-scraper)
- [License](#license)

---

## Overview & Architecture

YouTube Music categorizes music into distinct **Moods & Moments** (e.g. Chill, Energize, Focus, Workout) and **Genres** (e.g. Rock, Hip-Hop, Classical, Pop). Each category contains multiple curated sections (e.g. _"Coffee shop blends"_, _"Muted jazz"_), which house featured playlists, albums, and singles.

This repository provides:

1. **Automated Scraping**: Reverse-engineers YouTube Music's InnerTube Web Remix API to scrape and normalize all moods, genres, playlists, and tracks without external libraries or authentication.
2. **Deterministic Sorting**: Every JSON file in `data/` is strictly sorted alphabetically by key and formatted with 2 spaces for minimal git diffs and reproducible builds.
3. **Pure Entity Separation**: Accurately distinguishes between official Audio Track Videos (ATVs / `songs.json`), Music Videos (OMVs / `videos.json`), Curated Playlists (`playlists.json`), and Albums (`albums.json`).
4. **Clean ID Normalization**: Strips YouTube Music internal prefixes (`MPED`, `VL`) ensuring consistent 11-character video IDs and canonical browse IDs.
5. **Zero-Dependency Bun Pipeline**: Natively runs TypeScript using Bun with no `node_modules` or `package.json`.

---

## Consumer Integration: ytify `/featured` API

The dataset powers the **`/featured`** endpoint in ytify (`/featured?ids=...&limit=...`):

- **Input**: User listening history (array of track IDs).
- **Matching & Scoring**:
  - Uses `data/trackIndex.json` for instant $O(1)$ inverted index lookup mapping each input `trackId` to the curated official playlists that contain it.
  - Computes track overlap and artist affinity scores.
- **Output**: Ranked, curated YouTube Music playlists (`RDCLAK...`) complete with localized titles, mood contexts, and cover art.

---

## Dataset Specifications (`data/`)

### `categories.json`

Taxonomy chips for all moods and genres extracted from the landing page:

```json
{
  "genres": {
    "dance_and_electronic": {
      "id": "ggMPOg11c2ljX2djX2RhbmNlX2FuZF9lbGVjdHJvbmlj",
      "title": "Dance & Electronic",
      "featuredSongs": ["9SwSO46wx-A", "Vy7IWiY3kNY"],
      "featuredVideos": ["-0VjdIZhVK0", "-j7UONRegz4"]
    }
  },
  "moods": {
    "chill": {
      "id": "ggMPOg11c2ljX2djX2NoaWxs",
      "title": "Chill"
    }
  }
}
```

### `playlists.json`

Official Curated Playlists ONLY (no user community playlists, no albums, and no single video items):

```json
{
  "RDCLAK5uy_k-1GcJ3HBnA0AnqKZNXCqP573RMFL9AFU": {
    "title": "Dance club beats",
    "moods": [
      {
        "slug": "energize",
        "section": "Dance club beats"
      }
    ],
    "genres": ["dance_and_electronic"],
    "thumbnailId": "wKhRnZZ0cJI",
    "trackIds": ["N8NcQzMQN_U", "TFsZy9t-qDc"]
  }
}
```

### `albums.json`

Curated albums discovered from category Albums / New Releases shelves with verified tracklists:

```json
{
  "OLAK5uy_nBE4bLuBHUXWZrF59ZrkPEToKt8M_I3Vc": {
    "title": "Album Title",
    "author": "Artist Name",
    "authorId": "UC...",
    "thumbnailId": "...",
    "year": "2024",
    "trackIds": ["..."]
  }
}
```

### `songs.json`

Canonical Audio Track Videos (ATVs / `MUSIC_VIDEO_TYPE_ATV`):

```json
{
  "-0oagW-YqMk": {
    "id": "-0oagW-YqMk",
    "title": "Kurai Onrum Illai - Ragamalika",
    "author": "M. S. Subbulakshmi, Radha Vishwanathan",
    "authorId": "UCfpe3O4lacV3Xe2krEARAdg",
    "albumId": "MPREb_HgIRjxZbCNR",
    "duration": 298,
    "durationStr": "4:58",
    "thumbnailId": "AKYBqGl-DiHOSFxeVRuWo4hXVyvxc5XrsoEiChTX91s_kT-fckFiBJ_rMhFxKldkVY7VHc_nvzvGilM"
  }
}
```

### `videos.json`

Canonical Official Music Videos (OMVs / `MUSIC_VIDEO_TYPE_OMV` / UGC):

```json
{
  "-j7UONRegz4": {
    "id": "-j7UONRegz4",
    "title": "Dhak Dhak Dhadke Dil",
    "author": "Vikram Thakor",
    "authorId": "UC...",
    "duration": 245,
    "durationStr": "4:05"
  }
}
```

### `trackIndex.json`

Inverted index for $O(1)$ playlist recommendation lookup:

```json
{
  "N8NcQzMQN_U": ["RDCLAK5uy_k-1GcJ3HBnA0AnqKZNXCqP573RMFL9AFU"]
}
```

### `counterparts.json` (Planned Addition)

- Bidirectional mapping between official songs (ATVs) and their music video counterparts (OMVs).
- **Planned Addition**: YouTube Music exposes official counterpart mappings via `songVideoSwitchRenderer` on the `/next` endpoint. To avoid rate limits during bulk scraping, counterparts are planned to be resolved on-demand during active playback in ytify or built incrementally over time. Currently maintained as `{}`.

---

## Automated Scheduled Updates (GitHub Actions)

A GitHub Actions workflow [`.github/workflows/update-data.yml`](./.github/workflows/update-data.yml) automatically runs weekly:

1. Checks out the repository.
2. Installs Bun via `oven-sh/setup-bun@v2`.
3. Runs `bun run src/scraper.ts`.
4. Commits and pushes any updated catalog data back to `main`.

---

## Repository Structure

```
Moods-And-Genres-Dataset/
├── .github/
│   └── workflows/
│       └── update-data.yml    # Weekly automated scraper CI workflow
├── data/
│   ├── categories.json        # Mood and genre category taxonomy
│   ├── playlists.json         # Curated official playlists
│   ├── albums.json            # Albums with complete tracklists
│   ├── songs.json             # Normalized song tracks (ATVs)
│   ├── videos.json            # Normalized music videos (OMVs)
│   ├── trackIndex.json        # Inverted index (trackId -> playlistIds)
│   └── counterparts.json      # Planned counterpart mapping
├── src/
│   ├── innertube.ts           # InnerTube API client & data fetchers
│   ├── parsers.ts             # Renderer parsing & metadata extraction
│   ├── pipeline.ts            # Main scraping orchestration pipeline
│   ├── scraper.ts             # CLI entrypoint
│   ├── storage.ts             # File I/O & deterministic serialization
│   ├── types.ts               # Core TypeScript interface definitions
│   └── utils.ts               # Helpers (slugify, cleanId, sorting, durations)
├── AGENTS.md                  # Specification & agent invariants
├── LICENSE                    # MIT License
└── README.md                  # Project documentation
```

---

## Running the Scraper

Run the scraper directly with Bun:

```bash
# Scrape the entire catalog
bun run src/scraper.ts

# Test with a playlist fetch limit
bun run src/scraper.ts --limit=10

# Adjust concurrency (default: 5)
bun run src/scraper.ts --concurrency=3

# Clean scrape (disregards baseline data/)
bun run src/scraper.ts --clean
```

---

## License

[MIT](LICENSE)
