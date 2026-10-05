# Ibadan city module

Ibadan is an open city module in Oyo State. It covers the five urban local governments and six surrounding local governments used for the metropolitan play area:

- Akinyele
- Egbeda
- Ibadan North
- Ibadan North-East
- Ibadan North-West
- Ibadan South-East
- Ibadan South-West
- Ido
- Lagelu
- Oluyole
- Ona Ara

The city map uses the shared Nigeria projection and renders those 11 local governments. The lazy Oyo data chunk retains all 33 state local-government features for future state modules, while the atlas currently shows the full Oyo State outline. The module does not imply that the Ibadan play area covers the rest of Oyo State.

## The map

The Ibadan pack is drawn from the eleven local governments' real boundaries in the shared frame, one unit to 100 m, so it sits at its true size beside Lagos (the eleven cover about 2,875 km2, Lagos State's twenty local governments about 3,548 km2). The main roads are OpenStreetMap motorway, trunk and primary ways in the play area and named secondary ways in the core (`roads.ts`, rebuilt by `scripts/geo/build-ibadan-roads.ts`, simplified and quantised, source hash in its header). The land around Oyo State (Ogun, Osun, Ondo, Kwara and the Republic of Benin) is drawn flat and quiet under the whole-state view from the Nigeria atlas data, with Ogun's reserved city answering a tap with "Opening soon". Ibadan is inland: no water is drawn and the whole-state view is centred, not nudged north for a coast.

## Playable places

The content catalogue has 25 venues: Home and 24 public venues. Every public venue has two distinct regulars and at least one activity. The venue set covers food, recreation, markets, health, worship, polling, government and nightlife. Every canonical career has a local workplace.

Landmark venues include the University of Ibadan, The Polytechnic, Lead City University, University College Hospital, Cocoa House, Mapo Hall, Bower's Tower, Agodi Gardens, Bodija Market, Dugbe Market, Gbagi New International Market, Lekan Salami Stadium, the National Museum of Unity, IITA Forest Reserve and Eleyele Reservoir. Transport venues include Iwo Road, Orita Challenge, Obafemi Awolowo Station at Moniya and Ibadan Airport.

Scenes reuse the shared scene builders (a park, a market, a buka, a hospital, a worship hall, a statehouse, a hub, an airport, a walk). Bower's Tower and Eleyele Reservoir use the park builder; the University of Ibadan and the museum use the walk builder, which is a woodland trail. A scene of their own for the tower, the reservoir and a campus court is a separate piece of work.

Three generic venues provide required mechanics without claiming a real private business:

- Mapo Civic Polling Centre is a beta polling setup at the mapped civic complex.
- Dugbe Amala Joint is a beta food counter within the verified Dugbe Market area.
- Mokola Salon is a beta neighbourhood salon at a published Mokola commercial point.

## University of Ibadan scope

The University of Ibadan is a compact visitor venue. It uses the published UI–Agbowo main-gate coordinate as its entry, then offers a generic university-court walk. The map overlay separately identifies Trenchard Hall from OpenStreetMap way `364487900`, along with the zoological garden and botanical garden.

A full campus comparable to the University of Lagos campus is a separate proposal. It would need its own reviewed scene, navigation, buildings, venue-specific activities and campus boundary treatment. This module does not instantiate the University of Lagos scene or present the visitor route as a complete campus.

## Culture and activities

The city card uses the Yoruba welcome `Ẹ káàbọ̀` and names amala with gbegiri and ewedu. Its culture copy refers to the familiar seven-hills and brown-roofs description and the Olubadan chieftaincy line. The map keeps separate markers for the present Aafin Olubadan Ile Ibadan at Oke Aremo and the historic palace at Oja'ba.

Activities include ayo and evening music at Agodi Gardens, an old-city view at Mapo Hall, the Bower's Tower viewpoint, a museum tour, a forest walk, market bargaining, a stadium match and eating amala in Dugbe. Weekly events use only venues and tables declared by the Ibadan catalogue.

