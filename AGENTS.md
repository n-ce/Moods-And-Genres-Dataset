# Moods & Genres Dataset — Agent Invariants & Specification

You are working on the **Moods & Genres Dataset** repository (`Moods-And-Genres-Dataset`), which scrapes, structures, and normalizes YouTube Music's entire Moods & Genres catalog to power catalog synchronization and the `/featured` recommendation API for **ytify**.

---

## 1. User Usage & Recommendation Objective

The recommendation API (`/featured`, `?ids=...&limit=...`) receives user listening history (track IDs and artist names) and scores playlists based on track overlap and artist affinity.

- **Primary Recommendation Target**: **Official YouTube Playlists** (`RDCLAK...`, official curated YTM playlists).
- **Community Playlists Policy**:
  - **Do NOT store Community Playlists in `data/playlists.json`**. Community playlists are volatile, user-generated, and degrade recommendation quality.
  - **DO harvest their track items**: Every song and video inside a community playlist is extracted and normalized into `data/songs.json`, `data/videos.json`, and `data/albums.json`. This expands catalog coverage without polluting curated recommendations.

---

## 2. Scraping Invariant: Never Fetch Individual Video IDs Directly

- **Strict Ban on Fetching Individual Video IDs (`/next`, `/player`, etc.)**:
  - Do NOT fetch individual `videoId` endpoints directly during bulk scraping. YouTube Music rate limits and blocks per-video API requests when fanning out.
  - The category pages, playlist tracks endpoints (`VL<playlistId>`), and album endpoints (`VL<albumId>` or `<albumId>`) already contain all necessary metadata (tracks, titles, artists, thumbnails, durations, album mappings, and music video types).
  - Extract all entity metadata directly from the structured renderers provided by category pages and playlist browse responses.
- **Counterparts Policy**:
  - Official counterparts between songs (`ATV`) and music videos (`OMV`) are provided by YouTube Music only via `songVideoSwitchRenderer` in `/next`.
  - Because bulk-querying `/next` across 200k+ tracks causes rate-limiting and IP bans, counterparts are a **planned addition** to be resolved on-demand at playback time in ytify or accumulated incrementally over time. Currently maintained as `{}` in `data/counterparts.json`.

---

## 3. Unified Category Scraping with Logical Shelf Filtering

Category scraping is unified into a single pipeline with deterministic logical filtering by shelf type:

### 1. `Songs` Shelf

- **Detection**: Shelf title matches `/^songs$/i` or `/top songs/i`.
- **Entities**: Individual 11-character track items (`ATV`).
- **Routing**:
  - Stored in `category.featuredSongs` in `data/categories.json`.
  - Normalized into `data/songs.json` with full metadata (title, author, authorId, duration, thumbnailId).
  - Never write dummy `duration: 0` or `durationStr: ""` values.

### 2. `Music Videos` Shelf

- **Detection**: Shelf title matches `/music videos/i` or `/videos/i`.
- **Entities**: Individual 11-character video items (`OMV`).
- **Extraction Rules**:
  - Video IDs must NOT have `MPED` or browse prefixes attached—strip `MPED` using `cleanId(id)`.
  - Extract title, author, authorId from subtitle runs.
- **Routing**:
  - Stored in `category.featuredVideos` in `data/categories.json`.
  - Normalized into `data/videos.json`.
  - **STRICTLY EXCLUDED from `data/playlists.json`** (Music videos must never be stored as playlists).

### 3. `Albums` / `New Releases` Shelf

- **Detection**: Shelf title matches `/albums/i` or `/new releases/i`, or item ID starts with `OLAK` / `MPREb`.
- **Entities**: Complete album releases (`OLAK5uy_...` / `MPREb...`).
- **Routing**:
  - Stored in `data/albums.json` with `title`, `author`, `authorId`, `thumbnailId`, and **`trackIds: string[]`**.
  - **No Empty Stubs**: Never create empty `{ title: "", trackIds: [] }` stubs for arbitrary track `albumId`s. Only albums with verified track lists belong in `data/albums.json`.
  - **STRICTLY EXCLUDED from `data/playlists.json`**.
  - Child tracks are harvested and normalized into `data/songs.json`.

### 4. `Community Playlists` Shelf

- **Detection**: Shelf title matches `/community playlists/i`.
- **Entities**: User-curated playlists (`PL...`).
- **Routing**:
  - **STRICTLY EXCLUDED from `data/playlists.json`**.
  - **Child tracks are scraped and harvested** into `data/songs.json`, `data/videos.json`, and `data/albums.json`.

### 5. Curated Playlist Shelves (Default)

- **Detection**: Any other shelf:
  - Genre: `"Featured playlists"`, `"Trending playlists"`, etc.
  - Mood: Descriptive shelves like `"Coffee shop blends"`, `"Unwind and explore"`, `"Dance club beats"`, `"Chill pop"`, etc.
- **Entities**: Official Curated Playlists (`RDCLAK...`, official `PL...`).
- **Routing**:
  - Stored in `data/playlists.json` with `title`, `moods: [{ slug, section }]`, `genres: string[]`, `thumbnailId`, and `trackIds`.
  - Redundant fields `categorySlug`, `categoryType`, `sectionTitle`, and `categories[]` are strictly omitted.
  - Child tracks normalized into `data/songs.json` / `data/videos.json` and indexed in `data/trackIndex.json`.

---

## 4. Dataset Directory Specification (`data/`)

All files in `data/` must be deterministic, formatted with 2 spaces, and sorted alphabetically by key:

```
Moods-And-Genres-Dataset/
└── data/
    ├── categories.json      # Taxonomy chips: moods { id, title } and genres { id, title, featuredSongs, featuredVideos }
    ├── playlists.json       # Official Curated Playlists ONLY: { title, moods, genres, thumbnailId, trackIds }
    ├── albums.json          # Albums Master: albumId -> { title, author, authorId, thumbnailId, year, trackIds }
    ├── songs.json           # Canonical ATVs: { id, title, author, authorId, albumId, duration, durationStr, thumbnailId }
    ├── videos.json          # Canonical OMVs: { id, title, author, authorId, duration, durationStr }
    ├── trackIndex.json      # Inverted index: trackId -> [officialPlaylistIds]
    └── counterparts.json    # Planned addition (currently {})
```

### Clean ID Guarantees

- No `MPED` or `VL` prefixes anywhere in `data/`.
- All `featuredSongs`, `featuredVideos`, `songs`, and `videos` IDs are clean 11-character strings.
- All playlists have genuine playlist IDs (`RDCLAK...` / `PL...`).

---

## 5. Cloudflare Ingestion & Offload Bridge (Planned)

- **Purpose**: Allow `UserSyncDO` in ytify to store only lightweight track references (`trackId`, `addedAt`, `playCount`), shifting all track metadata out of Cloudflare user storage into this repository.
- **Data Flow**:
  1. Users playing or adding unindexed tracks buffer raw metadata in Cloudflare (`POST /api/catalog/buffer`).
  2. Weekly GitHub Action triggers `GET /api/catalog/offload` with secret token `x-ytify-sync-token`.
  3. Action normalizes and merges the offloaded tracks into `data/songs.json` and `data/videos.json`.
  4. After successful git push, Action sends `POST /api/catalog/offload/ack` to flush Cloudflare's temporary buffer.
- See full architecture specification at [`docs/plan-cloudflare-gh-action-track-offload.md`](../docs/plan-cloudflare-gh-action-track-offload.md).
