import { useCallback, useEffect, useRef, useState } from "react";
import { getPlaylistDetails, getVideoDetails } from "./api/youtube";
import { uniqueById } from "./listOrder";
import {
  formatVideoCountText,
  getStoredPlaylistById,
  isProtectedPlaylistId,
  normalizePlaylist,
  resolvePlaylistTitle,
  storedPlaylistThumbnail,
  updateStoredPlaylistTracks,
  type StoredPlaylist,
} from "./playlistLibrary";
import {
  applyVideoDetails,
  ENRICHMENT_CHUNK_DELAY_MS,
  ENRICHMENT_CHUNK_SIZE,
  ENRICHMENT_TRACK_LIMIT,
  needsEnrichment,
} from "./playlistEnrichment";
import type { VideoDetails, VideoSummary } from "../types/video";

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
    // Cleared so enrichment never pairs the old list with the new playlist.
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
          remoteVideos = uniqueById(details.videos ?? []);
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

      // A saved playlist is a first-page snapshot of a live one: show the fresh
      // remote list, and use the snapshot only as the offline fallback and as a
      // cache of metadata already back-filled (see the hydration effect).
      // Owned/protected lists are local-only, so their stored tracks stay
      // authoritative.
      const preferRemote = normalizedStored?.source === "Saved" && remoteVideos.length > 0;
      const resolvedVideos = preferRemote && normalizedStored
        ? withStoredMetadata(remoteVideos, normalizedStored.tracks)
        : normalizedStored?.tracks.length
          ? normalizedStored.tracks
          : remoteVideos;

      // Keep the snapshot current with the live first page: it is the offline
      // fallback, the cache the hydration effect persists into, and the source
      // of the library card's thumbnail, which otherwise stays broken once the
      // first video is removed. Awaited so the hydration persist follows it.
      if (preferRemote && normalizedStored && !snapshotMatches(normalizedStored, resolvedVideos)) {
        await updateStoredPlaylistTracks(playlistId, resolvedVideos).catch((snapshotError) => {
          console.warn("Failed to refresh stored playlist snapshot", snapshotError);
        });
      }

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

  // Per playlist, since this hook outlives a switch; a pass stops once its playlist leaves the screen.
  const attemptedEnrichment = useRef(new Set<string>());
  const enrichmentRunning = useRef<string | null>(null);
  const activePlaylistId = useRef(playlistId);
  useEffect(() => {
    activePlaylistId.current = playlistId;
    attemptedEnrichment.current = new Set();
    return () => {
      activePlaylistId.current = undefined;
    };
  }, [playlistId]);

  const enrichTracks = useCallback((id: string, tracks: VideoSummary[]) => {
    const targets = tracks
      .filter((track) => needsEnrichment(track) && !attemptedEnrichment.current.has(track.id))
      .slice(0, ENRICHMENT_TRACK_LIMIT);
    if (targets.length === 0) return;
    if (enrichmentRunning.current === id) return;
    enrichmentRunning.current = id;
    for (const track of targets) attemptedEnrichment.current.add(track.id);

    void (async () => {
      try {
        for (let start = 0; start < targets.length; start += ENRICHMENT_CHUNK_SIZE) {
          if (activePlaylistId.current !== id) return;
          const refreshed = new Map<string, VideoDetails>();
          for (const track of targets.slice(start, start + ENRICHMENT_CHUNK_SIZE)) {
            try {
              refreshed.set(track.id, await getVideoDetails(track.id));
            } catch {
              // Private or removed videos are expected in old playlists.
            }
          }
          if (refreshed.size > 0) {
            setVideos((previous) => applyVideoDetails(previous, refreshed));
            // Applied to what's stored now, so a reorder or removal meanwhile survives.
            await updateStoredPlaylistTracks(id, (stored) => applyVideoDetails(stored, refreshed));
          }
          await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_CHUNK_DELAY_MS));
        }
      } catch (enrichError) {
        console.warn("Failed to save enriched playlist tracks", enrichError);
      } finally {
        if (enrichmentRunning.current === id) enrichmentRunning.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    if (playlistId && storedPlaylist?.id === playlistId) enrichTracks(playlistId, videos);
  }, [videos, playlistId, storedPlaylist?.id, enrichTracks]);

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

/**
 * Remote values win; fields the remote list lacks keep what enrichment stored. A video new to the
 * snapshot is stamped as added now, like one saved with the playlist.
 */
function withStoredMetadata(remote: VideoSummary[], stored: VideoSummary[]) {
  const storedById = new Map(stored.map((track) => [track.id, track]));
  const addedAt = Date.now();
  return remote.map((video) => {
    const storedTrack = storedById.get(video.id);
    if (!storedTrack) return { ...video, addedAtInPlaylist: addedAt };
    return applyVideoDetails([storedTrack], new Map([[video.id, video]]))[0] ?? video;
  });
}

function snapshotMatches(stored: StoredPlaylist, tracks: VideoSummary[]) {
  return (
    stored.tracks.length === tracks.length &&
    stored.tracks.every((track, index) => track.id === tracks[index]?.id) &&
    stored.thumbnailUrl === storedPlaylistThumbnail(tracks)
  );
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
