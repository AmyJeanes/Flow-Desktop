/**
 * Order `items` by `orderedIds`. Ids not in the list keep their relative order
 * at the end (stable sort), so membership never changes — only the ordering.
 */
export const orderByIds = <T extends { id: string }>(
  items: T[],
  orderedIds: string[],
): T[] => {
  const rank = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  const rankOf = (item: T) => rank.get(item.id) ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    return ra === rb ? 0 : ra < rb ? -1 : 1;
  });
};

/**
 * Move `movedId` directly after `afterId` (or to the front when `afterId` is
 * null). Returns `items` untouched when either id is missing, so a stale move
 * against a list edited elsewhere is a no-op rather than a corruption.
 */
export const moveAfterId = <T extends { id: string }>(
  items: T[],
  movedId: string,
  afterId: string | null,
): T[] => {
  const moved = items.find((item) => item.id === movedId);
  if (!moved) return items;
  const rest = items.filter((item) => item.id !== movedId);
  const anchorIndex = afterId === null ? -1 : rest.findIndex((item) => item.id === afterId);
  if (afterId !== null && anchorIndex < 0) return items;
  const insertAt = anchorIndex + 1;
  const next = [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)];
  return next.every((item, index) => item === items[index]) ? items : next;
};

/** First occurrence of each id wins. */
export const uniqueById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};
