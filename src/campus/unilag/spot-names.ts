/**
 * The landmarks of the UNILAG campus, in the order of the layout: their ids and names. The campus venue's spots are made of these
 * (content.ts) and the layout (layout.ts: where each one stands, the zones, the roads) takes its labels from here, so the names exist once and
 * the first page does not carry the geometry.
 */
export const LANDMARKS: readonly (readonly [id: string, label: string])[] = [
  ['main-gate', 'UNILAG Main Gate'],
  ['el-kanemi-hall', 'El-Kanemi Hall'],
  ['eni-njoku-hall', 'Professor Eni Njoku Hall'],
  ['sodeinde-hall', 'Sodeinde Hall'],
  ['makama-hall', 'Makama Bida Hall'],
  ['fagunwa-hall', 'Fagunwa Hall'],
  ['tinubu-hall', 'Madame Tinubu Hall'],
  ['cafeteria', '2001 Café'],
  ['access-bank', 'Access Bank'],
  ['new-hall-shopping', 'New Hall Shopping Complex'],
  ['arts', 'Faculty of Arts'],
  ['law', 'Faculty of Law'],
  ['management', 'Faculty of Management Sciences'],
  ['library', 'University Library'],
  ['senate', 'Senate House'],
  ['auditorium', 'Main Auditorium'],
  ['uba-bank', 'UBA'],
  ['environmental', 'Faculty of Environmental Sciences'],
  ['education-chapel', 'University Chapel'],
  ['central-mosque', 'University Mosque'],
  ['henry-carr-hall', 'Henry Carr Hall'],
  ['wema-bank', 'Wema Bank'],
  ['education', 'Faculty of Education'],
  ['multipurpose-hall', 'Multipurpose Hall'],
  ['social-sciences', 'Faculty of Social Sciences'],
  ['queen-amina-hall', 'Queen Amina Hall'],
  ['kofo-hall', 'Kofo Ademola Hall'],
  ['biobaku-hall', 'Saburi Biobaku Hall'],
  ['sports-centre', 'Sports Centre & Stadium'],
  ['swimming-pool', 'UNILAG Swimming Pool'],
  ['amphitheatre', 'Amphitheatre'],
  ['student-union', 'Student Union Building'],
  ['university-bookshop', 'University Bookshop'],
  ['moremi-hall', 'Moremi Hall'],
  ['medical-centre', 'UNILAG Medical Centre'],
  ['medical-gardens', 'Medical Gardens'],
  ['jaja-hall', 'King Jaja Hall'],
  ['engineering', 'Faculty of Engineering'],
  ['mariere-hall', 'Mariere Hall'],
  ['pharmacy', 'Faculty of Pharmacy'],
  ['science', 'Faculty of Science'],
  ['honours-hall', 'Honours Hall'],
  ['second-gate', 'UNILAG Second Gate'],
  ['dli-building', 'Distance Learning Institute'],
  ['lagoon-front', 'Lagoon Front'],
  ['people', 'Campus people'],
];

const LABELS = new Map<string, string>(LANDMARKS);
/** The name of a landmark; a landmark that is not listed is a mistake in the layout. */
export function landmarkLabel(id: string): string {
  const label = LABELS.get(id);
  if (label === undefined) throw new TypeError(`UNILAG landmark "${id}" is not in spot-names.ts`);
  return label;
}
