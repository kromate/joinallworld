// The typed boundary to the game's content tables and the pure home-layout rules that the Vue
// panels read (src/game/content/*.js, src/game/home-layout.js). Every cast is here; a table gets
// real types when its file is converted, and its lines are deleted.
import { MOVE_IN_WEEKS as MOVE_IN_WEEKS_JS, homeOf as homeOfJs } from '../../game/content/housing.ts'
import { CAR_RESALE_RATE as CAR_RESALE_RATE_JS } from '../../game/content/cars.ts'
import { INGREDIENTS as INGREDIENTS_JS, INGREDIENT_ORDER as INGREDIENT_ORDER_JS, RECIPES as RECIPES_JS } from '../../game/content/food.ts'
import { VENUES as VENUE_CONTENT_JS } from '../../game/content/venues.ts'
import { DREAMS as DREAMS_JS, START_HOMES as START_HOMES_JS, TRAITS as TRAITS_JS } from '../../game/content/traits.ts'
import { CATEGORIES as CATEGORIES_JS, FURNITURE as FURNITURE_JS, KINDS as KINDS_JS, SELL_REFUND_RATE as SELL_REFUND_RATE_JS, STAR_MULTIPLIER as STAR_MULTIPLIER_JS } from '../../game/content/furniture.ts'
import { HOUSE_TIERS as HOUSE_TIERS_JS } from '../../game/content/world.ts'
import { checkPlacement as checkPlacementJs, findFreeSpot as findFreeSpotJs, nudge as nudgeJs, turn as turnJs } from '../../game/home-layout.ts'
import type { FurnitureCategory, FurnitureDefinition, FurnitureKindInfo } from '../../types/content.ts'
import type { LifeState, PlacedItem } from '../../types/life.ts'

// ---- houses, cars, food, health, the profile ------------------------------------------------
export const MOVE_IN_WEEKS = MOVE_IN_WEEKS_JS as unknown as number
export const CAR_RESALE_RATE = CAR_RESALE_RATE_JS as unknown as number

export interface IngredientContent { id: string; label: string; icon: string; price: number; pack: number }
export const INGREDIENTS = INGREDIENTS_JS as unknown as Readonly<Record<string, IngredientContent>>
export const INGREDIENT_ORDER = INGREDIENT_ORDER_JS as unknown as readonly string[]
export const RECIPES = RECIPES_JS as unknown as Readonly<Record<string, { label: string; ingredients: Record<string, number> }>>

export interface ActivityContent { id: string; cost?: number; duration: number }
export interface VenueSpots { spots: Record<string, { activities: ActivityContent[] }> }
/** Every venue with its spots and activities (the Health app prices a cure from the activity that cures). */
export const VENUE_SPOTS = VENUE_CONTENT_JS as unknown as Readonly<Record<string, VenueSpots>>

export interface TraitContent { label: string; icon: string; district?: string }
export const TRAITS = TRAITS_JS as unknown as Readonly<Record<string, TraitContent | undefined>>
export const DREAMS = DREAMS_JS as unknown as Readonly<Record<string, TraitContent | undefined>>
export const START_HOMES = START_HOMES_JS as unknown as Readonly<Record<string, TraitContent | undefined>>

// ---- the room and Buy mode ------------------------------------------------------------------
export const CATEGORIES = CATEGORIES_JS as unknown as readonly FurnitureCategory[]
export const FURNITURE = FURNITURE_JS as unknown as Readonly<Record<string, FurnitureDefinition | undefined>>
export const KINDS = KINDS_JS as unknown as Readonly<Record<string, FurnitureKindInfo | undefined>>
export const SELL_REFUND_RATE = SELL_REFUND_RATE_JS as unknown as number
export const STAR_MULTIPLIER = STAR_MULTIPLIER_JS as unknown as readonly number[]
export interface HomeRoom { id?: string; grid: number; label: string; district: string; owned: boolean }
/** The room the player's furniture is laid out in: the rented tier, or their own house while they live in it. */
export const houseOf = (state: LifeState): HomeRoom => (homeOfJs as unknown as (state: LifeState, designs: unknown) => HomeRoom)(state, HOUSE_TIERS_JS)

export interface Spot { x: number; y: number; rot: number }
export interface Refusal { code: string; reason: string }
/** Why `def` cannot go there, or null. `ignoreId` skips the object being moved. */
export const checkPlacement = checkPlacementJs as unknown as (grid: number, items: readonly PlacedItem[], def: FurnitureDefinition, x: number, y: number, rot: number, ignoreId?: string | null) => Refusal | null
export const findFreeSpot = findFreeSpotJs as unknown as (grid: number, items: readonly PlacedItem[], def: FurnitureDefinition, ignoreId?: string | null) => Spot | null
/** Move a ghost by (dx, dy) tiles, kept inside the room. */
export const nudge = nudgeJs as unknown as (grid: number, def: FurnitureDefinition, at: Spot, dx: number, dy: number) => Spot
/** Quarter-turn a ghost, kept inside the room. */
export const turn = turnJs as unknown as (grid: number, def: FurnitureDefinition, at: Spot) => Spot
