import { useCallback, useEffect, useRef, useState } from "react";
import { getPlaylistDetails } from "./api/youtube";
import {
  formatVideoCountText,
  getStoredPlaylistById,
  isProtectedPlaylistId,
  normalizePlaylist,
  resolvePlaylistTitle,
  updateStoredPlaylistTracks,
  type StoredPlaylist,
} from "./playlistLibrary";
import {
  applyMetadataPatches,
  fetchMetadataPatches,
  selectHydrationTargets,
} from "./playlistMetadata";
import type { VideoSummary } from "../types/video";

export interface PlaylistDetailsMeta {
  id: string;
  title: string;
  description?: string | null;
  channelName: string;
  viewCountText: string | null;
  videoCount: number;
  videoCountText: string;
  thumbnailUrl: string | null;
  updatedLabel: string;
}

export function usePlaylistDetails(playlistId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storedPlaylist, setStoredPlaylist] = useState<StoredPlaylist | null>(null);
  const [meta, setMeta] = useState<PlaylistDetailsMeta | null>(null);
  const [videos, setVideos] = useState<VideoSummary[]>([]);

  const load = useCallback(async () => {
    if (!playlistId) {
      setLoading(false);
      setError("Playlist not found");
      return;
    }

    setLoading(true);
    setError(null);
    // Cleared so the back-fill never pairs the old list with the new playlist.
    setVideos([]);

    try {
      const stored = await getStoredPlaylistById(playlistId);
      const normalizedStored = stored ? normalizePlaylist(stored) : null;
      setStoredPlaylist(normalizedStored);

      let remoteVideos: VideoSummary[] = [];
      let remoteTitle: string | null = null;
      let remoteChannel = isProtectedPlaylistId(playlistId) ? "Flow" : "YouTube";
      let remoteDescription: string | null = null;
      let remoteCount: number | null = null;
      let remoteViewCountText: string | null = null;

      if (!isProtectedPlaylistId(playlistId)) {
        try {
          const details = await getPlaylistDetails(playlistId);
          remoteVideos = details.videos ?? [];
          remoteTitle = details.title;
          remoteChannel = details.channelName || remoteChannel;
          remoteDescription = details.description ?? null;
          remoteCount = details.videoCount ?? remoteVideos.length;
          remoteViewCountText = details.viewCountText ?? null;
        } catch (fetchError) {
          console.warn("Failed to fetch remote playlist details", fetchError);
          if (!normalizedStored) {
            throw fetchError;
          }
        }
      }

      const resolvedVideos = normalizedStored?.tracks.length
        ? normalizedStored.tracks
        : remoteVideos;

      const videoCount = resolvedVideos.length
        || remoteCount
        || normalizedStored?.videoCount
        || 0;

      const thumbnailUrl = normalizedStored?.thumbnailUrl
        ?? resolvedVideos[0]?.thumbnailUrl
        ?? remoteVideos[0]?.thumbnailUrl
        ?? null;

      const title = resolvePlaylistTitle(
        normalizedStored?.name,
        normalizedStored?.sourceTitle,
        remoteTitle,
      );

      const updatedAt = normalizedStored?.createdAt;
      const updatedLabel = normalizedStored?.isProtected
        ? "Built-in playlist"
        : updatedAt
        ? formatUpdatedLabel(updatedAt)
        : "Updated recently";

      setVideos(resolvedVideos);
      const resolvedOwner = !isUnknownOwner(remoteChannel)
        ? remoteChannel
        : resolvedVideos[0]?.channelName ?? remoteChannel;

      setMeta({
        id: playlistId,
        title,
        description: normalizedStored?.description ?? remoteDescription,
        channelName: resolvedOwner,
        viewCountText: remoteViewCountText,
        videoCount: videoCount > 0 ? videoCount : resolvedVideos.length,
        videoCountText: formatVideoCountText(
          videoCount > 0 ? videoCount : resolvedVideos.length,
        ),
        thumbnailUrl,
        updatedLabel,
      });
    } catch (loadError) {
      console.error("Failed to load playlist details", loadError);
      setError("Could not load this playlist.");
      setMeta(null);
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tried tracks that stay incomplete aren't retried while the page is open.
  const attempted = useRef<{ playlistId: string | undefined; ids: Set<string> }>({
    playlistId,
    ids: new Set(),
  });

  useEffect(() => {
    if (!playlistId || storedPlaylist?.id !== playlistId) return;
    if (attempted.current.playlistId !== playlistId) {
      attempted.current = { playlistId, ids: new Set() };
    }
    const attemptedIds = attempted.current.ids;
    const targets = selectHydrationTargets(videos, attemptedIds);
    if (targets.length === 0) return;
    for (const id of targets) attemptedIds.add(id);

    void (async () => {
      try {
        const patches = await fetchMetadataPatches(targets);
        if (patches.size === 0) return;

        setVideos((previous) => applyMetadataPatches(previous, patches).videos);
        // Applied to what's stored now, so a reorder or removal meanwhile survives.
        await updateStoredPlaylistTracks(
          playlistId,
          (tracks) => applyMetadataPatches(tracks, patches).videos,
        );
      } catch (hydrateError) {
        console.warn("Failed to back-fill playlist metadata", hydrateError);
      }
    })();
  }, [videos, playlistId, storedPlaylist?.id]);

  return {
    loading,
    error,
    storedPlaylist,
    meta,
    videos,
    setVideos,
    reload: load,
  };
}

function isUnknownOwner(name: string) {
  return name.trim().toLowerCase() === "unknown owner";
}

function formatUpdatedLabel(isoDate: string) {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return "Updated recently";

  const diffMs = Date.now() - timestamp;
  const dayMs = 86_400_000;

  if (diffMs < dayMs) return "Updated today";
  if (diffMs < dayMs * 2) return "Updated yesterday";
  if (diffMs < dayMs * 7) return "Updated this week";

  return `Updated ${new Date(timestamp).toLocaleDateString()}`;
}
