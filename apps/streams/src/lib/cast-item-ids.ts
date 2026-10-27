const MAX_ITEM_ID_LENGTH = 128;

function hashedId(id: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < id.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(id.charCodeAt(index))) * 0x100000001b3n);
  }
  return `sid:${hash.toString(16).padStart(16, '0')}`;
}

/** Keep bridge identities bounded while add-on lookups and progress retain their original ids. */
export class CastItemIds {
  private readonly outgoing = new Map<string, string>();
  private readonly incoming = new Map<string, string>();

  constructor(ids: readonly string[]) {
    // Reserve every short id first, including ids that happen to look like a generated stand-in.
    for (const id of ids) if (id.length <= MAX_ITEM_ID_LENGTH) {
      this.outgoing.set(id, id);
      this.incoming.set(id, id);
    }
    for (const id of ids) {
      if (this.outgoing.has(id)) continue;
      const base = hashedId(id);
      let bridgeId = base;
      for (let suffix = 1; this.incoming.has(bridgeId); suffix += 1) bridgeId = `${base}:${suffix}`;
      this.outgoing.set(id, bridgeId);
      this.incoming.set(bridgeId, id);
    }
  }

  bridgeId(id: string): string {
    const value = this.outgoing.get(id);
    if (value === undefined) throw new Error('Playback item is missing from the session queue.');
    return value;
  }

  originalId(id: string): string {
    return this.incoming.get(id) ?? id;
  }
}
