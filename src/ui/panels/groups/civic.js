/** Lazy panel group: Governor, State House, Neighbours, Billboards, the Rich List, the Gem hunt sheet and the Radio app. Loaded on first open (see ../index.js). */
import '../../phone/icons-more.js';
import governor from '../governor.js';
import neighbours from '../neighbours.js';
import ads from '../ads.js';
import richlist from '../richlist.js';
import hunt from '../hunt.js';
import radio from '../radio.js';

export default [governor, neighbours, ads, richlist, hunt, radio].flat();
