/**
 * Regional name pools for generated regulars.
 *
 * The pools are editorially reviewed lists of common Nigerian given names and surnames, one per region.
 * They are not source-pinned: they exist so that a generated regular sounds like someone from the city
 * rather than a numbered placeholder. A city that has an authored cast (see `CitySpec.cast`) does not use them.
 */

export type NameRegion = 'efik' | 'ibibio' | 'ijaw' | 'igbo' | 'yoruba' | 'hausa' | 'kanuri' | 'tiv' | 'edo' | 'central'

export interface NamePool {
  readonly male: readonly string[]
  readonly female: readonly string[]
  readonly surnames: readonly string[]
}

export const NAME_POOLS: Readonly<Record<NameRegion, NamePool>> = Object.freeze({
  efik: {
    male: ['Edet', 'Effiong', 'Etim', 'Ekpenyong', 'Okon', 'Bassey', 'Archibong', 'Inyang', 'Ita', 'Efiom', 'Eyo', 'Asuquo', 'Ime', 'Ofonime'],
    female: ['Affiong', 'Ima', 'Mfon', 'Ekaette', 'Idara', 'Nkoyo', 'Iniobong', 'Edikan', 'Ekanem', 'Uduak', 'Atim', 'Imaobong', 'Nse', 'Uyai'],
    surnames: ['Okon', 'Asuquo', 'Bassey', 'Effiong', 'Etim', 'Ekpo', 'Inyang', 'Eyo', 'Edem', 'Ntia', 'Ekong', 'Ita', 'Archibong', 'Udoh', 'Okpo', 'Etuk'],
  },
  ibibio: {
    male: ['Idongesit', 'Ekemini', 'Utibe', 'Imoh', 'Emem', 'Aniekan', 'Nsikak', 'Ubong', 'Akpan', 'Etido', 'Mkpouto', 'Udeme', 'Okon', 'Effiong'],
    female: ['Uduak', 'Mfon', 'Ekaette', 'Iniobong', 'Nkoyo', 'Idara', 'Ememobong', 'Itoro', 'Ifiok', 'Imaobong', 'Atim', 'Nsisong', 'Eno', 'Ofonmbuk'],
    surnames: ['Udoh', 'Akpan', 'Etim', 'Inyang', 'Ekong', 'Okon', 'Umoh', 'Ukpong', 'Essien', 'Bassey', 'Udo', 'Effiong', 'Ibanga', 'Usoro', 'Idiong', 'Ekpe'],
  },
  ijaw: {
    male: ['Tonye', 'Timi', 'Preye', 'Doutimi', 'Ebimo', 'Boma', 'Tarila', 'Ibifuro', 'Perekeme', 'Ebikabowei', 'Seiyefa', 'Ere', 'Tamuno', 'Ebi'],
    female: ['Ebiere', 'Preye', 'Ebiye', 'Tamara', 'Ibiso', 'Tonyeme', 'Dimiebi', 'Ere', 'Ibinabo', 'Tebepah', 'Ebiakpo', 'Nimi', 'Ine', 'Biriyai'],
    surnames: ['Ekiyor', 'Preowei', 'Pere', 'Ikoli', 'Tubonemi', 'Egbe', 'Ere', 'Oweikpodor', 'Biriyai', 'Eferebo', 'Ogoriba', 'Okoko', 'Ebiegberi', 'Perezi', 'Dikio', 'Amgbare'],
  },
  igbo: {
    male: ['Chukwuemeka', 'Obinna', 'Ikenna', 'Emeka', 'Nnamdi', 'Uchenna', 'Chidi', 'Kelechi', 'Ifeanyi', 'Chinedu', 'Onyeka', 'Ugochukwu', 'Tobenna', 'Chibueze'],
    female: ['Chiamaka', 'Ngozi', 'Adaeze', 'Nkechi', 'Ifeoma', 'Amara', 'Chidinma', 'Nneka', 'Ujunwa', 'Obiageli', 'Uzoamaka', 'Ebere', 'Ogechi', 'Onyinye'],
    surnames: ['Okafor', 'Nwosu', 'Eze', 'Okeke', 'Obi', 'Nwachukwu', 'Okonkwo', 'Anyanwu', 'Ugwu', 'Nnadi', 'Ibe', 'Mbah', 'Agu', 'Onwuka', 'Chukwu', 'Okoro'],
  },
  yoruba: {
    male: ['Adebayo', 'Tunde', 'Olumide', 'Kunle', 'Segun', 'Femi', 'Babatunde', 'Ayodele', 'Dapo', 'Kola', 'Tayo', 'Seyi', 'Gbenga', 'Wale'],
    female: ['Folake', 'Bukola', 'Yetunde', 'Funmilayo', 'Titilayo', 'Adeola', 'Morenike', 'Abike', 'Temitope', 'Omolara', 'Iyabo', 'Damilola', 'Shade', 'Kemi'],
    surnames: ['Adeyemi', 'Ojo', 'Balogun', 'Adeleke', 'Ogunbanjo', 'Afolabi', 'Olaniyan', 'Bakare', 'Ajayi', 'Oladipo', 'Akinola', 'Adesina', 'Ogundele', 'Salami', 'Lawal', 'Akinwale'],
  },
  hausa: {
    male: ['Musa', 'Abdullahi', 'Ibrahim', 'Aliyu', 'Sani', 'Yusuf', 'Bashir', 'Ismail', 'Usman', 'Kabiru', 'Lawal', 'Garba', 'Mustapha', 'Shehu'],
    female: ['Aisha', 'Hauwa', 'Fatima', 'Zainab', 'Maryam', 'Hadiza', 'Safiya', 'Rabi', 'Binta', 'Amina', 'Halima', 'Zulai', 'Asmau', 'Jamila'],
    surnames: ['Abubakar', 'Suleiman', 'Bello', 'Umar', 'Yakubu', 'Mohammed', 'Kabir', 'Sadiq', 'Gambo', 'Tanko', 'Idris', 'Bala', 'Magaji', 'Gwarzo', 'Salihu', 'Danladi'],
  },
  kanuri: {
    male: ['Modu', 'Kachalla', 'Bukar', 'Abba', 'Mala', 'Lawan', 'Goni', 'Baba', 'Ali', 'Umar', 'Ibrahim', 'Mustapha', 'Kyari', 'Tijjani'],
    female: ['Falmata', 'Aisa', 'Hauwa', 'Fanna', 'Kellu', 'Yagana', 'Amina', 'Zara', 'Hadiza', 'Maryam', 'Bintu', 'Kaka', 'Fatima', 'Mairama'],
    surnames: ['Kolo', 'Mohammed', 'Gana', 'Bukar', 'Zannah', 'Mustapha', 'Lawan', 'Goni', 'Kyari', 'Mamman', 'Abatcha', 'Bulama', 'Mala', 'Waziri', 'Modu', 'Ali'],
  },
  tiv: {
    male: ['Terhemba', 'Tersoo', 'Terver', 'Sesugh', 'Aondona', 'Msuur', 'Terseer', 'Aondover', 'Emmanuel', 'Samuel', 'Joseph', 'Daniel', 'Idoko', 'Ochai'],
    female: ['Doosuur', 'Nguavese', 'Mnena', 'Hembadoon', 'Ngunan', 'Mary', 'Grace', 'Rose', 'Comfort', 'Blessing', 'Patience', 'Rebecca', 'Ene', 'Ladi'],
    surnames: ['Tarkaa', 'Ayila', 'Shima', 'Akaahan', 'Tsav', 'Gbilla', 'Ityavyar', 'Ugbe', 'Agbo', 'Ode', 'Ogbu', 'Idoko', 'Ejeh', 'Ochai', 'Igbe', 'Mbaka'],
  },
  edo: {
    male: ['Osaze', 'Osagie', 'Eghosa', 'Efosa', 'Ehi', 'Osamudiamen', 'Izehi', 'Ehigie', 'Iyobosa', 'Uyi', 'Omoruyi', 'Eguavoen', 'Ogieva', 'Aigbe'],
    female: ['Osarugue', 'Itohan', 'Ehiremen', 'Ewemade', 'Ivie', 'Eghe', 'Aisosa', 'Iyore', 'Omozele', 'Osayuwamen', 'Efe', 'Ize', 'Idia', 'Osaretin'],
    surnames: ['Osagie', 'Ehigiator', 'Omoregie', 'Ogbeide', 'Aigbe', 'Idemudia', 'Ekhator', 'Erhabor', 'Osaghae', 'Aghedo', 'Ugiagbe', 'Egharevba', 'Iyamu', 'Okungbowa', 'Oviawe', 'Osayande'],
  },
  central: {
    male: ['Danjuma', 'Bitrus', 'Gyang', 'Yakubu', 'Dauda', 'Istifanus', 'Samaila', 'Joseph', 'Ibrahim', 'Musa', 'Audu', 'Emmanuel', 'Daniel', 'Haruna'],
    female: ['Rahila', 'Hauwa', 'Talatu', 'Laraba', 'Ladi', 'Maryamu', 'Salamatu', 'Mary', 'Grace', 'Ruth', 'Esther', 'Asabe', 'Hannatu', 'Naomi'],
    surnames: ['Dung', 'Pam', 'Gyang', 'Jatau', 'Bako', 'Audu', 'Musa', 'Yohanna', 'Garba', 'Ibrahim', 'Danjuma', 'Bulus', 'Tanko', 'Ishaku', 'Gambo', 'Adamu'],
  },
})

