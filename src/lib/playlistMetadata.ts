import { BackendApiError } from "./api/errors";
import { getVideoDetails } from "./api/youtube";
import { mapWithConcurrency } from "./concurrency";
import type { VideoSummary } from "../types/video";

// Paced like the Android app (50 per pass, one request at a time) to stay clear of rate limits.
const MAX_HYDRATE_PER_PASS = 50;

const hasDuration = (video: VideoSummary): boolean =>
  Boolean(video.isLive) || (video.durationSeconds != null && video.durationSeconds > 0);

const needsHydration = (video: VideoSummary): boolean =>
  !hasDuration(video) || !video.viewCountText || !video.publishedText;

export function selectHydrationTargets(
  videos: VideoSummary[],
  skipIds: Set<string>,
): string[] {
  return videos
    .filter((video) => needsHydration(video) && !skipIds.has(video.id))
    .slice(0, MAX_HYDRATE_PER_PASS)
    .map((video) => video.id);
}

export async function fetchMetadataPatches(
  ids: string[],
): Promise<Map<string, Partial<VideoSummary>>> {
  const patches = new Map<string, Partial<VideoSummary>>();
  if (ids.length === 0) return patches;

  await mapWithConcurrency(ids, 1, async (id) => {
    try {
      patches.set(id, await getVideoDetails(id));
    } catch (error) {
      // Private or removed videos are expected in old playlists, so don't warn.
      if (error instanceof BackendApiError && error.kind !== "unknown") {
        console.debug("Playlist track metadata unavailable", id, error.kind);
      } else {
        console.warn("Failed to hydrate playlist track metadata", id, error);
      }
    }
  });

  return patches;
}

const asNullable = <T>(value: T | undefined) => value ?? null;

/** Fills only missing fields; never overwrites existing data. */
export function applyMetadataPatches(
  videos: VideoSummary[],
  patches: Map<string, Partial<VideoSummary>>,
): { videos: VideoSummary[]; changed: boolean } {
  let changed = false;

  const merged = videos.map((video) => {
    const patch = patches.get(video.id);
    if (!patch) return video;

    const next: VideoSummary = {
      ...video,
      durationSeconds: hasDuration(video)
        ? video.durationSeconds
        : patch.durationSeconds ?? video.durationSeconds ?? null,
      isLive: video.isLive ?? patch.isLive ?? null,
      viewCountText: video.viewCountText || patch.viewCountText || null,
      publishedText: video.publishedText || patch.publishedText || null,
      channelId: video.channelId ?? patch.channelId ?? null,
      thumbnailUrl: video.thumbnailUrl ?? patch.thumbnailUrl ?? null,
      channelName: video.channelName || patch.channelName || "",
      title: video.title || patch.title || "",
    };

    const differs = (Object.keys(next) as Array<keyof VideoSummary>).some(
      (key) => asNullable(next[key]) !== asNullable(video[key]),
    );
    if (!differs) return video;
    changed = true;
    return next;
  });

  return { videos: changed ? merged : videos, changed };
}
