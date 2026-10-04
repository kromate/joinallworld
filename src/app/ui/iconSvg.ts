// Any mark by name, as an <svg> string: an interface mark (src/ui/dom.ts), 'chevron-down', or a glyph of the icon set.
import { glyph } from '../../ui/phone/icons.ts'
import { icon as interfaceMark } from '../../ui/dom.ts'

/** Small interface marks that are not part of the app icon set (src/ui/dom.ts). */
const INTERFACE_MARKS: readonly string[] = ['menu', 'eye', 'eye-off', 'chat', 'plus', 'minus', 'fit', 'list']
export const iconSvg = (name: string, className?: string): string => (name === 'chevron-down' ? interfaceMark('chevron') : INTERFACE_MARKS.includes(name) ? interfaceMark(name) : glyph(name, className))
