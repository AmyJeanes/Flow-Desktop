import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoSummary } from "../types/video";

const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => {
  settings.set(key, value);
});

vi.mock("./api/db", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string) => setSetting(key, value),
}));
vi.mock("./api/youtube", () => ({
  getPlaylistDetails: vi.fn(),
}));

import { WATCH_LATER_PLAYLIST_ID, updateStoredPlaylistTracks } from "./playlistLibrary";

const SAVED_ID = "PLsaved";

const video = (id: string): VideoSummary => ({
  id,
  title: id,
  channelName: "chan",
  thumbnailUrl: `thumb-${id}`,
});

beforeEach(() => {
  settings.clear();
  setSetting.mockClear();
  settings.set(
    "user_playlists",
    JSON.stringify([
      {
        id: WATCH_LATER_PLAYLIST_ID,
        name: "Watch Later",
        tracks: [video("a"), video("b"), video("c")],
        createdAt: "2024-01-01T00:00:00.000Z",
        source: "Owned",
      },
      {
        id: SAVED_ID,
        name: "Saved",
        tracks: [video("a")],
        createdAt: "2024-01-01T00:00:00.000Z",
        source: "Saved",
        thumbnailUrl: "card-thumb",
        videoCountText: "500 videos",
      },
    ]),
  );
});

describe("updateStoredPlaylistTracks", () => {
  it("skips the write when an updater returns the stored tracks unchanged", async () => {
    await updateStoredPlaylistTracks(WATCH_LATER_PLAYLIST_ID, (tracks) => tracks);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("derives the thumbnail and count from the new tracks", async () => {
    const updated = await updateStoredPlaylistTracks(WATCH_LATER_PLAYLIST_ID, [video("c")]);
    expect(updated?.thumbnailUrl).toBe("thumb-c");
    expect(updated?.videoCountText).toBe("1 video");
  });

  it("keeps a saved playlist's full count text when its first-page snapshot changes", async () => {
    const updated = await updateStoredPlaylistTracks(SAVED_ID, [video("x"), video("y")]);
    expect(updated?.tracks.map((track) => track.id)).toEqual(["x", "y"]);
    expect(updated?.thumbnailUrl).toBe("thumb-x");
    expect(updated?.videoCountText).toBe("500 videos");
  });
});
