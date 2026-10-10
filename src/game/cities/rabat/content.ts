import { buildDestinationContent } from '../africa/contentBuilder.ts'
import { FACTS } from './facts.ts'
import { PLACES } from './places.ts'
export const CONTENT = buildDestinationContent(FACTS, PLACES)
