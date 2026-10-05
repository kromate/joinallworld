import type {CityLink} from '../../../types/content.ts'
export const KANO_LINKS=Object.freeze({
  "lagosAir": {
    "a": "lagos",
    "b": "kano",
    "mode": "air",
    "beta": true,
    "label": "Flight between Lagos and Kano",
    "icon": "✈️",
    "fare": 85000,
    "seconds": 110,
    "km": 834
  },
  "lagosRoad": {
    "a": "lagos",
    "b": "kano",
    "mode": "road",
    "status": "coming",
    "beta": true,
    "label": "Bus between Lagos and Kano — coming",
    "icon": "🚌",
    "fare": 20000,
    "seconds": 480,
    "km": 1100
  },
  "lagosRail": {
    "a": "lagos",
    "b": "kano",
    "mode": "rail",
    "status": "coming",
    "beta": true,
    "label": "Rail between Lagos and Kano — coming",
    "icon": "🚆",
    "fare": 16000,
    "seconds": 420,
    "km": 1100
  },
  "abujaAir": {
    "a": "abuja",
    "b": "kano",
    "mode": "air",
    "beta": true,
    "label": "Flight between Abuja and Kano",
    "icon": "✈️",
    "fare": 45000,
    "seconds": 70,
    "km": 364
  },
  "abujaRoad": {
    "a": "abuja",
    "b": "kano",
    "mode": "road",
    "status": "coming",
    "beta": true,
    "label": "Bus between Abuja and Kano — coming",
    "icon": "🚌",
    "fare": 9000,
    "seconds": 240,
    "km": 450
  },
  "abujaRail": {
    "a": "abuja",
    "b": "kano",
    "mode": "rail",
    "status": "coming",
    "beta": true,
    "label": "Rail between Abuja and Kano — coming",
    "icon": "🚆",
    "fare": 8000,
    "seconds": 200,
    "km": 450
  }
} satisfies Readonly<Record<string,CityLink>>)
