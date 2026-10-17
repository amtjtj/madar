import { describe, expect, it } from 'vitest';

import { descendantIds, flattenTree } from './tree';

const items = [
  { id: 'b', parent: 'a' },
  { id: 'a', parent: null },
  { id: 'c', parent: 'b' },
  { id: 'd', parent: 'missing' },
];

describe('flattenTree', () => {
  it('orders depth-first with depth and lifts orphans to the top', () => {
    const flat = flattenTree(
      items,
      (i) => i.parent,
      (x, y) => x.id.localeCompare(y.id),
    );
    expect(flat.map((f) => [f.item.id, f.depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 0],
    ]);
  });
});

describe('descendantIds', () => {
  it('includes the node and everything below it', () => {
    expect([...descendantIds(items, (i) => i.parent, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });
});