const REGION_BY_STATE: Readonly<Record<string, NameRegion>> = Object.freeze({
  'cross-river': 'efik',
  'akwa-ibom': 'ibibio',
  bayelsa: 'ijaw',
  abia: 'igbo', anambra: 'igbo', ebonyi: 'igbo', enugu: 'igbo', imo: 'igbo', delta: 'igbo',
  ekiti: 'yoruba', ondo: 'yoruba', osun: 'yoruba', kwara: 'yoruba', ogun: 'yoruba', oyo: 'yoruba', lagos: 'yoruba',
  bauchi: 'hausa', gombe: 'hausa', jigawa: 'hausa', kaduna: 'hausa', katsina: 'hausa', kebbi: 'hausa', sokoto: 'hausa', zamfara: 'hausa', niger: 'hausa', kano: 'hausa',
  borno: 'kanuri', yobe: 'kanuri',
  benue: 'tiv',
  edo: 'edo',
  plateau: 'central', nasarawa: 'central', taraba: 'central', adamawa: 'central', kogi: 'central',
})

/** The pool a city draws from. An unlisted state falls back to the mixed central pool rather than guessing. */
export const nameRegionFor = (stateId: string): NameRegion => REGION_BY_STATE[stateId] ?? 'central'

export type Gender = 'male' | 'female'

