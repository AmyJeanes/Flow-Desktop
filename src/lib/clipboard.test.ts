import { afterEach, describe, expect, it, vi } from "vitest";
import { shareLink } from "./clipboard";

const URL = "https://www.youtube.com/watch?v=vN44jvYD0aY";

function stubNavigator(share?: () => Promise<void>) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });
  return writeText;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shareLink", () => {
  it("opens the share sheet without copying", async () => {
    const writeText = stubNavigator(() => Promise.resolve());
    expect(await shareLink("Title", URL)).toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("treats closing the share sheet as done", async () => {
    const writeText = stubNavigator(() => Promise.reject(new DOMException("cancelled", "AbortError")));
    expect(await shareLink("Title", URL)).toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link when the share sheet can't open", async () => {
    const writeText = stubNavigator(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    expect(await shareLink("Title", URL)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it("copies the link where there is no share sheet", async () => {
    const writeText = stubNavigator();
    expect(await shareLink("Title", URL)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL);
  });
});
