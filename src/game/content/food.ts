/**
 * OWNER: home
 * Groceries (items, prices, pack sizes) and recipes. Ingredients are inventory items; recipes
 * are activities that use them. Grocery prices live here too — there is no separate groceries file.
 *
 * INGREDIENTS[id] = { id, label, icon, start, price, pack, beta? }
 *   id     the inventory item id (state.inventory[id])
 *   start  how many a new kitchen holds
 *   price  naira for one pack of `pack` units — original beta value
 * RECIPES[id] = { id, label, icon, station, duration, ingredients, effects, xp?, requiresSkill?, moodlets?, beta?, note }
 *   station      'cooler' or 'stove' — which kitchen object prepares it
 *   duration     seconds — fixed unless the recipe is `beta`
 *   ingredients  { ingredientId: count } used when the meal is finished
 *
 * Provenance: the recipe list, their stations, durations and skill locks are fixed. Need
 * amounts, XP and moodlets are original beta values. `betaIngredients` lists ingredients a
 * recipe uses that are provisional; a recipe with `beta: true` is entirely provisional. Ingredient names are
 * original and generic.
 *
 * ORIGINAL RULE — interruptions never cost food: ingredients are taken when the meal is
 * finished, together with its effects. Cancelling, or closing the game mid-cook, uses nothing.
 */
import type { ItemId } from '../../types/life.ts'
import type { IngredientDefinition, RecipeDefinition } from '../../types/content.ts'

export const INGREDIENTS: Record<ItemId, IngredientDefinition> = {
  rice: { id: 'rice', label: 'Long-grain Rice', icon: '🍚', start: 2, price: 600, pack: 3 },
  'tomato-paste': { id: 'tomato-paste', label: 'Tomato Paste', icon: '🥫', start: 2, price: 300, pack: 3 },
  seasoning: { id: 'seasoning', label: 'Seasoning Cubes', icon: '🧂', start: 6, price: 200, pack: 10 },
  'veg-oil': { id: 'veg-oil', label: 'Vegetable Oil', icon: '🫗', start: 4, price: 800, pack: 8 },
  garri: { id: 'garri', label: 'Yellow Garri', icon: '🥣', start: 4, price: 400, pack: 5 },
  sugar: { id: 'sugar', label: 'Cube Sugar', icon: '🧊', start: 5, price: 300, pack: 6 },
  noodles: { id: 'noodles', label: 'Instant Noodles', icon: '🍜', start: 3, price: 450, pack: 3 },
  eggs: { id: 'eggs', label: 'Eggs', icon: '🥚', start: 6, price: 900, pack: 6 },
  bread: { id: 'bread', label: 'Soft Bread Loaf', icon: '🍞', start: 2, price: 500, pack: 1 },
  zobo: { id: 'zobo', label: 'Zobo', icon: '🧃', start: 1, price: 250, pack: 1 },
  plantain: { id: 'plantain', label: 'Plantain', icon: '🍌', start: 2, price: 500, pack: 2 },
  egusi: { id: 'egusi', label: 'Ground Egusi', icon: '🌰', start: 0, price: 800, pack: 2 },
  'palm-oil': { id: 'palm-oil', label: 'Palm Oil', icon: '🛢️', start: 0, price: 600, pack: 4 },
  spinach: { id: 'spinach', label: 'Efo Tete (spinach)', icon: '🥬', start: 0, price: 250, pack: 1 },
  mackerel: { id: 'mackerel', label: 'Mackerel', icon: '🐟', start: 0, price: 1200, pack: 1 },
  chicken: { id: 'chicken', label: 'Frozen Chicken', icon: '🍗', start: 0, price: 2000, pack: 1 },
  'smoked-fish': { id: 'smoked-fish', label: 'Smoked Fish', icon: '🐠', start: 0, price: 900, pack: 1 },
  semolina: { id: 'semolina', label: 'Semolina', icon: '🌾', start: 0, price: 600, pack: 3, beta: true },
};

export const INGREDIENT_ORDER = Object.keys(INGREDIENTS);

/** Most packs of one ingredient in a single order. */
export const MAX_PACKS_PER_ORDER = 20;

const amounts = 'Station, duration and skill lock are fixed; need amounts and XP are original beta values.';

