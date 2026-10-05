import type { CityLink } from '../../../types/content.ts'
export const ABUJA_LINKS = Object.freeze({
  "lagosRoad": {
    "a": "lagos",
    "b": "abuja",
    "mode": "road",
    "beta": true,
    "label": "Night bus through Lokoja",
    "icon": "🚌",
    "fare": 14000,
    "seconds": 420,
    "km": 760
  },
  "lagosAir": {
    "a": "lagos",
    "b": "abuja",
    "mode": "air",
    "beta": true,
    "label": "Flight between Lagos and Abuja",
    "icon": "✈️",
    "fare": 65000,
    "seconds": 90,
    "km": 520
  },
  "ibadanRoad": {
    "a": "ibadan",
    "b": "abuja",
    "mode": "road",
    "beta": true,
    "label": "Bus through Ilorin",
    "icon": "🚌",
    "fare": 12000,
    "seconds": 360,
    "km": 640
  },
  "phRoad": {
    "a": "abuja",
    "b": "port-harcourt",
    "mode": "road",
    "beta": true,
    "label": "Bus through Enugu",
    "icon": "🚌",
    "fare": 11000,
    "seconds": 360,
    "km": 600
  },
  "phAir": {
    "a": "abuja",
    "b": "port-harcourt",
    "mode": "air",
    "beta": true,
    "label": "Flight between Abuja and Port Harcourt",
    "icon": "✈️",
    "fare": 55000,
    "seconds": 80,
    "km": 450
  },
  "kadunaRail": {
    "a": "abuja",
    "b": "kaduna",
    "mode": "rail",
    "beta": true,
    "label": "Train between Idu and Kaduna — coming",
    "icon": "🚆",
    "fare": 6000,
    "seconds": 100,
    "km": 186
  }
} satisfies Readonly<Record<string,CityLink>>)
