import {buildCityContent,hospitalSpots,type CityVenueSeed} from './descriptions.ts'
import {KANO_MAP_ORIGIN,KANO_PLAY_BOUNDS} from './rules.ts'
const seeds:readonly(Omit<CityVenueSeed,'spots'>&{spots:CityVenueSeed['spots']|null})[]=[
  {
    "id": "nassarawa-garden",
    "name": "Gama Community Garden",
    "district": "Gama, Nassarawa",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Play a round of ayo.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-play-ayo",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "palace",
    "name": "Gidan Rumfa — Exterior Gate",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "walk",
    "category": "civic",
    "icon": "walk",
    "point": {
      "lon": 8.519661,
      "lat": 11.9887528
    },
    "description": "Learn about the palace exterior.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-palace-visit",
            "label": "Learn about the palace exterior",
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
    "note": "Mapped Kofar Kudu main-gate reference; only an exterior visitor scene, with no private-quarter entry."
  },
  {
    "id": "central-mosque",
    "name": "Kano Central Mosque",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "worship",
    "category": "civic",
    "icon": "worship",
    "point": {
      "lon": 8.5176406,
      "lat": 11.9948552
    },
    "description": "Visit respectfully.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-central-mosque-visit",
            "label": "Visit respectfully",
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
    "note": "Mapped feature centroid; not a surveyed entrance.",
    "variant": "mosque"
  },
  {
    "id": "kurmi-market",
    "name": "Kurmi Market",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 8.51421,
      "lat": 12.00239
    },
    "description": "Compare prices at Kurmi.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-market-haggle",
            "label": "Compare prices at Kurmi",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "market",
              "haggling"
            ],
            "beta": true,
            "xp": {
              "hustle": 8
            }
          },
          {
            "id": "kano-leather-learn",
            "label": "Learn about leather finishing",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "xp": {
              "hustle": 8
            },
            "tags": [
              "craft",
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
    "note": "2023 study sampling-location reference; not a surveyed market gate."
  },
  {
    "id": "dye-pits",
    "name": "Kofar Mata Dye Pits",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 8.526098888888889,
      "lat": 12.000853055555556
    },
    "description": "Learn indigo dyeing.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-indigo-learn",
            "label": "Learn indigo dyeing",
            "icon": "book",
            "duration": 8,
            "cost": 0,
            "effects": {
              "fun": 5
            },
            "tags": [
              "craft",
              "dyeing",
              "learn"
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
    "note": "Published attraction reference; coordinate statement has no underlying cited survey and does not establish an entrance."
  },
  {
    "id": "museum",
    "name": "Gidan Makama Museum",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "office",
    "category": "fun",
    "icon": "office",
    "point": {
      "lon": 8.5210264,
      "lat": 11.9883725
    },
    "description": "Learn about the museum.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-museum-visit",
            "label": "Learn about the museum",
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
    "note": "Mapped OSM feature point; not a surveyed entrance."
  },
  {
    "id": "dala-hill",
    "name": "Dala Hill",
    "district": "Dala, Kano metropolis",
    "kind": "walk",
    "category": "fun",
    "icon": "walk",
    "point": {
      "lon": 8.5069739,
      "lat": 12.0093051
    },
    "description": "View Dala Hill.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-dala-hill-visit",
            "label": "View Dala Hill",
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
    "note": "Mapped OSM feature point; not a surveyed entrance."
  },
  {
    "id": "goron-dutse",
    "name": "Goron Dutse Hill",
    "district": "Gwale, Kano metropolis",
    "kind": "walk",
    "category": "fun",
    "icon": "walk",
    "point": {
      "lon": 8.4944515,
      "lat": 12.001466
    },
    "description": "View Goron Dutse.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-goron-dutse-visit",
            "label": "View Goron Dutse",
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
    "note": "Mapped OSM feature point; not a surveyed entrance."
  },
  {
    "id": "kofar-nassarawa",
    "name": "Kofar Nassarawa",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "walk",
    "category": "fun",
    "icon": "walk",
    "point": {
      "lon": 8.5306777,
      "lat": 11.9908895
    },
    "description": "Learn about the gate.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-kofar-nassarawa-visit",
            "label": "Learn about the gate",
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
    "note": "Mapped OSM feature point; not a surveyed entrance."
  },
  {
    "id": "kofar-mata",
    "name": "Kofar Mata",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "walk",
    "category": "fun",
    "icon": "walk",
    "point": {
      "lon": 8.5263759,
      "lat": 12.0008285
    },
    "description": "Learn about Kofar Mata.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-kofar-mata-visit",
            "label": "Learn about Kofar Mata",
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
    "note": "Mapped OSM feature point; not a surveyed entrance."
  },
  {
    "id": "kofar-kabuga",
    "name": "Kofar Kabuga — Historic Site",
    "district": "Gwale, Kano metropolis",
    "kind": "walk",
    "category": "fun",
    "icon": "walk",
    "point": {
      "lon": 8.4814435,
      "lat": 11.9873961
    },
    "description": "Learn about the historic gate site.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-kofar-kabuga-visit",
            "label": "Learn about the historic gate site",
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
    "note": "OSM maps this historic gate reference as demolished in 2014 for an underpass; no intact ancient gate is claimed."
  },
  {
    "id": "kwari-market",
    "name": "Kantin Kwari Textile Market",
    "district": "Fagge, Kano metropolis",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 8.53087,
      "lat": 12.00404
    },
    "description": "Compare textiles at Kwari.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-kwari-market-visit",
            "label": "Compare textiles at Kwari",
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
    "note": "2023 study sampling-location reference; not a surveyed market gate."
  },
  {
    "id": "sabon-market",
    "name": "Sabon Gari Market",
    "district": "Fagge, Kano metropolis",
    "kind": "market",
    "category": "work",
    "icon": "market",
    "point": {
      "lon": 8.53784,
      "lat": 12.01314
    },
    "description": "Browse Sabon Gari Market.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-sabon-market-visit",
            "label": "Browse Sabon Gari Market",
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
    "note": "2023 study sampling-location reference; not a surveyed market gate."
  },
  {
    "id": "buk-old",
    "name": "Bayero University — Old Campus",
    "district": "Gwale, Kano metropolis",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 8.4782432,
      "lat": 11.9807581
    },
    "description": "Join a teaching workshop.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-buk-old-visit",
            "label": "Join a teaching workshop",
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
    "note": "Mapped feature centroid; not a surveyed entrance."
  },
  {
    "id": "buk-new",
    "name": "Bayero University — New Campus",
    "district": "Ungogo, Kano metropolis",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 8.4251222,
      "lat": 11.9704448
    },
    "description": "Join a coding workshop.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-buk-new-visit",
            "label": "Join a coding workshop",
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
    "note": "Mapped feature centroid; not a surveyed entrance."
  },
  {
    "id": "stadium",
    "name": "Sani Abacha Stadium",
    "district": "Kano Municipal, Kano metropolis",
    "kind": "viewing",
    "category": "fun",
    "icon": "viewing",
    "point": {
      "lon": 8.5292741,
      "lat": 11.9996585
    },
    "description": "Watch a beta stadium programme.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-stadium-visit",
            "label": "Watch a beta stadium programme",
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
    "note": "Mapped feature centroid; not a surveyed entrance."
  },
  {
    "id": "racecourse",
    "name": "Kano Racecourse",
    "district": "Nassarawa, Kano metropolis",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 8.5538047,
      "lat": 11.9974416
    },
    "description": "Learn about the racecourse.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-racecourse-visit",
            "label": "Learn about the racecourse",
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
    "note": "Mapped feature centroid; not a surveyed entrance."
  },
  {
    "id": "polo-ground",
    "name": "Kano Polo Ground",
    "district": "Nassarawa, Kano metropolis",
    "kind": "gym",
    "category": "fun",
    "icon": "gym",
    "point": {
      "lon": 8.5492967,
      "lat": 12.0215466
    },
    "description": "Join a beta fitness session.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-polo-ground-visit",
            "label": "Join a beta fitness session",
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
    "note": "Mapped feature centroid; not a surveyed entrance."
  },
  {
    "id": "airport",
    "name": "Mallam Aminu Kano International Airport",
    "district": "Fagge, Kano metropolis",
    "kind": "airport",
    "category": "civic",
    "icon": "airport",
    "point": {
      "lon": 8.5210497,
      "lat": 12.0457085
    },
    "description": "Read flight options.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-airport-visit",
            "label": "Read flight options",
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
    "note": "Mapped feature centroid; not a surveyed entrance."
  },
  {
    "id": "railway-station",
    "name": "Kano Railway Station",
    "district": "Fagge, Kano metropolis",
    "kind": "hub",
    "category": "civic",
    "icon": "hub",
    "point": {
      "lon": 8.5394241,
      "lat": 11.9994967
    },
    "description": "Learn about the station or start a fictional beta Tiga countryside outing that returns to this forecourt.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-railway-station-visit",
            "label": "Learn about the station",
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
          },
          {
            "id": "kano-tiga-outing",
            "label": "Simulated Tiga countryside outing",
            "icon": "bus",
            "duration": 90,
            "cost": 1500,
            "chargeOn": "start",
            "refundOnCancel": false,
            "cancellable": true,
            "effects": {
              "fun": 16,
              "social": 6,
              "energy": -4,
              "hunger": -6
            },
            "tags": [
              "culture",
              "outdoors"
            ],
            "cooldown": 600,
            "beta": true,
            "note": "Fictional beta hosted outing starting and returning at the station forecourt. No actual operator, dam admission, rock visit or remote destination is claimed. The fare is charged at departure and is not refunded on cancellation."
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
    "note": "Mapped OSM feature point; not a surveyed entrance."
  },
  {
    "id": "road-hub",
    "name": "Kano Road Transport Hub",
    "district": "Gama, Nassarawa",
    "kind": "hub",
    "category": "civic",
    "icon": "hub",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Read future road options.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-road-hub-visit",
            "label": "Read future road options",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "nassarawa-clinic",
    "name": "Gama Community Clinic",
    "district": "Gama, Nassarawa",
    "kind": "hospital",
    "category": "civic",
    "icon": "hospital",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Get a check-up.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": null,
    "beta": true,
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "nassarawa-kitchen",
    "name": "Gama Tuwo and Masa Kitchen",
    "district": "Gama, Nassarawa",
    "kind": "buka",
    "category": "food",
    "icon": "buka",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Eat tuwo shinkafa and masa.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-tuwo-meal",
            "label": "Eat tuwo shinkafa and masa",
            "icon": "book",
            "duration": 8,
            "cost": 700,
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "nassarawa-salon",
    "name": "Gama Neighbourhood Salon",
    "district": "Gama, Nassarawa",
    "kind": "salon",
    "category": "work",
    "icon": "salon",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Get a haircut.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-nassarawa-salon-visit",
            "label": "Get a haircut",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "nassarawa-savings",
    "name": "Gama Savings Hall",
    "district": "Gama, Nassarawa",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Learn everyday budgeting.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-nassarawa-savings-visit",
            "label": "Learn everyday budgeting",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "tea-garden",
    "name": "Sabon Gari Tea and Suya Garden",
    "district": "Sabon Gari, Fagge",
    "kind": "park",
    "category": "fun",
    "icon": "park",
    "point": {
      "lon": 8.53824,
      "lat": 12.0185
    },
    "description": "Hear an evening music programme.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-evening-programme",
            "label": "Hear an evening music programme",
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
          },
          {
            "id": "kano-suya-meal",
            "label": "Share suya, kilishi and fura da nono",
            "icon": "food",
            "duration": 8,
            "cost": 600,
            "effects": {
              "hunger": 20,
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property.",
    "hours": {
      "open": 16,
      "close": 22
    }
  },
  {
    "id": "film-workshop",
    "name": "Sabon Gari Film Workshop",
    "district": "Sabon Gari, Fagge",
    "kind": "office",
    "category": "work",
    "icon": "office",
    "point": {
      "lon": 8.53824,
      "lat": 12.0185
    },
    "description": "Join a Kannywood storytelling workshop.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-film-workshop-visit",
            "label": "Join a Kannywood storytelling workshop",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "community-house",
    "name": "Kano Community House",
    "district": "Gama, Nassarawa",
    "kind": "statehouse",
    "category": "civic",
    "icon": "statehouse",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Read the game community notices.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-community-house-visit",
            "label": "Read the game community notices",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  },
  {
    "id": "community-polling",
    "name": "Kano Community Polling Room",
    "district": "Gama, Nassarawa",
    "kind": "polling",
    "category": "civic",
    "icon": "polling",
    "point": {
      "lon": 8.55362,
      "lat": 12.0327
    },
    "description": "Read the game voter information.",
    "ambient": [
      "Neighbours and visitors share the day."
    ],
    "spots": [
      {
        "id": "visit",
        "label": "Visitor area",
        "activities": [
          {
            "id": "kano-community-polling-visit",
            "label": "Read the game voter information",
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
    "note": "Fictional beta service at a verified neighbourhood reference; not a surveyed real property."
  }
]
const venues:readonly CityVenueSeed[]=seeds.map(venue=>({...venue,spots:venue.spots ?? hospitalSpots()}))
const base=buildCityContent({...{
  "cityId": "kano",
  "cityName": "Kano",
  "localUnitDescriptions": {
    "kano-municipal": "The old-city civic and market heart.",
    "dala": "Dala Hill and surrounding old-city neighbourhoods.",
    "fagge": "Sabon Gari, markets and northern urban neighbourhoods.",
    "gwale": "Western neighbourhoods and the Old Campus corridor.",
    "nassarawa": "Gama, Hotoro and eastern urban neighbourhoods.",
    "tarauni": "Southern metropolitan neighbourhoods and markets.",
    "kumbotso": "The southern urban and industrial approach.",
    "ungogo": "Northern and western communities, including the New Campus approach."
  },
  "people": [
    {
      "name": "Amina Bello",
      "role": "Garden caretaker",
      "quotes": [
        "Sannu. The ayo board is ready for another neighbour.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Sani Ibrahim",
      "role": "Morning walker",
      "quotes": [
        "A little time in the garden helps me start the day.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Fatima Musa",
      "role": "Heritage learner",
      "quotes": [
        "I am learning the story of the palace from outside.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Kabiru Ali",
      "role": "City visitor",
      "quotes": [
        "We can appreciate the gateway without entering private spaces.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Zainab Yusuf",
      "role": "Visitor helper",
      "quotes": [
        "Ask about visiting etiquette before entering prayer spaces.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Usman Garba",
      "role": "Architecture learner",
      "quotes": [
        "I am studying the building from the visitor area.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Hadiza Abdullahi",
      "role": "Leather craft learner",
      "quotes": [
        "I am learning how a maker finishes a leather piece.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Ibrahim Sani",
      "role": "Market shopper",
      "quotes": [
        "I compare a few prices before choosing what to buy.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Hauwa Salisu",
      "role": "Dyeing learner",
      "quotes": [
        "I am learning the stages of working with indigo.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Abubakar Lawal",
      "role": "Textile maker",
      "quotes": [
        "Take time to look at the colour before choosing a cloth.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Maryam Hassan",
      "role": "Museum visitor",
      "quotes": [
        "I came to learn more about the city’s history.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Musa Danjuma",
      "role": "History student",
      "quotes": [
        "One object can open a long conversation about the past.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Rukayya Umar",
      "role": "Hill visitor",
      "quotes": [
        "The hill helps me understand the shape of the old city.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Yusuf Mohammed",
      "role": "Sketching student",
      "quotes": [
        "I am drawing the skyline from a respectful viewing spot.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Aisha Sule",
      "role": "Neighbourhood walker",
      "quotes": [
        "The hill is part of the landscape I grew up around.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Aliyu Idris",
      "role": "Landscape learner",
      "quotes": [
        "I enjoy comparing the shapes of the city’s hills.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Binta Yakubu",
      "role": "Gate visitor",
      "quotes": [
        "I like learning how this entrance fits the old city.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Bashir Suleiman",
      "role": "Heritage student",
      "quotes": [
        "A gateway is a good place to begin a history walk.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Halima Usman",
      "role": "City walker",
      "quotes": [
        "The dyeing heritage is close to this old-city approach.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Ismail Adamu",
      "role": "Textile student",
      "quotes": [
        "I came to connect the craft story with its neighbourhood.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Safiya Aminu",
      "role": "History learner",
      "quotes": [
        "This is a historic gate reference beside a changed road approach.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Nura Ibrahim",
      "role": "Neighbourhood visitor",
      "quotes": [
        "We should read the source note before imagining an intact old gate.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Jamila Bello",
      "role": "Textile trader",
      "quotes": [
        "Feel the cloth and compare the weave before you choose.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Ishaq Umar",
      "role": "Tailoring learner",
      "quotes": [
        "I am looking for material for my next practice piece.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Rabi Sani",
      "role": "Produce seller",
      "quotes": [
        "Take a look at the baskets and tell me what you need.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Mohammed Musa",
      "role": "Market neighbour",
      "quotes": [
        "A shopping trip usually includes meeting a friend here.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Zuwaira Ali",
      "role": "Teaching student",
      "quotes": [
        "I practise explaining one idea clearly before a lesson.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Abdullahi Garba",
      "role": "Campus learner",
      "quotes": [
        "Working with classmates helps me understand the course.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Nasiba Yusuf",
      "role": "Coding student",
      "quotes": [
        "Let us build one small project and understand it well.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Suleiman Hassan",
      "role": "Research learner",
      "quotes": [
        "Good questions make a workshop more useful for everyone.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Khadija Lawal",
      "role": "Football supporter",
      "quotes": [
        "I came to enjoy the match with other supporters.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Aminu Ibrahim",
      "role": "Sports announcer",
      "quotes": [
        "I practise telling the story of the game clearly.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Rahma Salisu",
      "role": "Sport visitor",
      "quotes": [
        "I enjoy learning how the programme is organised.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Bello Yakubu",
      "role": "Event learner",
      "quotes": [
        "We prepare the visitor space before a community event.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Hajara Umar",
      "role": "Training partner",
      "quotes": [
        "We begin with a gentle warm-up and a clear plan.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Salisu Danjuma",
      "role": "Polo learner",
      "quotes": [
        "I like learning the rules before watching a match.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Maimuna Idris",
      "role": "Air traveller",
      "quotes": [
        "I check the destination before I join the queue.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Habib Mohammed",
      "role": "Terminal helper",
      "quotes": [
        "The information board is a good place to start.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Asma Abubakar",
      "role": "Rail visitor",
      "quotes": [
        "The longer rail journeys remain coming in this game.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Umar Farouk",
      "role": "Transport learner",
      "quotes": [
        "I am learning how the station connects with the city.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Sadiya Musa",
      "role": "Route helper",
      "quotes": [
        "Long-distance bus journeys are still coming here.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Ibrahim Dangana",
      "role": "Waiting traveller",
      "quotes": [
        "I read the route information before making plans.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Nafisa Sule",
      "role": "Clinic volunteer",
      "quotes": [
        "The free clinic queue is open when you need care.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Adam Abdullahi",
      "role": "Nursing learner",
      "quotes": [
        "I can help you find the outpatient room.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Lubabatu Sani",
      "role": "Kitchen cook",
      "quotes": [
        "The tuwo and masa are ready for a shared meal.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Mustapha Hassan",
      "role": "Food neighbour",
      "quotes": [
        "I enjoy a warm plate and an unhurried conversation.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Hafsatu Garba",
      "role": "Hair stylist",
      "quotes": [
        "Tell me how you would like your hair today.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Muktar Ali",
      "role": "Salon neighbour",
      "quotes": [
        "I came for a trim and stayed to greet a friend.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Bilqis Aminu",
      "role": "Savings adviser",
      "quotes": [
        "Keeping a simple record makes a budget easier to follow.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Imran Yusuf",
      "role": "Finance learner",
      "quotes": [
        "I am practising how to read an account ledger.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Nkechi Okafor",
      "role": "Tea host",
      "quotes": [
        "The tea is ready and the evening programme starts soon.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Samuel Audu",
      "role": "Programme sound learner",
      "quotes": [
        "I check the sound before the first performance.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Tosin Adeyemi",
      "role": "Film learner",
      "quotes": [
        "I am practising how to tell a story in a short scene.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Bassey Ekanem",
      "role": "Production student",
      "quotes": [
        "We listen to each person’s idea before filming.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Grace Luka",
      "role": "Community organiser",
      "quotes": [
        "I follow the decisions that affect our game neighbourhoods.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Terseer Ior",
      "role": "Information volunteer",
      "quotes": [
        "We can read the community notices together.",
        "Welcome. I am glad you stopped to talk."
      ]
    },
    {
      "name": "Zainabu Mohammed",
      "role": "Ballot helper",
      "quotes": [
        "Read the game candidates before casting your vote.",
        "Sannu. There is room for another friendly conversation."
      ]
    },
    {
      "name": "Haruna Sule",
      "role": "Community voter",
      "quotes": [
        "I want to understand the choices before voting.",
        "Welcome. I am glad you stopped to talk."
      ]
    }
  ],
  "careerVenues": {
    "community-helper": "nassarawa-garden",
    "tech": "buk-new",
    "banking": "nassarawa-savings",
    "music": "tea-garden",
    "trading": "kurmi-market",
    "nursing": "nassarawa-clinic",
    "hair": "nassarawa-salon",
    "chef": "nassarawa-kitchen",
    "dj": "tea-garden",
    "fitness": "polo-ground",
    "creator": "film-workshop",
    "teaching": "buk-old",
    "event": "racecourse",
    "football": "stadium",
    "retail": "kwari-market"
  },
  "careerSummaries": {
    "dj": "Prepare sound and music for a beta community programme at the tea garden.",
    "music": "Build a music career through the beta evening community programme.",
    "event": "Organise beta visitor and community programmes at the racecourse.",
    "creator": "Practise film and media storytelling in the beta workshop."
  },
  "houses": [
    {
      "id": "kano-kano-municipal-home",
      "label": "Neighbourhood flat",
      "districtId": "kano-municipal",
      "district": "Gidan Sarkin Kano neighbourhood",
      "rent": 6500,
      "grid": 8,
      "point": {
        "lon": 8.51868,
        "lat": 11.992
      }
    },
    {
      "id": "kano-dala-home",
      "label": "Neighbourhood flat",
      "districtId": "dala",
      "district": "Dala",
      "rent": 6500,
      "grid": 8,
      "point": {
        "lon": 8.50732,
        "lat": 12.0071
      }
    },
    {
      "id": "kano-fagge-home",
      "label": "Neighbourhood flat",
      "districtId": "fagge",
      "district": "Fagge",
      "rent": 6500,
      "grid": 8,
      "point": {
        "lon": 8.5291548,
        "lat": 12.0066969
      }
    },
    {
      "id": "kano-gwale-home",
      "label": "Neighbourhood flat",
      "districtId": "gwale",
      "district": "Gwale Rinji",
      "rent": 6500,
      "grid": 8,
      "point": {
        "lon": 8.49982,
        "lat": 11.9645
      }
    },
    {
      "id": "kano-nassarawa-home",
      "label": "Neighbourhood flat",
      "districtId": "nassarawa",
      "district": "Gama, Nassarawa",
      "rent": 6500,
      "grid": 8,
      "point": {
        "lon": 8.55362,
        "lat": 12.0327
      }
    },
    {
      "id": "kano-tarauni-home",
      "label": "Neighbourhood flat",
      "districtId": "tarauni",
      "district": "Tarauni",
      "rent": 6500,
      "grid": 8,
      "point": {
        "lon": 8.56014,
        "lat": 11.9767
      }
    },
    {
      "id": "kano-kumbotso-home",
      "label": "Neighbourhood flat",
      "districtId": "kumbotso",
      "district": "Chalawa, Kumbotso",
      "rent": 5000,
      "grid": 8,
      "point": {
        "lon": 8.421733,
        "lat": 11.906853
      }
    },
    {
      "id": "kano-ungogo-home",
      "label": "Neighbourhood flat",
      "districtId": "ungogo",
      "district": "Ungogo Arewa",
      "rent": 5000,
      "grid": 8,
      "point": {
        "lon": 8.49534,
        "lat": 12.0916
      }
    }
  ],
  "events": [
    {
      "id": "kano-durbar",
      "title": "Sallah Durbar — beta game edition",
      "blurb": "A fictional heritage programme about the Durbar procession, horses and crafts; these game dates are not an official Sallah schedule.",
      "venue": "racecourse",
      "icon": "star",
      "when": {
        "start": "2027-03-11",
        "end": "2027-03-14",
        "from": 10,
        "to": 18
      },
      "spray": true
    }
  ],
  "firstFun": {
    "venue": "nassarawa-garden",
    "spot": "visit",
    "activity": "kano-play-ayo",
    "title": "Play ayo in Gama",
    "hint": "Gama Community Garden · 7 seconds"
  },
  "buka": "nassarawa-kitchen",
  "thingsToDo": [
    {
      "venueId": "kurmi-market",
      "name": "Kurmi Market",
      "line": "Compare prices at Kurmi."
    },
    {
      "venueId": "dye-pits",
      "name": "Kofar Mata Dye Pits",
      "line": "Learn indigo dyeing."
    },
    {
      "venueId": "museum",
      "name": "Gidan Makama Museum",
      "line": "Learn about the museum."
    },
    {
      "venueId": "dala-hill",
      "name": "Dala Hill",
      "line": "View Dala Hill."
    },
    {
      "venueId": "buk-new",
      "name": "Bayero University — New Campus",
      "line": "Join a coding workshop."
    },
    {
      "venueId": "tea-garden",
      "name": "Sabon Gari Tea and Suya Garden",
      "line": "Hear an evening music programme."
    }
  ],
  "culture": {
    "greeting": "Sannu — hello",
    "food": [
      "tuwo shinkafa",
      "masa",
      "suya",
      "kilishi",
      "fura da nono"
    ],
    "knownFor": [
      "Hausa language and culture",
      "Durbar horse processions and craft heritage",
      "indigo dyeing and leatherwork",
      "Kannywood storytelling",
      "hot dry weather and seasonal harmattan dust"
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
      "id": "keke",
      "label": "Yellow Adaidaita sahu",
      "icon": "🛺",
      "fare": 200,
      "seconds": 8,
      "needs": {
        "hygiene": -1
      },
      "eventChance": 0.18,
      "blurb": "Beta neighbourhood game trips within one declared zone; no citywide legal route is implied.",
      "beta": true
    },
    {
      "id": "danfo",
      "label": "Bus",
      "icon": "🚌",
      "fare": 250,
      "seconds": 9,
      "needs": {},
      "eventChance": 0.2,
      "blurb": "Shared buses across the metropolis in the beta game.",
      "beta": true
    }
  ],
  "radioVenueIds": [
    "tea-garden"
  ],
  "billboardRoads": [
    {
      "id": "kano-bb-zaria",
      "near": "road-hub",
      "road": "Zaria Road"
    },
    {
      "id": "kano-bb-murtala",
      "near": "railway-station",
      "road": "Murtala Mohammed Way"
    },
    {
      "id": "kano-bb-gwarzo",
      "near": "buk-old",
      "road": "Kano–Gwarzo Road"
    }
  ],
  "tablePlaces": [
    {
      "id": "kano-garden-whot",
      "venueId": "nassarawa-garden",
      "game": "whot",
      "label": "Gama garden table",
      "seats": 4
    },
    {
      "id": "kano-stadium-penalty",
      "venueId": "stadium",
      "game": "penalty",
      "label": "Stadium penalty spot",
      "seats": 2
    }
  ],
  "dreamWording": {
    "lekki-landlord": {
      "label": "Kano Landlord",
      "goal": "Build a net worth of ₦1,000,000.",
      "measure": "Your cash plus what you have bought, minus loan debt, counts toward ₦1,000,000."
    },
    "afrobeats-star": {
      "label": "Kano Music Headliner",
      "goal": "Reach Music level 10.",
      "measure": "Your Music level, including partial levels, counts toward level 10."
    },
    "yaba-unicorn": {
      "label": "Kano Founder"
    }
  },
  "lotteryWording": {}
},origin:KANO_MAP_ORIGIN,bounds:KANO_PLAY_BOUNDS,venues})
export const KANO_CONTENT=Object.freeze({...base,workplaces:base.workplaces.map(workplace=>{const job=workplace.definition;return job.id==='dj'&&job.track?{...workplace,definition:{...job,ladder:job.ladder.map(rung=>({...rung,role:rung.role==='Club DJ'?'Programme DJ':rung.role}))}}:workplace}),localModeZones:[
  {
    "mode": "keke",
    "venueIds": [
      "palace",
      "central-mosque",
      "kurmi-market",
      "dye-pits",
      "museum",
      "dala-hill",
      "goron-dutse",
      "kofar-nassarawa",
      "kofar-mata",
      "kofar-kabuga"
    ],
    "rentedHomeIds": [
      "kano-kano-municipal-home",
      "kano-dala-home"
    ],
    "ownedHomeUnitIds": [
      "kano-municipal",
      "dala"
    ]
  },
  {
    "mode": "keke",
    "venueIds": [
      "nassarawa-garden",
      "nassarawa-clinic",
      "nassarawa-kitchen",
      "nassarawa-salon",
      "nassarawa-savings",
      "road-hub",
      "community-house",
      "community-polling"
    ],
    "rentedHomeIds": [
      "kano-nassarawa-home"
    ],
    "ownedHomeUnitIds": [
      "nassarawa"
    ]
  },
  {
    "mode": "keke",
    "venueIds": [
      "sabon-market",
      "tea-garden",
      "film-workshop"
    ],
    "rentedHomeIds": [
      "kano-fagge-home"
    ],
    "ownedHomeUnitIds": [
      "fagge"
    ]
  }
] as const})
