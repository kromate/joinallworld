# Nigerian businesses and Allworld commerce research

Research date: 7 October 2026. This is a broad business taxonomy and a small verified example set, not an exhaustive directory of every Nigerian business, an endorsement, or permission to use a brand. No merchants have been contacted or enrolled.

## Research basis and limits

The National Bureau of Statistics describes its economic classification basis in its [GDP methodology](https://www.nigerianstat.gov.ng/page/gdp-methodology) and covers retail, wholesale, hospitality, repair, professional and personal services in its [distributive trade and services methodology](https://www.nigerianstat.gov.ng/download/4). These support researching beyond conventional online shops. Their historical economic figures are not used here as current market-size estimates.

Paystack's [business categories](https://support.paystack.com/en/articles/2129730) cover many of the transaction types below, but that list is not approval for a particular merchant or Allworld's proposed business model. Its [ineligible-business policy](https://support.paystack.com/en/articles/2127042) and country restrictions must also be applied. The two pages contain broad categories that require case-specific clarification, particularly finance and escrow. An API's existence does not resolve provider eligibility.

The categories, in-world representations and sequencing below are design synthesis. They are not an official classification or a claim that every example is presently available through Goalmatic. The source inventory is in [app-inventory.md](app-inventory.md), and the API findings are in [platform-contracts.md](platform-contracts.md).

## Business families

Flow keys: **goods** = catalogue, variant, quantity, order, fulfillment; **appointment** = provider, service, time and location; **commission** = brief, quotation, agreed deliverable and acceptance; **download** = digital product and authorized delivery; **reservation** = capacity/date inventory; **lead** = discovery and inquiry pending specialist fulfillment.

| Business family | Representative Nigerian business types | Possible place in Allworld | Real transaction and design implications |
| --- | --- | --- | --- |
| Food retail | Provision shops, supermarkets, fruit sellers, foodstuff traders | Market stall or neighbourhood grocery | Goods; pickup/service area, stock and perishability |
| Food preparation | Buka, restaurant, bakery, small-chops vendor, caterer | Restaurant or food court | Goods or catering commission; preparation time, collection, allergens |
| Clothing | Boutiques, ready-to-wear sellers, thrift clothing, fabric shops | Fashion store | Goods; sizes, variants, condition and returns |
| Tailoring | Tailors, fashion designers, embroidery services | Tailor's studio | Appointment plus commission; measurements, approvals and delivery date |
| Accessories | Shoemakers, bag makers, jewellery and watch sellers | Craft shop | Goods or commission; authenticity and customization |
| Beauty | Barbers, salons, braiders, makeup artists, nail technicians | Salon | Appointment; practitioner, duration, location and cancellation |
| Beauty products | Cosmetics, skincare, hair and wig sellers | Beauty shop | Goods; product claims and applicable product compliance |
| Electronics | Phone shops, computer shops, accessory and appliance sellers | Electronics shop | Goods; serial/warranty/condition information |
| Repairs | Phone, computer, appliance and furniture repair | Repair workshop | Diagnostic appointment, quotation, authorization and completion evidence |
| Home goods | Furniture, furnishings, kitchenware, decoration | Furniture showroom | Goods; dimensions, transport and installation |
| Home services | Cleaners, laundry, dry cleaning, waste collection | Service office | Appointment or repeat service; coverage, collection and completion |
| Trades | Electricians, plumbers, carpenters, painters, AC installers | Trades workshop | Site visit and commission; scope and change approval |
| Printing | Printers, sign makers, packaging, stationery suppliers | Print studio | Goods plus uploaded artwork/proof approval; quantity tiers |
| Creative services | Photographers, videographers, illustrators, designers, musicians | Creative studio | Appointment or commission; usage rights and deliverables |
| Software services | Freelance developers, agencies, automation consultants | Developer studio | Commission; requirements, milestones, repository/IP handover |
| Software products | SaaS vendors, software licences, plugins, templates | Software showroom | Download or subscription; entitlement, updates and support |
| Media products | Books, courses, music, art files, game assets | Bookshop or creator gallery | Download; licences, private assets and access revocation rules |
| Education | Tutors, language teachers, vocational trainers | Classroom | Appointment or reservation; attendance and safeguarding |
| Fitness and leisure | Trainers, gyms, dance teachers, recreational clubs | Gym or activity venue | Appointment/reservation; capacity, participation terms |
| Events | Event planners, decorators, equipment hire, venues | Event centre | Commission/reservation; date conflicts, capacity and cancellation |
| Accommodation | Hotels, guest houses, short-let operators | Hotel or reception | Reservation; room-night inventory, identity and cancellation |
| Travel experiences | Tour guides and travel agencies | Visitor centre | Reservation/lead; actual operator and travel terms |
| Transport and delivery | Couriers, haulage, taxis, vehicle hire | Dispatch office | Quote/booking; origin, destination, custody and tracking |
| Auto businesses | Parts shops, mechanics, tyre vendors, car washes | Garage | Goods/appointment; fitment, diagnosis and completion |
| Agriculture | Growers, fish/poultry farms, produce traders, input suppliers | Farm shop or produce market | Goods/wholesale quote; units, seasonality, quality and delivery |
| Wholesale and manufacturing | Distributors, small manufacturers, fabricators, processors | Warehouse or workshop | Commission/wholesale; minimum order, lead time and specification |
| Construction and property | Builders, architects, estate agents, property developers | Design studio or property office | Lead/appointment first; real title and professional checks are separate |
| Professional services | Accountants, lawyers, engineers, consultants | Office | Appointment/commission; professional eligibility and confidential files |
| Health | Pharmacies, clinics, laboratories, medical services | Clinic information point | Defer real transactions pending specialist regulation and data handling |
| Financial and utility services | Financial providers, insurance, bill-payment and energy businesses | Information/service office | Defer payments until provider authorization and sector contracts exist |

This covers 30 families. It deliberately separates software developers from property developers and includes informal traders, individual service providers and incorporated businesses. A category does not establish that an individual seller is eligible to trade.

## Verified public examples

These first-party pages describe the products/services shown. They establish useful commercial patterns, not legal registration, service quality, live checkout availability, API access or partnership with Allworld. No prices, outlet counts or merchant assets should be imported from this research without a separate freshness and permission check.

| Example | Publicly described offering | What it teaches the model |
| --- | --- | --- |
| [FoodCo](https://corporate.foodco.ng/about-us/) | Groceries, household goods, restaurant and bakery products | One merchant can offer several business types; stock and fulfillment attach to the actual branch |
| [Shoprite Nigeria](https://shoprite.ng/shop/) | Supermarket product catalogue | Browsing a real catalogue requires inventory and fulfillment context |
| [Printivo](https://printivo.com/category/business-cards) | Printed cards with design-upload/template options | Custom products need specification and proof approval, beyond a simple cart |
| [Eden Life](https://ouredenlife.com/subscription/) | Meal, cleaning and laundry service plans | Recurring services need coverage, schedules, cancellation and repeat-payment design |
| [Seamfix](https://seamfix.com/blog/from-an-nysc-posting-letter-to-a-career-in-software-engineering-my-seamfix-journey/) | Software engineering and products serving Nigerian customers | Developer businesses include project work and software products |
| [House of Tara](https://www.houseoftara.com/) | Beauty products, studio services and makeup education | A single business may need goods, appointments and classes |
| [GIG Logistics](https://giglogistics.com/) | Delivery and haulage services in Nigeria | Delivery is a separate service with its own tracking and responsibility |
| [Wakanow](https://www.wakanow.com/) | Flights, hotels and travel packages | Real travel inventory is not interchangeable with virtual travel in Allworld |

## Recommended scope for a first pilot, pending Anthony's choice

Support the broad taxonomy in the business model, but prove one purchase model first. A small cohort of physical-goods sellers with merchant-managed pickup/delivery is closest to the existing Store Studio implementation. Appointment businesses are a separate second slice because Bookins currently has no payment state. Digital purchases need actual entitlement delivery and rights checks. Custom development and other project work need quotations, milestones and acceptance that the archived client/invoice Apps do not yet implement.

Differentiate **fictional gameplay business**, **real merchant listing**, and **real purchasable offer**. Fictional NPC shops must never imply a real order. A player can style a shop before verification; real checkout should require the correct seller, supported category, payment connection and fulfillment terms. Existing named venues on the city map do not imply merchant authorization.

Each real listing would need, at minimum: business identity and claimant evidence, category, Goalmatic account/installation binding, public trading name, actual service area, currency, contact/support route, return/cancellation rules, delivery/collection options and verification state. Record source URL, evidence date and claim status for imported discovery listings. Seller contact details and customer addresses are not general world-map data.

Allworld's virtual location and a merchant's real delivery area must be independent. A player visiting virtual Lagos from another country can explore freely; checkout still needs to establish whether the actual buyer destination is served.

## Provider and privacy findings

- Paystack supports sharing a transaction's settlement with subaccounts through [split payments](https://paystack.com/docs/payments/split-payments/). Goalmatic's inspected merchant adapter does not currently expose that workflow. This is neither escrow nor a stored consumer wallet.
- Paystack's [aggregator guidance](https://support.paystack.com/en/articles/4509698) calls for identifiable vendors, order/service details, delivery evidence, clear terms and customer support. Its [terms](https://paystack.com/terms) also constrain payment aggregation. Confirm Allworld's exact merchant structure with Paystack before enabling it; neither page alone proves approval.
- The [ineligible-business policy](https://support.paystack.com/en/articles/2127042) includes escrow, restricts entry-fee/prize activities, and lists cryptocurrency trading among unsupported Nigerian categories. Keep simulated deposits, loans, rewards and competitive games wholly outside real payments. Do not infer a Nigerian mobile-wallet ban from the separate South Africa subsection; wallet eligibility remains an explicit provider/legal question.
- [Payment verification](https://paystack.com/docs/payments/verify-payments/) belongs on the server, with duplicate fulfillment prevented. [Webhook signatures](https://paystack.com/docs/payments/webhooks/) must be verified before business effects. A successful browser return is not settlement evidence.
- The [settlement API](https://paystack.com/docs/api/settlement/) describes payouts to bank accounts. An Allworld earnings screen must distinguish paid orders, refunds/disputes, pending settlement and completed payout, rather than calling all sales a withdrawable balance.
- The [Nigeria Data Protection Commission's guidance](https://ndpc.gov.ng/faqs/) supports determining a lawful basis and informing people about data processing. Automatic account provisioning must have a disclosed purpose and appropriate authorization; not every user needs every Goalmatic App or integration.

## What a nationwide merchant directory would additionally require

An entity directory is a separate dataset programme: agreed source/licensing, geographic coverage, category definitions, branch deduplication, freshness cadence, claimant verification, correction/takedown process and seller enrollment. Business names found on the internet should remain unclaimed discovery records until verified; they must not receive generated checkout pages that suggest endorsement. No claim of exhaustive Nigerian merchant coverage is made by this research.
