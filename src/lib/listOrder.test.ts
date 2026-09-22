import { describe, expect, it } from "vitest";

import { uniqueById } from "./listOrder";

describe("uniqueById", () => {
  it("keeps the first occurrence of each id", () => {
    const first = { id: "a", n: 1 };
    const result = uniqueById([first, { id: "b", n: 2 }, { id: "a", n: 3 }]);
    expect(result).toEqual([first, { id: "b", n: 2 }]);
    expect(result[0]).toBe(first);
  });
});
