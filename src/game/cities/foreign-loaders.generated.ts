// Generated from the reviewed Africa runtime admission.
import type { CityModuleLoader } from './catalogue.ts'

export const FOREIGN_CITY_LOADERS: Readonly<Record<string, CityModuleLoader>> = Object.freeze({
  "accra": async()=>(await import("./accra/index.ts")).city,
  "algiers": async()=>(await import("./algiers/index.ts")).city,
  "lome": async()=>(await import("./lome/index.ts")).city,
  "nairobi": async()=>(await import("./nairobi/index.ts")).city,
  "yaounde": async()=>(await import("./yaounde/index.ts")).city,
  "abidjan": async()=>(await import("./abidjan/index.ts")).city,
  "addis-ababa": async()=>(await import("./addis-ababa/index.ts")).city,
  "cape-town": async()=>(await import("./cape-town/index.ts")).city,
  "cotonou": async()=>(await import("./cotonou/index.ts")).city,
  "dakar": async()=>(await import("./dakar/index.ts")).city,
  "cairo": async()=>(await import("./cairo/index.ts")).city,
  "rabat": async()=>(await import("./rabat/index.ts")).city,
  "kigali": async()=>(await import("./kigali/index.ts")).city,
  "kampala": async()=>(await import("./kampala/index.ts")).city,
  "lusaka": async()=>(await import("./lusaka/index.ts")).city,
})
