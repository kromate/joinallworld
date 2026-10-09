# Launch reply follow-up

Primary-source Chrome review, 9 October 2026. This is a partial source audit with an explicit access boundary. No runtime, test, backend or prior research report was changed. No engagement, game-account use, provider action or payment occurred.

## Coverage ledger

| Post | Root counter and sort | Captured coverage | Endpoint / gap |
|---|---|---|---|
| [City launch](https://x.com/Shalom_HeyEliy/status/2107244922290012303) | 1,976 displayed replies; Relevant | 380 distinct statuses in loaded root view, then 100 successfully traversed reply branches; 731 distinct non-root statuses overall. Root view can itself include descendants, so this is not 380 proven direct children. | Root paged80 times to Show probable spam. Expansion produced no new rows and control remained. One branch subsequently stuck loading after one reload; independent branch also stuck.28 initially discovered root-view branches and107 newly discovered descendant branches remain unvisited. |
| [Original launch](https://x.com/Shalom_HeyEliy/status/2105541070486470749) | Counter and sort unavailable | No post/reply content readable in this attempt. | Independent navigation produced only Loading and X splash. One reload remained the same. No substitute source or inferred content counted. |

**All-comments coverage is not achieved.** The precise remaining queue is preserved for continuation. Do not turn a matching counter, terminal viewport or captured descendant count into a complete-tree claim.

The initial city root had129 nonzero-reply branch statuses. All were eligible for traversal regardless of whether their text was congratulatory.100 were successfully visited; one became inaccessible;28 were not reached after the access failure. During traversal107 further descendant branch candidates appeared. Some may already have their immediate children visible, but their own branch pages remain unvisited. `city-launch-remaining-branches.json` contains all135 pending candidates. `city-launch-branch-log.json` records each successful visit and leftover controls; probable-spam controls were attempted once in later branches, with four early such boundaries recorded without a second visit. No probable-spam contents are presumed read.

Root and branch captures exclude ads and sidebar recommendations. Counts still include genuine reply chatter, emoji reactions, promotion and money requests; those are omitted from product findings. Quoted-post text stays attached to the quoting reply and is not counted as another independently opened status. Image-only reactions were not interpreted; product-reference images and quoted links were not exhaustively inspected before the loading failure. Four long non-root posts retained Show more, listed below.

## Author claims and reported chronology

| Source | First-party claim / status | Meaning for this audit |
|---|---|---|
| [City-launch author](https://x.com/Shalom_HeyEliy/status/2107244922290012303) | Abuja and Port Harcourt said to be live alongside Lagos. Author reports2million players,101k+ currently playing and10million+ visits that day. | Author claims only. No independent traffic or implementation validation. |
| [Account named Official Lagos Life App](https://x.com/LagosLifeApp/status/2107383407562891769) | Says improvements are being worked on. Similar generic responses appear in several branches. | Self-identified app account; affiliation not independently verified. Not a delivery receipt. |
| [Later player reply](https://x.com/Michelwils42557/status/2107549240956170244) | Says multi-city property ownership is now possible and they have rentals. | Anecdote contradicts earlier single-home complaints; may reflect updates or misunderstanding. Needs exact current source/runtime comparison. |
| [Storage explanation](https://x.com/SntNxtDr/status/2107255919901855795) | Another user says missing private jet is in storage. | Do not label the preceding complaint verified asset destruction. |

## Deduplicated requests and reports

Every row links an observed status. A user report is not a proven defect. Reader requests, including regulated-money or risky role-play proposals, are recorded without endorsement or implied implementation permission.

| Theme | User request | User report / ambiguity | Direct source |
| Multi-city homes | Own separately furnished homes in several cities without moving all belongings each time. | — | [Reply](https://x.com/bigtamuno/status/2107245961236107599) |
| Cross-city property preservation | — | Reports losing Lagos mansion/decor and private jet after taking an Abuja house. A nested reply says jet is in storage, not proof of actual loss. | [Reply](https://x.com/unpopulardee/status/2107251961137705087) |
| Cross-city decor | — | Trying a Port Harcourt house reportedly reset Lagos decoration. | [Reply](https://x.com/PokoLawyer/status/2107258261418529255) |
| Conflicting ownership guidance | Explain whether moving replaces an existing home. | Earlier reply says only one house; later reply says existing home is unaffected. Neither is an authoritative current contract. | [Reply](https://x.com/mumiyo_/status/2107248009075666977) |
| Abuja homes | Explain buying an Abuja five-bedroom home. | — | [Reply](https://x.com/imfadaka/status/2107256136151990486) |
| Port Harcourt catalogue | Add a mansion option and missing city detail. | — | [Reply](https://x.com/Ayodeleby/status/2107266177764372915) |
| Travel list organization | Show current-city destinations separately instead of a long mixed-city list. | — | [Reply](https://x.com/cherryadevan/status/2107360479274230272) |
| Owned jet economics | Explain/reduce per-flight costs for an already purchased jet. | One reporter was quoted52m to fly owned jet to PH. | [Reply](https://x.com/flowwithOJ/status/2107252069216227525) |
| Group private flights | Let friends ride together in a private jet. | — | [Reply](https://x.com/voidisalive/status/2107255467273588869) |
| Helicopter utility | Make owned helicopter usable instead of decorative. | — | [Reply](https://x.com/not4sa1nt/status/2107245321109786629) |
| Ground travel differentiation | Distinct travel durations by foot/bike/car/bus and greater energy cost walking. | Visible snippet only; remainder remained collapsed. | [Reply](https://x.com/Maveric_X/status/2107712040181617009) |
| Rail/mainland expansion | More mainland Lagos places and train travel. | — | [Reply](https://x.com/ola_mi113/status/2107282558274670692) |
| Fuel duration | Purchased car fuel should last across journeys rather than charge each trip. | — | [Reply](https://x.com/dorin_oni/status/2107296371015373231) |
| Mobility realism | More direct driving and natural entry into other homes, compared with Roblox. | — | [Reply](https://x.com/pepe_ona80194/status/2107346799744684301) |
| Designer persistence | Allow designing while owner is out and allow rehire. | Owner leaving reportedly ejects designer and erases work. | [Reply](https://x.com/Emilojuuu/status/2107276928960884941) |
| Designer timing | Start paid job timer on Decorate, not on hire when several simultaneous clients arrive. | Designer reports lost earnings because multiple homes cannot be completed within one hour. | [Reply](https://x.com/Emilojuuu/status/2107354300691140947) |
| Designer discovery | Searchable job profile with ratings/reviews and hire by player name. | — | [Reply](https://x.com/Emilojuuu/status/2107350258246381700) |
| Hire from chat | Hire a designer from the chat conversation. | — | [Reply](https://x.com/_TheeTricky/status/2107395424130584911) |
| Apply designed layout | A simple control for client to move into designer-created layout. | Client reportedly struggles to adopt the design. | [Reply](https://x.com/circuslover1/status/2108096270036619601) |
| Visitor entry | — | Player says inviting visitors does not show/work. | [Reply](https://x.com/Bighamzy1/status/2107278121040806288) |
| Incoming money | — | Incoming credit transfers and bet wins reportedly absent while debits deduct normally. | [Reply](https://x.com/TallieOfLag0s/status/2107246313842815363) |
| Save loop | — | Repeatedly returns to last saved page after actions. | [Reply](https://x.com/Lawal_civic/status/2107251203130212484) |
| Bet-result/save loop | — | After winning bets, cannot act; reloads last saved state. | [Reply](https://x.com/YxngAezi/status/2107254227383058506) |
| Stadium lock | — | Leaving stadium repeatedly restores prior save there for hours. | [Reply](https://x.com/CFC_fofana_/status/2107252654066028821) |
| Notification glitch | — | Requests notification-glitch repair without detailed reproduction. | [Reply](https://x.com/Angrysagj/status/2107245541096870361) |
| Login recovery | — | Correct password reportedly rejected after logout; nested reply says reset link not received. | [Reply](https://x.com/F_Feezi/status/2107247495269273991) |
| Support contact | — | Complaint email reportedly has no destination. | [Reply](https://x.com/F_Feezi/status/2107250198577918117) |
| Actor-specific login | — | Own account stuck requiring refresh while sister account works on same phone. | [Reply](https://x.com/xreturn_DnD/status/2107449026912145437) |
| Signup | — | Cannot sign up; no cause established. | [Reply](https://x.com/glow_rae/status/2107537301928595674) |
| PC rendering | — | Game no longer appears on PC. | [Reply](https://x.com/clara_cee1/status/2107254041537577316) |
| VIP multiplier | Remove/explain unwanted50× or100× costs. | Player experiences multiplier without wanting VIP. | [Reply](https://x.com/fwyemi/status/2107262948490248379) |
| Resale valuation | Explain/correct low resale proceeds versus purchase. | Example purchase180m versus resale11m. | [Reply](https://x.com/EmperorEazi/status/2107550070954447004) |
| Wealth progression | Make earnings harder and close inflation loopholes. | Users report universal wealth undermines progression. | [Reply](https://x.com/DanieltradesX/status/2107428907079405993) |
| Transfer limits | Remove or explain transfer limit. | — | [Reply](https://x.com/Uchiha1mj/status/2107405300261409265) |
| HUD obstruction | Collapsible top bar. | Bar reportedly blocks scene; nested reply points to Clear screen. | [Reply](https://x.com/seraarchive_/status/2107249185778991134) |
| Message layout | Larger, more realistic full-screen message box. | — | [Reply](https://x.com/MindOnRacks/status/2107261804015673346) |
| Message organization | Pin and delete chats. | — | [Reply](https://x.com/dapo_fuse/status/2107255684874023008) |
| Message visibility | Show all DMs. | — | [Reply](https://x.com/issawaslost/status/2107410672443158717) |
| Relationships from chat | Add friend/family/partner directly from chat, not only world-player card. | — | [Reply](https://x.com/LoukeeahNos/status/2107406692988162134) |
| Proximity voice | Talk to nearby players. | — | [Reply](https://x.com/AdiTrad3s/status/2107388747604013340) |
| Voice notes | Voice notes in messaging. | — | [Reply](https://x.com/MissPlotTwistt/status/2107375297985208620) |
| Club recognition | Show spender their own name in club announcements. | — | [Reply](https://x.com/odunwire3/status/2107245470762381556) |
| Club performance | — | Quilox glitches; nested report says shutdown action unavailable due glitch. | [Reply](https://x.com/Fujizen_/status/2107253538456055912) |
| Graphics/mobile parity | Improve scene, appliance and character interactions. | Mobile reportedly less clear/attractive than demonstrated view. | [Reply](https://x.com/Ugochie4Brands/status/2108081033622987154) |
| Personal music | Choose songs during house party. | — | [Reply](https://x.com/earthsbaby58369/status/2107374926277574773) |
| Visit stamps | Collect destination stamps, more milestones and decoration. | — | [Reply](https://x.com/Derondsgnr/status/2107510715313745946) |
| City stats | Show population/current players per city. | — | [Reply](https://x.com/OtunbaBrickz/status/2107431688355582441) |
| Political roles | More representatives, assembly members and area chairmen. | — | [Reply](https://x.com/IkobongImoUdo/status/2107333826108342669) |
| Election geography | INEC offices, political parties and regional elections. | — | [Reply](https://x.com/winterwearstore/status/2107356456395653476) |
| Feedback community | Discord/support community for bug reports and requests. | — | [Reply](https://x.com/AllwellCruz/status/2107391601244868615) |
| In-game technical reporting | A dedicated report-technical-issue app. | Respawning at home cited as motivating issue. | [Reply](https://x.com/Thalastsepian/status/2107250129975546188) |
| Safety/moderation | Improve safety before growing. | User claims dangerous buzzwords unflagged; another says profanity is blocked. No abuse test performed or accusation verified. | [Reply](https://x.com/JOkoyefi/status/2107246269156487307) |
| Harassment | — | Player says they were harassed in PH. Branch not reached before loading outage. | [Reply](https://x.com/CodeXBT/status/2107481407962427637) |
| Family presence | Visible parent characters and children. | — | [Reply](https://x.com/IvanPatrick475/status/2107602924108914965) |
| Celebrities/media | Celebrities, artists, influencers and reality shows. | — | [Reply](https://x.com/drharveee/status/2107260495719751987) |
| Financial instruments | Stocks/crypto and asset-backed loans suggested. | — | [Reply](https://x.com/Grimm_0x/status/2107256670422209022) |
| Real-world commerce | Brands in simulation accepting real orders delivered physically. | — | [Reply](https://x.com/ChrisBernief/status/2107362109302399073) |
| Cash-out proposal | Convert game balance to real money; user alleges real-money top-up exists. | Neither financial capability verified. This is a consequential proposal, not a recommendation to implement. | [Reply](https://x.com/Tomyxod/status/2107260566578278507) |
| Name/national identity | Rename for wider Nigeria coverage. | — | [Reply](https://x.com/WildWestCrypt/status/2107407689701589239) |
| Local Abuja details | UniAbuja/Gwagwalada, Wuse2, Monaliza and Mo Arena; local venues/cars. | — | [Reply](https://x.com/AdamXMeta/status/2107296093889241251) |
| UniAbuja surroundings | Student areas Iddo/Giri and specific eateries such as50/50, Nene’s Kitchen and Wazobia Kitchen. | — | [Reply](https://x.com/Ayomhiiide/status/2107250805493694748) |
| Kwara landmarks | Unilorin, Kwasu, Emirates Mall and local businesses. | — | [Reply](https://x.com/obinna1624318/status/2107426351510700098) |
| Role-play proposals | Traditional religious roles/shrines, illegal businesses and corrupt-police scenarios requested. | No implementation inferred or action performed. | [Reply](https://x.com/SahoriIfamosun/status/2107653773627695417) |

## Geographic requests

Repeated requests were deduplicated; popularity is not inferred from this Relevant-sorted sample.

| Requested geography | Example direct source |
|---|---|
| Kano | [Reply](https://x.com/MR__kaurah/status/2107470122717982764) |
| Benin / Edo, including local shrines | [Reply](https://x.com/zeddddicus_/status/2107453101934313625) |
| Ogun | [Reply](https://x.com/LEGEND1804/status/2107479076856312319) |
| Kwara / Ilorin | [Reply](https://x.com/Layii_wey_sabi/status/2107263727212855296) |
| Ibadan / Oyo | [Reply](https://x.com/thisisleroii/status/2107256299763237107) |
| Owerri | [Reply](https://x.com/austinkillz/status/2107844654326788133) |
| Ogbomosho, Ilesha, Uyo | [Reply](https://x.com/iofcal2234/status/2107787601243508890) |
| Jigawa, Kebbi, Taraba/Jalingo | [Reply](https://x.com/Sam_Fak07/status/2107475697698767326) |
| Ile-Ife | [Reply](https://x.com/MikkyInnovate/status/2107262738905137572) |
| Onitsha | [Reply](https://x.com/trybezz/status/2107253089879113790) |
| Asaba and Warri | [Reply](https://x.com/justinijeh/status/2107373359302631805) |
| Ekiti | [Reply](https://x.com/Ayomikun565/status/2107332739892449649) |
| Abakaliki | [Reply](https://x.com/0x_joshio/status/2107376773805506669) |
| Ondo / Akure | [Reply](https://x.com/thedimejii/status/2107422920372854888) |
| Kaduna / Kano | [Reply](https://x.com/Jokertobs/status/2107496575190667441) |
| Delta | [Reply](https://x.com/TheoLonglife/status/2107549823456948703) |
| Abia | [Reply](https://x.com/Buchimanny30/status/2107733509611966631) |
| Jos | [Reply](https://x.com/0xWilly_/status/2107499740514451691) |
| Enugu | [Reply](https://x.com/alidiligent39_/status/2107408408622071957) |
| London and Atlanta | [Visible snippet](https://x.com/HrhKingAlex/status/2107255581236978072); remaining rationale still collapsed |

## Ambiguities and exclusions

- City migration, home ownership, interiors and stored luxury items need separate authoritative contracts. Replies use “buy”, “rent”, “move” and “own” loosely. One user's later correction cannot settle another user's saved state.
- Missing credit and recurring save restoration are strongly repeated reports, but no causal claim links them to betting, server load or city launch without reproduction.
- The real-bank complaint tagging Stanbic IBTC was excluded: it is about an unrelated real financial account, not established game behaviour. External Sim Passport promotion and business solicitations were excluded from implementation findings.
- Safety claim about dangerous terms was not tested. A counterreply about blocked profanity does not establish adequate moderation or substantiate criminal activity.
- Remaining long posts: [travel dynamics](https://x.com/Maveric_X/status/2107712040181617009), [international expansion](https://x.com/HrhKingAlex/status/2107255581236978072), [launch commentary](https://x.com/im_tolumichael/status/2107377918502396001), [builder commentary](https://x.com/samson_nwo2009/status/2107734329577161054). Only visible snippets count.

## Access failure and reproducible continuation

The first blocked branch was [Onitsha request](https://x.com/Caesar_ifeco/status/2107347906118250924). Its observed root-view text remains captured, but the branch URL did not expose content after locator timeout and one reload. Independent [Delta branch](https://x.com/TheoLonglife/status/2107549823456948703) also showed only Loading. The original-launch URL was then tried independently, followed by one reload. It never exposed post content. No bypass, repeated model/provider retry or alternate account was attempted. The cause could be X, connectivity or browser rendering; no unsupported rate-limit diagnosis is asserted.

Private artifacts in `/tmp/allworld-research-20261009/`:

- `city-launch-public-rows.json`:731 observed non-root statuses and root; exact public DOM text/links/reply labels.
- `city-launch-root-keys.json`:381 keys including root from root traversal.
- `city-launch-branch-log.json`:100 successful visits plus inaccessible branch.
- `city-launch-remaining-branches.json`:135 pending branch candidates.
- `original-launch-terminal.txt` and `original-launch-loading.jpg`:access failure witness.

Resume only remaining queue and collapsed text, not a new broad search. Then read original launch when the original page becomes accessible. Recheck counters/time because the conversation is live.

Owned research tab closed, browser lease released. No QA server/build, viewport or network override. User tabs untouched. Tokens and monetary cost unavailable. The original-launch part remains incomplete, and city tree is partial despite substantial coverage.

Public continuation: [135 remaining branch URLs](lagos-life-pending-replies-2026-10-09.md). Primary direct-page fallback also returned403 and its exact-status search returned no result; this did not add readable original-launch evidence.