## Travel

Two beta links connect Lagos and Ibadan:

| Mode | Route | Fare | Simulated duration | Distance |
|---|---|---:|---:|---:|
| Bus | Lagos-Ibadan Expressway | ₦3,500 | 120 seconds | 130 km |
| Train | Mobolaji Johnson Station to Obafemi Awolowo Station | ₦9,000 | 90 seconds | 157 km |

Local geographic route bands use the shared frame, with beta thresholds of 3 km for a short hop and 15 km for a longer city trip. Owned-home trips retain the existing beta schematic quotation policy; they are not measured from the unrelated rented-home point.

The local mode list uses the shared engine IDs with Ibadan labels: Trek, Okada, Bus and Micra taxi. Keke is not offered by this city catalogue.

The railway atlas line is extracted from OpenStreetMap relation `10699301`. Every stored route vertex is an OpenStreetMap source node. The source relation contains a 23.4 metre topological gap between two recorded endpoints; the atlas joins those endpoints as one explicitly recorded schematic segment. No other rail bend is inferred. The route chunk records the API response hash, simplification tolerance, gap endpoints and ODbL attribution.

## Source and licence summary

Administrative geometry comes from geoBoundaries gbOpen Nigeria ADM1 and ADM2 release `9469f09`, originally GRID3, under CC BY 4.0.

Landmark coordinates use official publications, published field measurements, Wikidata CC0 records and OpenStreetMap objects. Each overlay point records its own source, licence and accuracy class. OpenStreetMap-derived coordinates and rail geometry require attribution to OpenStreetMap contributors under ODbL 1.0. Large-area centroids, such as IITA Forest Reserve, are labelled as centroids rather than entrances. Linear landmarks use sourced route references; the module does not invent river or road traces.

Public identity references include:

- [Oyo State overview and landmark list](https://oyostate.gov.ng/about-oyo-state/)
- [Oyo State local governments](https://oyostate.gov.ng/local-governments/)
- [Oyo State tourism investment material](https://oysipa.oyostate.gov.ng/admin/uploads/INVEST-IN-TOURISM.pdf)
- [University of Ibadan road network](https://ui.edu.ng/content/university-ibadan-road-network)
- [University of Ibadan Zoological Garden](https://zoogarden.ui.edu.ng/about-us-0)
- [Lead City University official Toll Gate address](https://www.lcu.edu.ng/index.php/ab)
- [IITA Forest Reserve](https://forestcenter.iita.org/about/iita-forest-reserve/)
- [Nigerian Railway Corporation Lagos District](https://nrc.gov.ng/lagos-district/)
- [Official Olubadan palace visitor information](https://olubadan.com/visit/)
- [OpenStreetMap Lagos-Ibadan railway relation](https://www.openstreetmap.org/relation/10699301)

## Beta values

The following values are provisional game design and are marked beta in content or documented as beta metadata:

- local-government land tiers;
- rented-home sizes, rents and move-in charges;
- the default rented home;
- bus and train fares and simulated durations;
- local travel fares, durations, need effects and roadside-event chances;
- activity durations, costs, rewards, need effects and skill XP;
- calendar days and hours;
- regular roles, dialogue and venue ambient lines;
- career-to-workplace mappings, while shared career ladders and pay mechanics remain unchanged;
- billboard slots, table placements and spray-enabled events;
- the three generic gameplay venues described above.

Stored Ibadan characters retain their existing state and receive the one-time free local-government choice controlled by the module's compatibility rule. New characters and visitors use the same city-local housing, career and social catalogues after the content loader completes.

Old preview venue ids resolve to the closest functional local equivalent when a saved location or pending local trip is loaded. Existing current ids take precedence. This preserves journeys such as the old reading-room-to-home trip without silently placing the character at Home before it finishes. Activity ids and intercity destinations are not rewritten: an obsolete paid activity uses the existing authoritative invalidation and refund rule.
