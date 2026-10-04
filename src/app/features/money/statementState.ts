// What the Statement app remembers while it is closed: the server's last verdict.
import { shallowRef } from 'vue'
import type { Verdict } from './statementModel.ts'

export const checked = shallowRef<Verdict | null>(null)