/**
 * Respectful prefixes for an elder, where one is reviewed. Ete and Mma are used for Efik and Cross River
 * regulars only; they are beta until a native speaker has reviewed them. A region with no entry
 * names its elders plainly, with a given name and a surname.
 */
const ELDER_HONORIFICS: Readonly<Partial<Record<NameRegion, Readonly<Record<Gender, string>>>>> = Object.freeze({
  efik: { male: 'Ete', female: 'Mma' },
  yoruba: { male: 'Baba', female: 'Mama' },
  hausa: { male: 'Malam', female: 'Hajiya' },
  igbo: { male: 'Mazi', female: 'Mama' },
})

export const elderHonorific = (region: NameRegion, gender: Gender): string | null => ELDER_HONORIFICS[region]?.[gender] ?? null

const hash = (text: string): number => {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0
  return value
}

export interface Namer {
  /** The next unused name. Elders take the regional honorific where one is reviewed. */
  next(gender: Gender, elder: boolean): string
}

/**
 * A deterministic namer for one city. The same city and the same taken names always give the same sequence,
 * and no name is given out twice, so a city never has two regulars with the same name.
 */
export function createNamer(cityId: string, region: NameRegion, taken: Iterable<string> = []): Namer {
  const pool = NAME_POOLS[region]
  const used = new Set(taken)
  const seed = hash(`${cityId}:${region}`)
  let counter = 0
  return {
    next(gender, elder) {
      const givenNames = pool[gender]
      const honorific = elder ? elderHonorific(region, gender) : null
      const attempts = givenNames.length * pool.surnames.length
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const step = seed + counter * 7 + attempt
        const given = givenNames[step % givenNames.length]!
        const surname = pool.surnames[(Math.floor(step / givenNames.length) + counter * 3) % pool.surnames.length]!
        const name = honorific ? `${honorific} ${given}` : `${given} ${surname}`
        if (used.has(name)) continue
        used.add(name)
        counter += 1
        return name
      }
      throw new RangeError(`The ${region} name pool is exhausted for ${cityId}`)
    },
  }
}
