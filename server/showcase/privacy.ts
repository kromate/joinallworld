/** OWNER: showcase. Account privacy hooks, the way server/real-value/privacy.ts does them. Call erasure inside the account-deletion transaction. */
import { record } from './data.ts';
import type { Db } from '../types.ts';

/**
 * Remove the shop of each of these characters and every contact event they took part in. Answers the ids of the removed shops'
 * photos: the caller deletes their bytes from the image store once the transaction has been saved (AfterChange.showcasePhotos).
 */
export function eraseShowcase(db: Db, publicIds: readonly string[]): string[] {
  const ids = new Set(publicIds), collection: unknown = db.showcase, photos: string[] = [];
  if (!ids.size || !record(collection)) return photos;
  const removed = new Set<string>();
  if (record(collection.shops)) {
    for (const [id, shop] of Object.entries(collection.shops)) {
      if (!record(shop)) continue;
      if (typeof shop.owner === 'string' && ids.has(shop.owner)) {
        removed.add(id);
        if (Array.isArray(shop.photos)) for (const photo of shop.photos) if (record(photo) && typeof photo.id === 'string') photos.push(photo.id);
        delete collection.shops[id];
      } else if (Array.isArray(shop.photos)) {
        // A report this person made on someone else's photo goes with them.
        for (const photo of shop.photos) if (record(photo) && Array.isArray(photo.reports)) photo.reports = photo.reports.filter((who) => typeof who !== 'string' || !ids.has(who));
      }
    }
  }
  if (record(collection.owners)) for (const id of ids) delete collection.owners[id];
  if (record(collection.contacts)) {
    for (const [id, event] of Object.entries(collection.contacts)) {
      if (record(event) && ((typeof event.buyer === 'string' && ids.has(event.buyer)) || (typeof event.shop === 'string' && removed.has(event.shop)))) delete collection.contacts[id];
    }
  }
  return photos;
}

/** Only what these characters supplied: their shop (links included, they wrote them) and the contacts they made as a buyer. */
export function exportShowcase(db: Db, publicIds: readonly string[]) {
  const ids = new Set(publicIds), collection: unknown = db.showcase;
  const result: { shops: object[]; contacts: { id: string; shop: string; kind: string; at: number }[] } = { shops: [], contacts: [] };
  if (!ids.size || !record(collection)) return result;
  if (record(collection.shops)) {
    for (const shop of Object.values(collection.shops)) {
      if (!record(shop) || typeof shop.owner !== 'string' || !ids.has(shop.owner)) continue;
      // Reporter identities on a photo are other people's: left out.
      const photos = Array.isArray(shop.photos) ? shop.photos.flatMap((photo) => (record(photo) ? [{ id: photo.id, w: photo.w, h: photo.h, n: photo.n, at: photo.at }] : [])) : [];
      result.shops.push({ ...shop, photos });
    }
  }
  if (record(collection.contacts)) {
    for (const event of Object.values(collection.contacts)) {
      if (record(event) && typeof event.buyer === 'string' && ids.has(event.buyer) && typeof event.id === 'string' && typeof event.shop === 'string' && typeof event.kind === 'string' && typeof event.at === 'number') result.contacts.push({ id: event.id, shop: event.shop, kind: event.kind, at: event.at });
    }
  }
  return result;
}
