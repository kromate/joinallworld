// What the Groceries app remembers while it is closed: the packs wanted per ingredient.
import { reactive } from 'vue'

export const basket = reactive<Record<string, number>>({})
