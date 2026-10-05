import { FURNITURE as RULES } from './furniture.ts'
import type { FurnitureDefinition, FurniturePresentation } from '../../types/content.ts'
import type { FurnitureId } from '../../types/life.ts'

export const FURNITURE_PRESENTATION: Readonly<Record<FurnitureId, FurniturePresentation>> = Object.freeze({
  "aquarium": {
    "shape": "aquarium",
    "color": "#4fa3c9",
    "blurb": "Tiny fish, big calm."
  },
  "basin": {
    "shape": "basin",
    "color": "#c9574f",
    "blurb": "For laundry day and nothing else."
  },
  "bathtub": {
    "shape": "tub",
    "color": "#f1f1ec",
    "blurb": "Bubbles, a long soak and nobody knocking."
  },
  "bean-bag": {
    "shape": "beanbag",
    "color": "#d0672f",
    "blurb": "Sink in, struggle to stand up."
  },
  "bookshelf": {
    "shape": "shelf",
    "color": "#7a5a3c",
    "blurb": "Novels, textbooks and one borrowed dictionary."
  },
  "bucket-bowl": {
    "shape": "bucket",
    "color": "#3f8f6b",
    "blurb": "The shower every Lagosian learned first."
  },
  "camera-tripod": {
    "shape": "tripod",
    "color": "#33363c",
    "blurb": "Golden hour does not wait."
  },
  "centre-rug": {
    "shape": "rug",
    "color": "#a8443c",
    "blurb": "Shoes off, please."
  },
  "chef-range": {
    "shape": "cooker",
    "color": "#9aa3a8",
    "blurb": "Six burners and an oven. The party jollof machine."
  },
  "cooler-box": {
    "shape": "cooler",
    "color": "#3f7fbf",
    "blurb": "Keeps garri, sugar and zobo cool with no light at all."
  },
  "corner-lounge": {
    "shape": "sofa",
    "color": "#6d8a5e",
    "blurb": "Fills a corner and seats the whole match-day crowd."
  },
  "dance-mirror": {
    "shape": "mirror",
    "color": "#b9c9cf",
    "blurb": "Check the legwork before the party does."
  },
  "double-fridge": {
    "shape": "fridge",
    "color": "#b9c2c6",
    "blurb": "A freezer on top and room for a whole pot of soup."
  },
  "family-sofa": {
    "shape": "sofa",
    "color": "#9c7b5a",
    "blurb": "Room for you, your cousin and their cousin."
  },
  "flat-tv": {
    "shape": "tv",
    "color": "#2b2f36",
    "blurb": "Wide enough to see the offside clearly."
  },
  "foam-bed": {
    "shape": "bed",
    "color": "#b98b6a",
    "blurb": "Six inches of foam between you and Monday."
  },
  "fridge": {
    "shape": "fridge",
    "color": "#e4e9ea",
    "blurb": "Cold water on demand, when there is light."
  },
  "game-console": {
    "shape": "console",
    "color": "#30343b",
    "blurb": "One more match. Just one more."
  },
  "gas-cooker": {
    "shape": "cooker",
    "color": "#d9dcd6",
    "blurb": "Blue flame, no smoke, faster stew."
  },
  "generator": {
    "shape": "generator",
    "color": "#c9372c",
    "blurb": "Loud, loyal and never asks the grid for permission."
  },
  "gold-sofa": {
    "shape": "sofa",
    "color": "#c9a227",
    "blurb": "For receiving visitors you want to impress."
  },
  "grey-parrot": {
    "shape": "cage",
    "color": "#8f989c",
    "blurb": "Repeats everything. Mind what you say."
  },
  "gym-mat": {
    "shape": "gymmat",
    "color": "#3f6f9f",
    "blurb": "Push-ups before the sun gets serious."
  },
  "house-cat": {
    "shape": "petbed",
    "color": "#8a8f96",
    "blurb": "Lives here rent-free and knows it."
  },
  "inverter": {
    "shape": "inverter",
    "color": "#d7dbd8",
    "blurb": "Silent light. The neighbours will ask questions."
  },
  "jerry-cans": {
    "shape": "jerrycans",
    "color": "#e3b23c",
    "blurb": "Water today, fuel tomorrow."
  },
  "kerosene-stove": {
    "shape": "stove",
    "color": "#4f7a5a",
    "blurb": "Smoky, patient and never lets jollof down."
  },
  "keyboard": {
    "shape": "keyboard",
    "color": "#2c2c30",
    "blurb": "From choir practice to studio dreams."
  },
  "king-bed": {
    "shape": "bed",
    "color": "#7a4f8a",
    "blurb": "Sleep like the landlord."
  },
  "lantern": {
    "shape": "lantern",
    "color": "#ffe6a8",
    "blurb": "For when the light goes without warning."
  },
  "laptop-desk": {
    "shape": "desk",
    "color": "#8a6b4a",
    "blurb": "A desk, a laptop and a side project."
  },
  "leather-sofa": {
    "shape": "sofa",
    "color": "#5a3a2c",
    "blurb": "Imported leather that squeaks with importance."
  },
  "led-strip": {
    "shape": "strip",
    "color": "#7fd6ff",
    "blurb": "Instant music-video lighting."
  },
  "local-dog": {
    "shape": "petbed",
    "color": "#b07a45",
    "blurb": "Barks at strangers, forgives you everything."
  },
  "lounge-armchair": {
    "shape": "sofa",
    "color": "#4f7f86",
    "blurb": "One seat, zero sharing."
  },
  "ludo-board": {
    "shape": "board",
    "color": "#d8b13a",
    "blurb": "Friendships have ended over this."
  },
  "ortho-bed": {
    "shape": "bed",
    "color": "#6f8f86",
    "blurb": "Firm, quiet and doctor-approved."
  },
  "plastic-chair": {
    "shape": "chair",
    "color": "#e9e6dc",
    "blurb": "Every party, every compound, every veranda."
  },
  "potted-plant": {
    "shape": "plant",
    "color": "#4f8f5b",
    "blurb": "Green, quiet and hard to kill."
  },
  "practice-mic": {
    "shape": "mic",
    "color": "#44484f",
    "blurb": "Test the jokes on the wall first."
  },
  "radio-stool": {
    "shape": "radio",
    "color": "#b2452f",
    "blurb": "Morning news, evening highlife."
  },
  "shower-cubicle": {
    "shape": "shower",
    "color": "#bfd6dc",
    "blurb": "Water from above. No more scooping."
  },
  "sleeping-mat": {
    "shape": "mat",
    "color": "#c9a45c",
    "blurb": "Roll it out, roll it up. Your back keeps the receipts."
  },
  "small-tv": {
    "shape": "tv",
    "color": "#4a3b30",
    "blurb": "Football, Nollywood and the nine o’clock news."
  },
  "sound-system": {
    "shape": "speaker",
    "color": "#2f3238",
    "blurb": "The neighbours will know your playlist."
  },
  "spring-bed": {
    "shape": "bed",
    "color": "#8fa7c4",
    "blurb": "A real frame and a mattress with opinions."
  },
  "standing-lamp": {
    "shape": "floorlamp",
    "color": "#ffd27a",
    "blurb": "Soft light for a soft evening."
  },
  "toilet": {
    "shape": "toilet",
    "color": "#eeeeea",
    "blurb": "Your own. No queue in the compound."
  },
  "velvet-sofa": {
    "shape": "sofa",
    "color": "#7b4b8e",
    "blurb": "Soft enough to lose the remote in."
  },
  "wall-art": {
    "shape": "art",
    "color": "#2f4f8f",
    "blurb": "Indigo patterns that make a wall look decided."
  },
  "wall-calendar": {
    "shape": "calendar",
    "color": "#f4f1e6",
    "blurb": "A gift from the pharmacy down the road."
  },
  "wall-fan": {
    "shape": "fan",
    "color": "#dfe5e2",
    "blurb": "Breeze from a corner nobody was using."
  },
  "wall-lamp": {
    "shape": "lamp",
    "color": "#ffd98a",
    "blurb": "A warm bulb on a bracket."
  },
  "wardrobe": {
    "shape": "wardrobe",
    "color": "#6b4f3a",
    "blurb": "The clothes finally leave the chair."
  },
  "water-drum": {
    "shape": "drum",
    "color": "#3d6fa3",
    "blurb": "Fetch once, use all week."
  },
  "wc-suite": {
    "shape": "toilet",
    "color": "#d8e6ea",
    "blurb": "Quiet lid, strong flush."
  },
  "weight-bench": {
    "shape": "bench",
    "color": "#8f2f2f",
    "blurb": "A proper bench and a bar that means it."
  }
})

export const FURNITURE: Readonly<Record<FurnitureId, FurnitureDefinition & FurniturePresentation>> = Object.freeze(Object.fromEntries(
  Object.values(RULES).map(item => [item.id, { ...item, ...FURNITURE_PRESENTATION[item.id]! }]),
))
