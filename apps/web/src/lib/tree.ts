/** Flattens a parent/child list into depth-first order with depth, for indented trees. */
export function flattenTree<T extends { id: string }>(
  items: readonly T[],
  parentOf: (item: T) => string | null,
  compare?: (a: T, b: T) => number,
): Array<{ item: T; depth: number }> {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    // Orphans (parent missing or archived) are shown at the top level.
    const parent = parentOf(item);
    const key = parent && ids.has(parent) ? parent : null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }
  const out: Array<{ item: T; depth: number }> = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    const list = [...(children.get(parent) ?? [])];
    if (compare) list.sort(compare);
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({ item, depth });
      visit(item.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return out;
}

/** The ids of `id` and all its descendants. */
export function descendantIds<T extends { id: string }>(
  items: readonly T[],
  parentOf: (item: T) => string | null,
  id: string,
): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      const parent = parentOf(item);
      if (parent && result.has(parent) && !result.has(item.id)) {
        result.add(item.id);
        grew = true;
      }
    }
  }
  return result;
}
