# Kano catalogue sources

Checked 5 October 2026. Coordinate facts are separated from source prose, imagery and access claims. Individual landmark URLs, licences and accuracy are retained in `src/game/cities/kano/landmarks.ts`.

## Geographic data

The map uses the pinned [geoBoundaries gbOpen](https://www.geoboundaries.org/) Nigeria ADM1/ADM2 release under CC BY 4.0. The exact metropolitan source names are Kano Municipal, Dala, Fagge, Gwale, Nassarawa, Tarauni, Kumbotso and Ungogo. All 44 source ADM2 features tile the Kano state outline; only eight are playable.

Road, rail and mapped feature references use [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. The verified Nigeria extract is dated 3 October 2026, SHA-256 `6dfa568106792fb8a9bba0b12a91e1edfb789d38c452087b2c48bc58326880b5`. No unlicensed satellite basemap is bundled.

Fictional rentals use named OSM locality points: [Gidan Sarkin Kano neighbourhood](https://www.openstreetmap.org/node/2990890881), [Dala](https://www.openstreetmap.org/node/2990890864), [Fagge](https://www.openstreetmap.org/node/501530290), [Gwale Rinji](https://www.openstreetmap.org/node/2990890887), [Gama in Nassarawa](https://www.openstreetmap.org/node/2974797951), [Tarauni](https://www.openstreetmap.org/node/2974797977), [Chalawa in Kumbotso](https://www.openstreetmap.org/node/501488773) and [Ungogo Arewa](https://www.openstreetmap.org/node/7503343744). These are neighbourhood references, not surveyed homes or actual rental listings. The Sabon Gari fictional tea garden and film workshop use [the mapped quarter reference](https://www.openstreetmap.org/node/2974797975).

Kwari Market `8.53087, 12.00404`, Sabon Gari Market `8.53784, 12.01314` and Kurmi Market `8.51421, 12.00239` are published field-location facts from [Geographical Analysis of Fire Outbreak in Kano Urban Markets, Nigeria, 2023](https://dergipark.org.tr/en/download/article-file/3357082), page 181. Only the numbers and factual identity are used; no source prose, satellite imagery or map is reproduced. These are study-location references, not surveyed current entrances. The OSM “Kanti Kwari Market” point farther west is not substituted for the published textile-market location.

The dye-pit coordinate is [Wikidata Q109265005](https://www.wikidata.org/wiki/Q109265005), CC0 1.0. It is an attraction reference with no underlying cited coordinate survey. [Tiga Dam Q2432731](https://www.wikidata.org/wiki/Q2432731) is also a CC0 dam-area reference, not a public gate. The actual reservoir geometry lies near that point; the coarse OSM Tiga Reservoir node at `8.5, 11.5837037` is not used.

The actual Wudil university marker comes from [OSM campus way 389351930](https://www.openstreetmap.org/way/389351930). The [university’s official site](https://www.kustwudil.edu.ng/admissionlist) confirms the present Aliko Dangote University of Science and Technology name. The similarly named OSM urban feature is not used for this Wudil marker.

Air distance inputs use the Kano airport’s mapped OSM feature, Abuja airport’s [OSM relation 10749710](https://www.openstreetmap.org/relation/10749710), and Lagos airport’s [Wikidata Q1043631 coordinate](https://www.wikidata.org/wiki/Q1043631), CC0. Haversine distance uses a 6,371 km Earth radius and rounds to the nearest kilometre. Beta flight timers and fares are not carrier tariffs.

## Heritage and culture

[UNESCO’s Kano walls and associated sites entry](https://whc.unesco.org/en/tentativelists/5171/) documents heritage identity. The separate published approximate wall-overlay source, licence, attribution and error observations are recorded in [MAP-KANO-SOURCES.md](../MAP-KANO-SOURCES.md). That overlay is historical context, not verified current wall geometry. [UNESCO’s Durbar entry](https://ich.unesco.org/en/RL/durbar-in-kano-01895) documents the procession and transmission of leatherwork, weaving, dyeing and related crafts. The game’s calendar edition, learning activities and dialogue are fictional, with no official future event date claimed.

[Tour Nigeria’s dye-pit description](https://tournigeria.gov.ng/home-to-africas-oldest-dye-pit/) and [Pan-Atlantic University’s craft account](https://artsandculture.google.com/story/500-years-of-tie-and-dye-production-pan-atlantic-university/7wVRhbHix5iuLA?hl=en) support indigo heritage. [NCMM](https://museum.ng/museums__trashed/national-museums/) lists Gidan Makama Museum. [Bayero University](https://psnc.buk.edu.ng/about_buk) documents the Old Campus near Kabuga and its separate New Campus; its [2010 annual report](https://buk.edu.ng/sites/default/files/publication/ar2010.pdf) documents the local Kannywood film resource centre.

[Tour Nigeria’s Kano page](https://tournigeria.gov.ng/kano/) identifies suya and fura da nono. [Bayero’s food-economy research](https://buk.edu.ng/sites/default/files/oer/Inaugural_lecture/46_inaugural_lecture.pdf) discusses tuwo, masa and northern meat products including kilishi. [National Open University food-science courseware](https://nou.edu.ng/coursewarecontent/FST%20202%20PRINCIPLES%20OF%20FOOD%20SCIENCE%20AND%20TECHNOLOGY.pdf) identifies rice tuwo as tuwo shinkafa. Food scenes and effects are original game content.

The “Tiga rock” wording is not enough to establish a separate peak coordinate. [JICA’s official water-resources report](https://openjicareport.jica.go.jp/pdf/12146478_05.pdf) describes the Rock Castle Hotel by Tiga Dam. An [openly licensed first-person photograph](https://commons.wikimedia.org/wiki/File:A_drone_pilot_on_a_rock_in_environs_of_Rock_Castle_Hotel.jpg) also identifies rocks in that area, but provides no exact geographic point. No hotel photograph or invented rock geometry is bundled.

## Weather and transport qualifications

The [Federal Environmental Assessment Department’s 2021 Kano ESIA](https://ead.gov.ng/wp-content/uploads/2021/07/KANO-ESIA-FINAL-20210308.-JERRY-ES-input.pdf), Table 4.1, reports predominantly May–October rainfall and an August peak. [Bayero’s 2023 environmental plan](https://www.acephap.buk.edu.ng/sites/default/files/docs/ESMP/Nigeria-ACE2-ACEPHAP-ESMP-30th%20January%202023.pdf) describes harmattan from late October to February. The game conservatively uses the whole months November–February. Monthly rain probabilities are beta simulation values, not a conversion of measured rainfall into observed daily probabilities.

Dated reports relay major-road tricycle restrictions ([2022 government announcement](https://www.channelstv.com/2022/11/29/kano-govt-bans-tricycle-on-major-roads/)) and overnight restrictions ([2025 police report](https://punchng.com/police-clamp-down-on-motorcycle-passenger-transport-in-kano-restrict-tricycles/)). They are qualifications, not confirmation of an exact current regulatory map or curfew. Keke is confined to authored beta neighbourhood endpoint zones, and no commercial okada is offered. No real journey planning or current legal transit routing is claimed.

## Fictional outing boundary

The Tiga marker’s geographic source remains the qualified dam-area reference. Its departure button opens Kano Railway Station in the local destination picker only when the character is in Kano. The station’s timed countryside outing is original beta game writing, not evidence of a real operator, admission policy or rock-access route. The action starts and ends at the existing forecourt and does not teleport to a remote map or estate. No additional geography is inferred from this activity.
