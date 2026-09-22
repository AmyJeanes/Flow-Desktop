import { describe, expect, it } from "vitest";

import { applyMetadataPatches, selectHydrationTargets } from "./playlistMetadata";
import type { VideoSummary } from "../types/video";

const video = (id: string, extra: Partial<VideoSummary> = {}): VideoSummary => ({
  id,
  title: id,
  channelName: "chan",
  ...extra,
});

const complete = { durationSeconds: 120, viewCountText: "1K views", publishedText: "2 days ago" };

describe("selectHydrationTargets", () => {
  it("targets tracks missing a duration, view count, or publish date", () => {
    const videos = [
      video("full", complete),
      video("noDuration", { viewCountText: "1K views", publishedText: "2 days ago" }),
      video("noViews", { durationSeconds: 120, publishedText: "2 days ago" }),
      video("noPublished", { durationSeconds: 120, viewCountText: "1K views" }),
    ];
    expect(selectHydrationTargets(videos, new Set())).toEqual([
      "noDuration",
      "noViews",
      "noPublished",
    ]);
  });

  it("treats a live stream as having its duration", () => {
    const videos = [video("live", { ...complete, durationSeconds: null, isLive: true })];
    expect(selectHydrationTargets(videos, new Set())).toEqual([]);
  });

  it("skips already-attempted ids", () => {
    const videos = [video("a"), video("b")];
    expect(selectHydrationTargets(videos, new Set(["a"]))).toEqual(["b"]);
  });
});

describe("applyMetadataPatches", () => {
  it("fills a missing duration and view count", () => {
    const videos = [video("v", { durationSeconds: null })];
    const patches = new Map([["v", { durationSeconds: 999, viewCountText: "2M views" }]]);

    const { videos: next, changed } = applyMetadataPatches(videos, patches);

    expect(changed).toBe(true);
    expect(next[0]?.durationSeconds).toBe(999);
    expect(next[0]?.viewCountText).toBe("2M views");
  });

  it("fills a missing view count without clobbering an existing duration", () => {
    const videos = [video("v", { durationSeconds: 300 })];
    const patches = new Map([["v", { durationSeconds: 999, viewCountText: "2M views" }]]);

    const { videos: next } = applyMetadataPatches(videos, patches);

    expect(next[0]?.durationSeconds).toBe(300);
    expect(next[0]?.viewCountText).toBe("2M views");
  });

  it("returns the same array when the tracks already have the metadata", () => {
    const videos = [video("v", complete), video("other")];
    const patches = new Map([["v", { durationSeconds: 999, viewCountText: "2M views" }]]);

    const { videos: next, changed } = applyMetadataPatches(videos, patches);

    expect(changed).toBe(false);
    expect(next).toBe(videos);
  });
});
