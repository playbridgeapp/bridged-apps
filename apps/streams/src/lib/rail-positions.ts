/** Home rail places for this page session: horizontal offset and revealed card count. */
export type RailPosition = { scrollLeft: number; limit: number };

const MAX_RAILS = 200;
const positions = new Map<string, RailPosition>();

export function railPosition(key: string): RailPosition | undefined {
  return positions.get(key);
}

export function saveRailPosition(key: string, position: RailPosition): void {
  positions.delete(key);
  if (position.scrollLeft <= 0 && position.limit <= 0) return;
  positions.set(key, position);
  // Bound memory: forget the least recently saved rails first.
  while (positions.size > MAX_RAILS) positions.delete(positions.keys().next().value!);
}

export function clearRailPositions(): void {
  positions.clear();
}
