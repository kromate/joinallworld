import {buildCityContent,hospitalSpots,type CityVenueSeed} from './descriptions.ts'
import {ABUJA_MAP_ORIGIN,ABUJA_PLAY_BOUNDS} from './rules.ts'
const venueSeeds:readonly (Omit<CityVenueSeed,'spots'> & {spots:CityVenueSeed['spots']|null})[] = [
  {
    "id": "kubwa-garden",
    "name": "Kubwa Community Garden",
    "district": "Kubwa, Bwari",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 7.3410781,
      "lat": 9.1526752
    },
    "description": "Walk, relax and play ayo at the beta neighbourhood garden.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-play-ayo",
            "label": "Play a round of ayo",
            "icon": "book",
            "duration": 7,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "fun"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "millennium-park",
    "name": "Millennium Park",
    "district": "Maitama, AMAC",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 7.4977431,
      "lat": 9.069431
    },
    "description": "Walk through the park and relax on the lawns.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-millennium-park-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "national-mosque",
    "name": "Abuja National Mosque",
    "district": "Central Business District, AMAC",
    "kind": "worship",
    "category": "civic",
    "icon": "worship",
    "point": {
      "lon": 7.4888576,
      "lat": 9.0597485
    },
    "description": "Visit respectfully and learn about the national mosque.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-national-mosque-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance.",
    "variant": "mosque"
  },
  {
    "id": "christian-centre",
    "name": "National Christian Centre",
    "district": "Central Business District, AMAC",
    "kind": "worship",
    "category": "civic",
    "icon": "worship",
    "point": {
      "lon": 7.4951095,
      "lat": 9.0517395
    },
    "description": "Visit respectfully and spend time in quiet reflection.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-christian-centre-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance.",
    "variant": "church"
  },
  {
    "id": "eagle-square",
    "name": "Eagle Square",
    "district": "Central Business District, AMAC",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 7.4998156,
      "lat": 9.0609467
    },
    "description": "Explore the civic square and join a beta public event.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-eagle-square-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "arts-village",
    "name": "Abuja Arts and Crafts Village",
    "district": "Central Business District, AMAC",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 7.4851501,
      "lat": 9.0655759
    },
    "description": "Browse crafts and join a beta Gbagyi pottery learning session.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-arts-village-visit",
            "label": "Learn about Gbagyi pottery",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn",
              "craft"
            ],
            "beta": true,
            "xp": {
              "hustle": 8
            }
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "wuse-market",
    "name": "Wuse Market",
    "district": "Wuse, AMAC",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 7.4660294,
      "lat": 9.0687827
    },
    "description": "Browse produce and compare everyday market prices.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-wuse-market-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "garki-market",
    "name": "Garki Market",
    "district": "Garki, AMAC",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 7.4915319,
      "lat": 9.0219556
    },
    "description": "Browse household goods and food at the market.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-garki-market-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "national-stadium",
    "name": "MKO Abiola National Stadium",
    "district": "Kukwaba, AMAC",
    "kind": "viewing",
    "category": "fun",
    "icon": "viewing",
    "point": {
      "lon": 7.4529637,
      "lat": 9.0369044
    },
    "description": "Train and watch a beta stadium programme.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-national-stadium-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "velodrome",
    "name": "Abuja Velodrome",
    "district": "Kukwaba, AMAC",
    "kind": "gym",
    "category": "fun",
    "icon": "gym",
    "point": {
      "lon": 7.4573368,
      "lat": 9.0390918
    },
    "description": "Learn about track cycling and join a beta fitness session.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-velodrome-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "children-zoo",
    "name": "National Children’s Park and Zoo",
    "district": "Asokoro, AMAC",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 7.5250229,
      "lat": 9.0807378
    },
    "description": "Learn about animals and the park from a beta visitor scene.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-children-zoo-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "uniabuja",
    "name": "University of Abuja",
    "district": "Giri main campus, AMAC",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 7.1762922,
      "lat": 8.9789028
    },
    "description": "Join a beta university teaching workshop.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-uniabuja-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "nile-university",
    "name": "Nile University",
    "district": "Jabi campus area, AMAC",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 7.3988759,
      "lat": 9.0144382
    },
    "description": "Join a beta campus coding workshop.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-nile-university-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "Mapped campus Car Park A reference; not a surveyed main gate."
  },
  {
    "id": "baze-university",
    "name": "Baze University",
    "district": "Jabi campus area, AMAC",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 7.404622,
      "lat": 9.0061589
    },
    "description": "Join a beta campus media workshop.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-baze-university-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "airport",
    "name": "Nnamdi Azikiwe International Airport",
    "district": "Airport area, AMAC",
    "kind": "airport",
    "category": "civic",
    "icon": "airport",
    "point": {
      "lon": 7.2736735,
      "lat": 9.0130994
    },
    "description": "Read flight options and travel to another open city.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-airport-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "idu-station",
    "name": "Idu Station",
    "district": "Idu rail interchange, AMAC",
    "kind": "hub",
    "category": "civic",
    "icon": "hub",
    "point": {
      "lon": 7.3424175,
      "lat": 9.0470806
    },
    "description": "Explore the rail interchange; Kaduna travel is coming.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-idu-station-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "city-gate",
    "name": "Abuja City Gate",
    "district": "Kukwaba approach, AMAC",
    "kind": "walk",
    "category": "fun",
    "icon": "walk",
    "point": {
      "lon": 7.4486196,
      "lat": 9.0356979
    },
    "description": "View the city gate and learn about the capital’s approach.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-city-gate-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "OSM mapped-feature centroid; not a surveyed entrance."
  },
  {
    "id": "utako-hub",
    "name": "Utako Motor and Bus Terminal",
    "district": "Utako, AMAC",
    "kind": "hub",
    "category": "civic",
    "icon": "hub",
    "point": {
      "lon": 7.435012,
      "lat": 9.0657905
    },
    "description": "Read long-distance bus options at the mapped terminal.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-utako-hub-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": false,
    "note": "Mapped feature point; not a surveyed entrance."
  },
  {
    "id": "kubwa-clinic",
    "name": "Kubwa Community Clinic",
    "district": "Kubwa, Bwari",
    "kind": "hospital",
    "category": "civic",
    "icon": "hospital",
    "point": {
      "lon": 7.3410781,
      "lat": 9.1526752
    },
    "description": "Get a beta check-up or queue for the free clinic.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": null,
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "kubwa-kitchen",
    "name": "Kubwa Suya and Kilishi Kitchen",
    "district": "Kubwa, Bwari",
    "kind": "buka",
    "category": "food",
    "icon": "buka",
    "point": {
      "lon": 7.3410781,
      "lat": 9.1526752
    },
    "description": "Eat suya or kilishi in the beta neighbourhood kitchen.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-kubwa-kitchen-visit",
            "label": "Eat suya and kilishi",
            "icon": "book",
            "duration": 8,
            "cost": 800,
            "effects": {
              "hunger": 25,
              "fun": 5
            },
            "tags": [
              "food"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "kubwa-salon",
    "name": "Kubwa Neighbourhood Salon",
    "district": "Kubwa, Bwari",
    "kind": "salon",
    "category": "work",
    "icon": "salon",
    "point": {
      "lon": 7.3410781,
      "lat": 9.1526752
    },
    "description": "Get a beta haircut and catch up with neighbours.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-kubwa-salon-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "wuse-savings",
    "name": "Wuse Savings Hall",
    "district": "Wuse, AMAC",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 7.4665551,
      "lat": 9.0620454
    },
    "description": "Join a beta banking workshop and work a finance shift.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-wuse-savings-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "gwarinpa-evening",
    "name": "Gwarinpa Evening Garden",
    "district": "Gwarinpa, AMAC",
    "kind": "rooftop",
    "category": "fun",
    "icon": "rooftop",
    "point": {
      "lon": 7.3929654,
      "lat": 9.109821
    },
    "description": "Hear music and share evening tea at the beta garden.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-gwarinpa-evening-visit",
            "label": "Hear the evening set",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 12,
              "social": 5
            },
            "tags": [
              "nightlife",
              "music"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property.",
    "hours": {
      "open": 16,
      "close": 23
    }
  },
  {
    "id": "community-house",
    "name": "FCT Community House",
    "district": "Central Business District, AMAC",
    "kind": "statehouse",
    "category": "civic",
    "icon": "statehouse",
    "point": {
      "lon": 7.4851615,
      "lat": 9.0599297
    },
    "description": "Meet the fictional elected Community Chair.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-community-house-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "community-polling",
    "name": "FCT Community Polling Room",
    "district": "Central Business District, AMAC",
    "kind": "polling",
    "category": "civic",
    "icon": "polling",
    "point": {
      "lon": 7.4851615,
      "lat": 9.0599297
    },
    "description": "Vote in the fictional citywide community election.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-community-polling-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "gwagwalada-garden",
    "name": "Gwagwalada Community Garden",
    "district": "Gwagwalada town, Gwagwalada Area Council",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 7.0859144,
      "lat": 8.9360261
    },
    "description": "Walk and meet neighbours at the beta satellite-town garden.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-gwagwalada-garden-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "gwagwalada-market",
    "name": "Gwagwalada Community Market",
    "district": "Gwagwalada town, Gwagwalada Area Council",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 7.0859144,
      "lat": 8.9360261
    },
    "description": "Browse the beta town market and compare prices.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "fct-gwagwalada-market-visit",
            "label": "Visit and learn",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "learn"
            ],
            "beta": true
          }
        ]
      },
      {
        "id": "work",
        "label": "Staff area",
        "activities": []
      }
    ],
    "beta": true,
    "note": "Fictional beta service at a verified district or town locality reference; not a surveyed property."
  },
  {
    "id": "jabi-lake-park",
    "name": "Jabi Lake Park",
    "district": "Jabi lakeside, AMAC",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 7.417552471160889,
      "lat": 9.073736071586609
    },
    "description": "Walk in the lakeside park and learn about the reservoir.",
    "ambient": [
      "Visitors pause beside the lake."
    ],
    "spots": [
      {
        "id": "walk",
        "label": "Lakeside park",
        "activities": [
          {
            "id": "fct-jabi-walk",
            "label": "Walk beside Jabi Lake",
            "icon": "walk",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 8
            },
            "tags": [
              "nature",
              "walk"
            ],
            "beta": true
          }
        ]
      }
    ],
    "note": "Published field-study park reference, Table 3.1; not a surveyed entrance."
  }
]
const venues:readonly CityVenueSeed[] = venueSeeds.map(venue=>({...venue,spots:venue.spots ?? hospitalSpots()}))
const base = buildCityContent({...{
  "cityId": "abuja",
  "cityName": "Abuja",
  "localUnitDescriptions": {
    "abuja-municipal": "The planned capital’s districts, parks, campuses and markets.",
    "bwari": "Kubwa and northern satellite-town communities.",
    "gwagwalada": "The western university and satellite-town corridor.",
    "kuje": "Communities south of the airport approach.",
    "kwali": "Western communities and pottery heritage.",
    "abaji": "The southern gateway of the Federal Capital Territory."
  },
  "people": [
  {
    "name": "Amina Bello",
    "role": "Garden host",
    "quotes": [
      "I keep the ayo board ready for neighbours.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Chinedu Okeke",
    "role": "Neighbourhood walker",
    "quotes": [
      "A short walk helps me settle into the day.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Yetunde Adeyemi",
    "role": "Park walker",
    "quotes": [
      "I enjoy following the paths through the lawns.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Bassey Etim",
    "role": "Sketcher",
    "quotes": [
      "The trees give me plenty of shapes to sketch.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Maryam Musa",
    "role": "Visitor helper",
    "quotes": [
      "Ask about visiting etiquette before entering prayer spaces.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Tosin Ojo",
    "role": "Architecture student",
    "quotes": [
      "I am studying the building from the visitor area.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Ifeoma Nwosu",
    "role": "Church volunteer",
    "quotes": [
      "You are welcome to ask about respectful visiting.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Sani Umar",
    "role": "Choir learner",
    "quotes": [
      "I practise with friends and enjoy hearing different voices.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Aisha Abubakar",
    "role": "Event steward",
    "quotes": [
      "We are setting up a small community programme.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Terseer Ior",
    "role": "City photographer",
    "quotes": [
      "The open square gives me room to frame a picture.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Fatima Yakubu",
    "role": "Pottery learner",
    "quotes": [
      "I am learning how clay is shaped and decorated.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Nkechi Eze",
    "role": "Craft seller",
    "quotes": [
      "Ask about a piece and the maker behind it.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Emeka Obi",
    "role": "Produce trader",
    "quotes": [
      "Compare the baskets before you choose your vegetables.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Kemi Adebayo",
    "role": "Market porter",
    "quotes": [
      "I help shoppers carry their goods through the rows.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Halima Sule",
    "role": "Food trader",
    "quotes": [
      "I can help you choose ingredients for tonight.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Oluwaseun Dada",
    "role": "Shopper",
    "quotes": [
      "I wrote my list before coming to the market.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Binta Mohammed",
    "role": "Football trainee",
    "quotes": [
      "I practise my passing before the session starts.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Uche Nnamdi",
    "role": "Sports supporter",
    "quotes": [
      "A good match brings people together.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Zainab Ibrahim",
    "role": "Cycling learner",
    "quotes": [
      "I am learning how riders use the banked track.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Femi Balogun",
    "role": "Training partner",
    "quotes": [
      "We warm up gently before any harder exercise.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Grace Samuel",
    "role": "Family visitor",
    "quotes": [
      "We came to learn about the animals together.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Ahmed Idris",
    "role": "Nature learner",
    "quotes": [
      "I like asking questions about the park’s wildlife.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Adaeze Nwachukwu",
    "role": "Teaching student",
    "quotes": [
      "We practise explaining one idea clearly at a time.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Moses Dangana",
    "role": "Research learner",
    "quotes": [
      "My notebook fills up quickly during a workshop.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Hauwa Ali",
    "role": "Coding student",
    "quotes": [
      "I learn best when we build a small project together.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Daniel Oche",
    "role": "Lab partner",
    "quotes": [
      "Let us read the problem before choosing a solution.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Rukayat Salisu",
    "role": "Media student",
    "quotes": [
      "I am practising how to tell a clear story.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Ngozi Umeh",
    "role": "Project learner",
    "quotes": [
      "A workshop is better when everyone can contribute.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Joseph Akpan",
    "role": "Terminal traveller",
    "quotes": [
      "I check my destination before joining the queue.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Hadiza Usman",
    "role": "Travel helper",
    "quotes": [
      "The information board is a good place to begin.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Mariam Hassan",
    "role": "Rail passenger",
    "quotes": [
      "Idu connects the city’s rail journeys.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Olumide Lawal",
    "role": "Station learner",
    "quotes": [
      "I am learning how the rail lines fit together.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Esther Chukwu",
    "role": "City walker",
    "quotes": [
      "The gate marks an arrival into the capital.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Ibrahim Sani",
    "role": "Design student",
    "quotes": [
      "I am sketching the shape of the gateway.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Blessing Okoro",
    "role": "Bus passenger",
    "quotes": [
      "I check the route before choosing my journey.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "David Audu",
    "role": "Route helper",
    "quotes": [
      "Tell me the destination you are looking for.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Habiba Garba",
    "role": "Clinic volunteer",
    "quotes": [
      "The free clinic queue is open when you need care.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Chisom Eze",
    "role": "Nursing learner",
    "quotes": [
      "I can help you find the outpatient room.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Samuel Luka",
    "role": "Kitchen cook",
    "quotes": [
      "The suya spices are ready for the evening meal.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Aderonke Ogunleye",
    "role": "Food neighbour",
    "quotes": [
      "I like sharing a plate and a conversation.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Usman Lawal",
    "role": "Hair stylist",
    "quotes": [
      "Tell me the style you would like today.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Patience Ibe",
    "role": "Salon neighbour",
    "quotes": [
      "I stop by for a trim and a chat.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Abubakar Yusuf",
    "role": "Savings adviser",
    "quotes": [
      "Small records make it easier to follow a budget.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Funke Bakare",
    "role": "Finance learner",
    "quotes": [
      "I am learning to keep an account ledger.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Obinna Nwafor",
    "role": "Music host",
    "quotes": [
      "The evening set brings neighbours into the garden.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Ruth Sule",
    "role": "Sound learner",
    "quotes": [
      "I check the speakers before the first song.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Hassan Bako",
    "role": "Community organiser",
    "quotes": [
      "This game election represents our citywide community.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Ezinne Okafor",
    "role": "Information volunteer",
    "quotes": [
      "The Community Chair is a fictional game office.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Opeyemi Ajayi",
    "role": "Ballot helper",
    "quotes": [
      "Read the game candidates before casting your vote.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Musa Danjuma",
    "role": "Community voter",
    "quotes": [
      "We choose a representative for our game community.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Sarah Auta",
    "role": "Garden caretaker",
    "quotes": [
      "We make room for neighbours to sit and talk.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Aliyu Mohammed",
    "role": "Town walker",
    "quotes": [
      "A little time outdoors clears my thoughts.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Joy Nwankwo",
    "role": "Market trader",
    "quotes": [
      "Take a look at today’s baskets before choosing.",
      "Welcome. There is room for another neighbour here."
    ]
  },
  {
    "name": "Victoria Ekanem",
    "role": "Town shopper",
    "quotes": [
      "I enjoy meeting neighbours along the market rows.",
      "Hello. I am glad you stopped to talk."
    ]
  },
  {
    "name": "Ebere Onuoha",
    "role": "Lakeside walker",
    "quotes": [
      "I like to pause by the water after a park walk.",
      "The park is a calm place to meet a neighbour."
    ]
  },
  {
    "name": "Kabiru Adamu",
    "role": "Park visitor",
    "quotes": [
      "I came to spend a little time outdoors.",
      "We can enjoy the park without entering the water."
    ]
  }
],
  "careerVenues": {
    "community-helper": "kubwa-garden",
    "tech": "nile-university",
    "banking": "wuse-savings",
    "music": "gwarinpa-evening",
    "trading": "wuse-market",
    "nursing": "kubwa-clinic",
    "hair": "kubwa-salon",
    "chef": "kubwa-kitchen",
    "dj": "gwarinpa-evening",
    "fitness": "velodrome",
    "creator": "baze-university",
    "teaching": "uniabuja",
    "event": "eagle-square",
    "football": "national-stadium",
    "retail": "garki-market"
  },
  "careerSummaries": {},
  "houses": [
    {
      "id": "fct-garki-home",
      "label": "District flat",
      "districtId": "garki",
      "district": "Garki",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.4818316,
        "lat": 9.0352005
      }
    },
    {
      "id": "fct-wuse-home",
      "label": "District flat",
      "districtId": "wuse",
      "district": "Wuse",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.4665551,
        "lat": 9.0620454
      }
    },
    {
      "id": "fct-maitama-home",
      "label": "District flat",
      "districtId": "maitama",
      "district": "Maitama",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.4908053,
        "lat": 9.0900989
      }
    },
    {
      "id": "fct-asokoro-home",
      "label": "District flat",
      "districtId": "asokoro",
      "district": "Asokoro",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.5196863,
        "lat": 9.0423462
      }
    },
    {
      "id": "fct-gwarinpa-home",
      "label": "District flat",
      "districtId": "gwarinpa",
      "district": "Gwarinpa",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.3929654,
        "lat": 9.109821
      }
    },
    {
      "id": "fct-jabi-home",
      "label": "District flat",
      "districtId": "jabi",
      "district": "Jabi",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.4210076,
        "lat": 9.0646229
      }
    },
    {
      "id": "fct-utako-home",
      "label": "District flat",
      "districtId": "utako",
      "district": "Utako",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.4435303,
        "lat": 9.06911
      }
    },
    {
      "id": "fct-lugbe-home",
      "label": "District flat",
      "districtId": "lugbe",
      "district": "Lugbe",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.3799952,
        "lat": 8.9808369
      }
    },
    {
      "id": "fct-kubwa-home",
      "label": "Self-contain",
      "districtId": "kubwa",
      "district": "Kubwa",
      "rent": 6000,
      "grid": 8,
      "point": {
        "lon": 7.3410781,
        "lat": 9.1526752
      }
    },
    {
      "id": "fct-gwagwalada-home",
      "label": "District flat",
      "districtId": "gwagwalada",
      "district": "Gwagwalada",
      "rent": 5000,
      "grid": 8,
      "point": {
        "lon": 7.0859144,
        "lat": 8.9360261
      }
    },
    {
      "id": "fct-kuje-home",
      "label": "District flat",
      "districtId": "kuje",
      "district": "Kuje",
      "rent": 5000,
      "grid": 8,
      "point": {
        "lon": 7.2272022,
        "lat": 8.8796312
      }
    },
    {
      "id": "fct-kwali-home",
      "label": "District flat",
      "districtId": "kwali",
      "district": "Kwali",
      "rent": 5000,
      "grid": 8,
      "point": {
        "lon": 7.037166,
        "lat": 8.8205774
      }
    },
    {
      "id": "fct-abaji-home",
      "label": "District flat",
      "districtId": "abaji",
      "district": "Abaji",
      "rent": 5000,
      "grid": 8,
      "point": {
        "lon": 6.9440179,
        "lat": 8.4737831
      }
    },
    {
      "id": "fct-central-business-district-home",
      "label": "District flat",
      "districtId": "central-business-district",
      "district": "Central Business District",
      "rent": 14000,
      "grid": 8,
      "point": {
        "lon": 7.4851615,
        "lat": 9.0599297
      }
    }
  ],
  "events": [
    {
      "id": "fct-crafts-day",
      "title": "Crafts day — beta game edition",
      "blurb": "A fictional Saturday craft-learning programme; no official event schedule is claimed.",
      "venue": "arts-village",
      "icon": "star",
      "when": {
        "weekday": 6,
        "from": 10,
        "to": 17
      },
      "spray": false
    }
  ],
  "firstFun": {
    "venue": "kubwa-garden",
    "spot": "visit",
    "activity": "fct-play-ayo",
    "title": "Play ayo in Kubwa",
    "hint": "Kubwa Community Garden · 7 seconds"
  },
  "buka": "kubwa-kitchen",
  "thingsToDo": [
    {
      "venueId": "millennium-park",
      "name": "Millennium Park",
      "line": "Walk through the park and relax on the lawns."
    },
    {
      "venueId": "national-mosque",
      "name": "Abuja National Mosque",
      "line": "Visit respectfully and learn about the national mosque."
    },
    {
      "venueId": "arts-village",
      "name": "Abuja Arts and Crafts Village",
      "line": "Browse crafts and join a beta Gbagyi pottery learning session."
    },
    {
      "venueId": "wuse-market",
      "name": "Wuse Market",
      "line": "Browse produce and compare everyday market prices."
    },
    {
      "venueId": "national-stadium",
      "name": "MKO Abiola National Stadium",
      "line": "Train and watch a beta stadium programme."
    },
    {
      "venueId": "children-zoo",
      "name": "National Children’s Park and Zoo",
      "line": "Learn about animals and the park from a beta visitor scene."
    }
  ],
  "culture": {
    "greeting": "Hello · Sannu · Ẹ káàbọ̀ · Nnọọ",
    "food": [
      "suya",
      "kilishi"
    ],
    "knownFor": [
      "the planned national capital",
      "a meeting place for communities from across Nigeria",
      "Gbagyi and other original peoples of the FCT",
      "parks and a dry harmattan season"
    ]
  },
  "localModes": [
    {
      "id": "trek",
      "label": "Trek",
      "icon": "🚶",
      "fare": 0,
      "seconds": 13,
      "needs": {
        "energy": -10,
        "hygiene": -7
      },
      "xp": {
        "fitness": 15
      },
      "exposed": true,
      "eventChance": 0.4,
      "blurb": "Walk between nearby places.",
      "beta": true
    },
    {
      "id": "danfo",
      "label": "Bus",
      "icon": "🚌",
      "fare": 350,
      "seconds": 9,
      "needs": {},
      "eventChance": 0.2,
      "blurb": "A shared bus across the city routes.",
      "beta": true
    },
    {
      "id": "cab",
      "label": "Along taxi",
      "icon": "🚕",
      "fare": 600,
      "seconds": 7,
      "needs": {
        "energy": 1
      },
      "eventChance": 0.15,
      "blurb": "A shared taxi along the city routes.",
      "beta": true
    },
    {
      "id": "keke",
      "label": "Satellite-town keke",
      "icon": "🛺",
      "fare": 250,
      "seconds": 8,
      "needs": {
        "hygiene": -1
      },
      "eventChance": 0.18,
      "blurb": "Only trips within the same declared Kubwa or Gwagwalada zone.",
      "beta": true
    }
  ],
  "radioVenueIds": [
    "gwarinpa-evening"
  ],
  "billboardRoads": [
    {
      "id": "fct-bb-airport",
      "near": "city-gate",
      "road": "Airport Road"
    },
    {
      "id": "fct-bb-north",
      "near": "gwarinpa-evening",
      "road": "Outer Northern Expressway"
    },
    {
      "id": "fct-bb-south",
      "near": "national-stadium",
      "road": "Outer Southern Expressway"
    }
  ],
  "tablePlaces": [
    {
      "id": "fct-kubwa-whot",
      "venueId": "kubwa-garden",
      "game": "whot",
      "label": "Kubwa garden table",
      "seats": 4
    },
    {
      "id": "fct-stadium-penalty",
      "venueId": "national-stadium",
      "game": "penalty",
      "label": "Stadium penalty spot",
      "seats": 2
    }
  ],
  "dreamWording": {
    "lekki-landlord": {
      "label": "Capital Landlord",
      "goal": "Build a net worth of ₦1,000,000.",
      "measure": "Your cash plus what you have bought, minus loan debt, counts toward ₦1,000,000."
    },
    "afrobeats-star": {
      "label": "Capital Music Headliner",
      "goal": "Reach Music level 10.",
      "measure": "Your Music level, including partial levels, counts toward level 10."
    },
    "yaba-unicorn": {
      "label": "Capital Founder"
    }
  },
  "lotteryWording": {}
},origin:ABUJA_MAP_ORIGIN,bounds:ABUJA_PLAY_BOUNDS,venues})
export const ABUJA_CONTENT = Object.freeze({...base,civicExplanation:'The Community Chair is a fictional citywide game-community office. It is separate from the FCT Minister and the real elected area council chairmen.',localModeZones:[{mode:'keke',venueIds:['kubwa-garden','kubwa-clinic','kubwa-kitchen','kubwa-salon'],rentedHomeIds:['fct-kubwa-home'],ownedHomeUnitIds:['bwari']},{mode:'keke',venueIds:['gwagwalada-garden','gwagwalada-market'],rentedHomeIds:['fct-gwagwalada-home'],ownedHomeUnitIds:['gwagwalada']}] as const})