export const RECIPES: Record<string, RecipeDefinition> = {
  'soak-garri': {
    id: 'soak-garri', label: 'Soak Garri & Sugar', icon: '🥣', station: 'cooler', duration: 5,
    ingredients: { garri: 1, sugar: 1 }, effects: { hunger: 35 }, note: amounts,
  },
  'drink-zobo': {
    id: 'drink-zobo', label: 'Drink Zobo', icon: '🧃', station: 'cooler', duration: 5,
    ingredients: { zobo: 1 }, effects: { hunger: 8, fun: 10 }, note: amounts,
  },
  'cook-jollof': {
    id: 'cook-jollof', label: 'Cook Jollof', icon: '🍛', station: 'stove', duration: 11,
    ingredients: { rice: 1, 'tomato-paste': 1, seasoning: 1, 'veg-oil': 1 }, effects: { hunger: 45 }, xp: { cooking: 100 },
    moodlets: [{ id: 'home-jollof', label: 'Home Jollof', value: 4, duration: 600 }], note: amounts,
  },
  'noodles-egg': {
    id: 'noodles-egg', label: 'Noodles & Egg', icon: '🍜', station: 'stove', duration: 6,
    ingredients: { noodles: 1, eggs: 1 }, effects: { hunger: 30, fun: 5 }, xp: { cooking: 50 }, note: amounts,
  },
  'fry-dodo': {
    id: 'fry-dodo', label: 'Fry Dodo', icon: '🍌', station: 'stove', duration: 7,
    ingredients: { plantain: 1, 'veg-oil': 1 }, effects: { hunger: 25, fun: 8 }, xp: { cooking: 60 }, note: amounts,
  },
  'egusi-eba': {
    id: 'egusi-eba', label: 'Egusi Soup & Eba', icon: '🍲', station: 'stove', duration: 12, requiresSkill: { id: 'cooking', level: 2 },
    ingredients: { egusi: 1, 'palm-oil': 1, garri: 1 }, betaIngredients: ['garri'], effects: { hunger: 60, fun: 5 }, xp: { cooking: 140 },
    moodlets: [{ id: 'proper-swallow', label: 'Proper Swallow', value: 5, duration: 900 }], note: amounts,
  },
  'efo-semo': {
    id: 'efo-semo', label: 'Efo Riro & Semo', icon: '🥬', station: 'stove', duration: 12, requiresSkill: { id: 'cooking', level: 2 },
    ingredients: { spinach: 1, 'palm-oil': 1, semolina: 1 }, betaIngredients: ['semolina'], effects: { hunger: 60, fun: 5 }, xp: { cooking: 140 },
    moodlets: [{ id: 'proper-swallow', label: 'Proper Swallow', value: 5, duration: 900 }], note: amounts,
  },
  'mackerel-stew': {
    id: 'mackerel-stew', label: 'Mackerel Stew & White Rice', icon: '🐟', station: 'stove', duration: 11,
    ingredients: { mackerel: 1, rice: 1, 'tomato-paste': 1 }, betaIngredients: ['tomato-paste'], effects: { hunger: 55, fun: 10 }, xp: { cooking: 120 }, note: amounts,
  },
  'peppered-chicken': {
    id: 'peppered-chicken', label: 'Peppered Chicken', icon: '🍗', station: 'stove', duration: 8,
    ingredients: { chicken: 1 }, effects: { hunger: 45, fun: 15 }, xp: { cooking: 110 },
    moodlets: [{ id: 'sunday-chicken', label: 'Sunday Chicken', value: 6, duration: 900 }], note: amounts,
  },
  'fish-plantain': {
    id: 'fish-plantain', label: 'Smoked Fish & Boiled Plantain', icon: '🐠', station: 'stove', duration: 7,
    ingredients: { 'smoked-fish': 1, plantain: 1 }, effects: { hunger: 45, fun: 5 }, xp: { cooking: 90 }, note: amounts,
  },
  'bread-egg': {
    id: 'bread-egg', label: 'Bread & Fried Egg', icon: '🍞', station: 'stove', duration: 5, beta: true,
    ingredients: { bread: 1, eggs: 1 }, effects: { hunger: 28 }, xp: { cooking: 40 },
    note: 'Original beta recipe: bread is stocked, and this is the only recipe that uses it.',
  },
};

export const RECIPE_ORDER = Object.keys(RECIPES);

/** Kept for the placeholder's export name. */
export const FOOD = { INGREDIENTS, RECIPES };
