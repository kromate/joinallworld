/** City identifiers are extensible; external strings are checked against city catalogues. */
declare const cityId: unique symbol
declare const venueId: unique symbol
declare const lgaId: unique symbol
declare const houseId: unique symbol
export type CityId<Id extends string = string> = Id & { readonly [cityId]?: 'city' }
export type VenueId<City extends string = string> = string & { readonly [venueId]?: City }
export type LgaId<City extends string = string> = string & { readonly [lgaId]?: City }
export type HouseId<City extends string = string> = string & { readonly [houseId]?: City }
