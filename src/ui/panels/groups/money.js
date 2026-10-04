/** Lazy panel group: the Phone apps about money and things you own. Loaded on first open (see ../index.js). */
import jobs from '../jobs.js';
import bank from '../bank.js';
import invest from '../invest.js';
import houses from '../houses.js';
import cars from '../cars.js';
import groceries from '../groceries.js';
import boutique from '../boutique.js';
import ride from '../ride.js';

export default [jobs, bank, invest, houses, cars, groceries, boutique, ride].flat();
