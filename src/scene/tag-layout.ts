/** Separate projected labels without moving their world-space interaction targets. */
interface Label { x: number; y: number; visible: boolean }
interface Extent { jawWidth: number; jawHeight: number }

export function separateTags(tags: Label[], sizes: Extent[], width: number, top: number, bottom: number): void {
  const gap = 3;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!, size = sizes[i]!;
    if (!tag.visible) continue;
    tag.x = Math.max(size.jawWidth / 2, Math.min(width - size.jawWidth / 2, tag.x));
    const anchor = Math.max(top + size.jawHeight, Math.min(bottom, tag.y));
    let y = anchor, placed = false;
    // Earlier labels keep priority: people remain anchored; later table labels move aside.
    for (let direction = -1; direction <= 1; direction += 2) {
      y = anchor;
      for (let pass = 0; pass <= i; pass++) {
        let overlap = -1;
        for (let j = 0; j < i; j++) {
          const other = tags[j]!, extent = sizes[j]!;
          if (other.visible && Math.abs(tag.x - other.x) < (size.jawWidth + extent.jawWidth) / 2 + gap
            && y > other.y - extent.jawHeight - gap && y - size.jawHeight < other.y + gap) { overlap = j; break; }
        }
        if (overlap < 0) { tag.y = y; placed = true; break; }
        const other = tags[overlap]!, extent = sizes[overlap]!;
        y = direction < 0 ? other.y - extent.jawHeight - gap : other.y + size.jawHeight + gap;
        if (y - size.jawHeight < top || y > bottom) break;
      }
      if (placed) break;
    }
    // If a very dense view has no vertical slot, retain the original target instead of hiding it.
  }
}
