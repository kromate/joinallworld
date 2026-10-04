/** Lazy panel group: Governor, State House, Neighbours, Billboards and the Rich List. Loaded on first open (see ../index.js). */
import governor from '../governor.js';
import neighbours from '../neighbours.js';
import ads from '../ads.js';
import richlist from '../richlist.js';

export default [governor, neighbours, ads, richlist].flat();
