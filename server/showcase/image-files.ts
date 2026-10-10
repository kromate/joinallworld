/**
 * OWNER: showcase
 * Showcase photos live in an image store of their own (Node: DATA_DIR/showcase-images, Worker: the table `showcase_images`),
 * apart from chat pictures, whose store drops everything older than 30 days and then the oldest over its ceiling whatever the
 * conversation. A showcase store never evicts: `trim` removes nothing, and the upload route refuses a new photo at the ceiling.
 */
import type { ImageStore } from '../types.ts';

/** The same store with its age and size eviction switched off. */
export const keepAlways = (store: ImageStore): ImageStore => ({ ...store, trim: async () => [] });
