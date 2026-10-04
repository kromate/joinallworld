/** OWNER: growth. The one growth glyph the first download needs: the "table here" chip in the HUD (src/ui/panels/tables-chip.js). */
import { F, S, registerGlyphs } from './icons.ts';

registerGlyphs({
  tables: `<rect x="3.5" y="6" width="9" height="13" rx="1.8" ${F} transform="rotate(-8 8 12.5)"/><rect x="11" y="5" width="9" height="13" rx="1.8" ${F} transform="rotate(8 15.5 11.5)"/><path d="M15.5 9.2l1.6 2.6-1.6 2.6-1.6-2.6Z" ${S}/>`,
});
