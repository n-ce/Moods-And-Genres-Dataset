export interface CategoryChip {
  id: string; // InnerTube browse params token
  title: string;
  featuredSongs?: string[];
  featuredVideos?: string[];
}

export interface CategoriesDataset {
  moods: Record<string, CategoryChip>;
  genres: Record<string, CategoryChip>;
}

export interface MoodAppearance {
  slug: string;
  section: string;
}

export interface PlaylistEntry {
  title: string;
  moods?: MoodAppearance[];
  genres?: string[];
  thumbnailId: string;
  trackIds: string[];
}

export interface AlbumEntry {
  title: string;
  author: string;
  authorId?: string;
  thumbnailId: string;
  year?: string;
  trackIds: string[];
}

export interface SongEntry {
  id: string;
  title: string;
  author: string;
  authorId: string;
  albumId?: string;
  duration?: number;
  durationStr?: string;
  thumbnailId?: string;
}

export interface VideoEntry {
  id: string;
  title: string;
  author: string;
  authorId: string;
  duration?: number;
  durationStr?: string;
}

export interface TrackItem {
  id: string;
  title: string;
  isSong: boolean;
  duration: number;
  durationStr: string;
  thumbnailId?: string;
  author: string;
  authorId: string | null;
  albumId?: string;
}

export interface PlaylistItem {
  id: string;
  name: string;
  thumbnailId: string;
  author?: string;
  authorId?: string | null;
  contents?: string[];
}

export interface CategoryItem {
  name: string;
  slug: string;
  id: string;
}

export interface ScrapeDatasetOptions {
  baseDir?: string;
  dataDir?: string;
  limitPlaylists?: number;
  concurrency?: number;
  clean?: boolean;
}

export interface ScrapeDatasetStats {
  categoriesCount: number;
  playlistsCount: number;
  albumsCount: number;
  songsCount: number;
  videosCount: number;
  counterpartsCount: number;
  trackIndexCount: number;
}
