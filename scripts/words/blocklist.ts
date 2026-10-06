// Hand-written blocklist for the word lists (see docs/WORDS.md). Words here are removed from every
// generated list, together with any regular inflection of them. The game's own chat filter
// (server/moderation) is applied on top. AVOID_AS_ANSWER words stay valid guesses but are never
// chosen as a daily answer because they are upsetting or unpleasant on a feel-good daily puzzle.

/** Whole words removed everywhere (slurs, sexual terms, drug slang, graphic violence). */
export const BLOCKED_WORDS: readonly string[] = [
  // slurs and hateful terms
  'nigger', 'nigga', 'negro', 'negress', 'darkie', 'darky', 'sambo', 'pickaninny', 'piccaninny', 'jigaboo', 'wog', 'gook', 'chink', 'chinaman',
  'slant', 'paki', 'kike', 'yid', 'hebe', 'heeb', 'wop', 'dago', 'spic', 'spick', 'greaser', 'beaner', 'wetback', 'gringo', 'honky', 'honkey',
  'kaffir', 'kafir', 'abo', 'gyp', 'gypsy', 'gippo', 'injun', 'redskin', 'squaw', 'halfbreed', 'mulatto', 'quadroon', 'octoroon', 'half-caste', 'hottentot',
  'raghead', 'towelhead', 'camel-jockey', 'mick', 'taig', 'polack', 'kraut', 'limey', 'jew', 'jewess', 'jewry', 'saracen', 'infidel', 
  'faggot', 'fag', 'fagot', 'dyke', 'poof', 'poofter', 'pansy', 'sodomite', 'sodomy', 'sodomize', 'tranny', 'shemale', 'lesbo', 'lezzie',
  'retard', 'retarded', 'spastic', 'spaz', 'mongoloid', 'imbecile', 'cretin', 'psycho', 'schizo', 'midget',
  'madman', 'loony', 'dumbo',
  // sexual terms
  'sex', 'sexy', 'sexual', 'sexed', 'sexpot', 'porn', 'porno', 'pornography', 'smut', 'smutty', 'nudist', 'nudity', 'nakedness', 'topless', 'striptease', 'stripper',
  'penis', 'phallus', 'phallic', 'vagina', 'vulva', 'clitoris', 'clit', 'cunt', 'twat', 'pussy', 'schlong', 'bollocks', 'testicle',
  'scrotum', 'anus', 'anal', 'rectum', 'arse', 'arsehole', 'asshole', 'boob', 'boobs', 'tit', 'tits', 'titty', 'nipple', 'breast', 'breasts', 'cleavage', 'crotch', 'groin',
  'fuck', 'fucker', 'fucking', 'fucked', 'fucks', 'shit', 'shite', 'shitty', 'bullshit', 'piss', 'pissed', 'turd', 'wank', 'wanker', 'jizz', 'cum', 'semen',
  'sperm', 'ejaculate', 'orgasm', 'orgy', 'masturbate', 'masturbation', 'onanism', 'blowjob', 'handjob', 'rimjob', 'dildo', 'vibrator', 'condom', 'erotic', 'erotica', 'erection', 'horny', 'lust',
  'lustful', 'lewd', 'lecher', 'lechery', 'lecherous', 'slut', 'slutty', 'whore', 'whoredom', 'hooker', 'harlot', 'strumpet', 'trollop', 'floozy', 'floozie', 'hussy', 'wench', 'bitch',
  'bastard', 'cuckold', 'cuckoldry', 'pimp', 'pander', 'bordello', 'brothel', 'bawdy', 'bawdyhouse', 'concubine', 'courtesan', 'fornicate', 'fornication', 'fornicator', 'adultery', 'adulterer', 'incest',
  'incestuous', 'rape', 'raped', 'rapist', 'rapine', 'molest', 'molester', 'pedophile', 'paedophile', 'pederast', 'pederasty', 'paedophilia', 'pedophilia', 'bestiality', 'zoophilia', 'necrophilia',
  'fellatio', 'cunnilingus', 'coitus', 'copulate', 'copulation', 'intercourse', 'genital', 'genitals', 'genitalia', 'pubic', 'pubes', 'puberty', 'foreskin', 'circumcise', 'circumcision', 'prostitute',
  'prostitution', 'strumpetry', 'venereal', 'syphilis', 'gonorrhea', 'chlamydia', 'herpes', 'nympho', 'nymphomania', 'satyr', 'satyriasis', 'incubus', 'succubus',
  'lubricity', 'lubricious', 'salacious', 'prurient', 'pornographic', 'obscene', 'obscenity', 'indecent', 'lascivious', 'libidinous', 'libido', 'tumescent', 'turgid', 
  'minge', 'shag', 'boink', 'knocker', 'knockers', 'hooters', 'jugs', 'melons', 'booty',
  // drug slang and drug terms
  'dope', 'dopey', 'ganja', 'marijuana', 'hashish', 'cannabis', 'reefer', 'spliff', 'bong', 'blunt', 'cocaine', 'coke', 'heroin', 'smack', 'opium', 'morphine', 'meth',
  'amphetamine', 'ecstasy', 'lsd', 'mescaline', 'peyote', 'psilocybin', 'hallucinogen', 'narcotic', 'narcotics', 'junkie', 'junky', 'stoned', 'stoner', 'druggie', 'crackhead', 'pothead', 'hophead',
  'dopehead', 'cokehead', 'overdose', 'syringe', 'hypodermic', 'barbiturate', 'opiate', 'opioid', 'codeine', 'laudanum', 'bhang', 'hemp', 'kief', 'toke', 'pusher', 'fentanyl',
]

/** Words with an everyday meaning that can also be crude or unpleasant, plus violence terms: valid guesses, never answers. */
export const MILD_WORDS: readonly string[] = [
 'pot', 'weed', 'bush', 'bang', 'poke', 'screw', 'rack', 'tart', 'tramp', 'hash', 'acid', 'crack', 'joint', 'needle', 'dealer', 'pee', 'poop', 'fart', 'farts', 'jerk', 'crap', 'ass', 'butt', 'bum', 'balls', 'knob', 'erect', 'clap', 'crabs', 'lice', 'tush', 'tushy', 'bonk', 'hump', 'spade', 'nip', 'jap', 'lame', 'crazy', 'insane', 'dwarf', 'gimp', 'idiot', 'moron', 'lunatic', 'cripple', 'crippled', 'fairy', 'queer', 'homo', 'guinea', 'frog', 'hun', 'heathen', 'pagan', 'crazy', 'beaver', 'snatch', 'muff', 'fanny', 'willy', 'dong', 'wang', 'cock', 'dick', 'prick', 'coon', 'cracker', 'mongol', 'sod', 'git', 'twit', 'prat', 'berk', 'toad', 'skunk', 'stew', 'stews', 'drab', 'jade', 'madam', 'stud', 'lover', 'lovers', 'virgin', 'virginal', 'naked', 'nude', 'sexton', 'sextet', 'sexes', 'bloody', 'hang', 'hanged', 'lash', 'whip', 'shoot', 'shot', 'gun', 'guns',
  // violent, cruel and upsetting terms
  'kill', 'killed', 'killer', 'killing', 'kills', 'murder', 'murderer', 'murderous', 'homicide', 'homicidal', 'manslaughter', 'slaughter', 'massacre', 'genocide', 'lynch', 'lynching', 'hang', 'hanged',
  'hangman', 'gallows', 'noose', 'gibbet', 'guillotine', 'beheading', 'behead', 'decapitate', 'decapitation', 'strangle', 'strangler', 'strangulation', 'throttle', 'garrote', 'garotte', 'asphyxiate',
  'suffocate', 'drown', 'drowned', 'suicide', 'suicidal', 'hara-kiri', 'harakiri', 'seppuku', 'torture', 'torturer', 'torment', 'tormentor', 'mutilate', 'mutilation', 'maim', 'maimed', 'dismember',
  'disembowel', 'eviscerate', 'castrate', 'castration', 'eunuch', 'gelding', 'flay', 'flog', 'flogging', 'whip', 'lash', 'scourge', 'stab', 'stabbed', 'stabbing', 'shoot', 'shot', 'shooting', 'gun', 'guns',
  'gunman', 'gunfire', 'gunshot', 'pistol', 'revolver', 'rifle', 'shotgun', 'musket', 'bomb', 'bomber', 'bombing', 'bombard', 'grenade', 'dynamite', 'explosive', 'terror', 'terrorism', 'terrorist', 'terrorize',
  'hostage', 'kidnap', 'kidnapper', 'abduct', 'abduction', 'assassin', 'assassinate', 'assassination', 'slay', 'slain', 'slayer', 'slaughterer', 'butcher', 'butchery', 'carnage', 'bloodshed', 'bloodbath',
  'bloodthirsty', 'bloodlust', 'corpse', 'cadaver', 'carcass', 'gore', 'gory', 'rapine', 'pillage', 'plunder', 'ravage', 'ravish', 'ravisher', 'abuse', 'abuser', 'abusive', 'batter', 'beat', 'beaten',
  'assault', 'assaulter', 'attack', 'attacker', 'rob', 'robber', 'robbery', 'thief', 'theft', 'steal', 'stolen', 'burglar', 'burglary', 'mugger', 'mugging', 'extort', 'extortion', 'blackmail', 'bribe',
  'bribery', 'fraud', 'fraudulent', 'swindle', 'swindler', 'scam', 'scammer', 'cheat', 'cheater', 'con', 'conman', 'embezzle', 'embezzler', 'slave', 'slavery', 'slaver', 'enslave', 'bondage', 'bondmaid',
  'bondman', 'bondslave', 'bondservant', 'serf', 'serfdom', 'lynchpin', 'apartheid', 'nazi', 'nazism', 'fascist', 'fascism', 'hitler', 'holocaust', 'pogrom', 'jihad', 'jihadist', 'crusade', 'crusader',
  'inquisition', 'heresy', 'heretic', 'blasphemy', 'blasphemer', 'blaspheme', 'sacrilege', 'profane', 'profanity', 'curse', 'cursed', 'damn', 'damned', 'goddamn', 'hell', 'hellish', 'satan', 'satanic',
  'devil', 'demon', 'demonic', 'fiend', 'antichrist', 'beelzebub', 'lucifer', 'cancer', 'tumor', 'tumour', 'leper', 'leprosy', 'leprous', 'plague', 'pestilence', 'epidemic', 'pandemic', 'famine', 'starve',
  'starvation', 'poison', 'poisoner', 'venom', 'toxin', 'cyanide', 'arsenic', 'strychnine', 'hemlock', 'abortion', 'abort', 'aborted', 'abortionist', 'infanticide', 'patricide', 'matricide', 'fratricide',
  'regicide', 'parricide', 'uxoricide', 'sororicide', 'filicide', 'genocidal', 'ethnic', 'racist', 'racism', 'sexist', 'sexism', 'misogyny', 'misogynist', 'bigot', 'bigotry', 'xenophobe', 'xenophobia',
  'bloody', 'bugger', 'buggery', 'bugged', 'sod', 'git', 'twit', 'prat', 'plonker', 'tosser', 'berk', 'toad', 'scum', 'scumbag', 'dirtbag', 'sleaze', 'sleazy', 'creep', 'creepy', 'perv', 'pervert',
  'perverse', 'perversion', 'deviant', 'degenerate', 'degeneracy', 'depraved', 'depravity', 'debauch', 'debauchery', 'dissolute', 'licentious', 'wanton', 'wantonness', 'promiscuous', 'promiscuity',
  'harem', 'seraglio', 'stew', 'stews', 'drab', 'trull', 'jade', 'quean', 'minx', 'doxy', 'bagnio', 'lupanar', 'bawd', 'procuress', 'procurer', 'madam', 'tomcat', 'stud', 'gigolo', 'paramour', 'mistress',
  'lover', 'lovers', 'cohabit', 'cohabitation', 'concubinage', 'bigamy', 'bigamist', 'polygamy', 'polygamist', 'polyandry', 'adulterate', 'adulterous', 'unchaste', 'unchastity', 'virgin', 'virginal',
  'virginity', 'deflower', 'defile', 'defilement', 'seduce', 'seducer', 'seduction', 'seductress', 'seductive', 'ravishment', 'carnal', 'carnality', 'fleshly', 'sensual', 'sensuality', 'sensualist',
  'voluptuous', 'voluptuary', 'amorous', 'amour', 'aphrodisiac', 'prophylactic', 'contraceptive', 'contraception', 'abstinence', 'celibate', 'celibacy', 'eroticism', 'erotism', 'erotomania', 'fetish',
  'fetishism', 'fetishist', 'sadism', 'sadist', 'masochism', 'masochist', 'voyeur', 'voyeurism', 'exhibitionist', 'exhibitionism', 'flasher', 'streaker', 'undress',
  'undressed', 'disrobe', 'disrobed', 'unclothed', 'unclad', 'nudge', 'bosom', 'bosomy', 'busty', 'thong', 'bikini', 'lingerie', 'brassiere', 'brassier', 'panties', 'knickers', 'girdle',
  'corset', 'garter', 'negligee', 'bloomers', 'drawers', 'underpants', 'briefs', 'jockstrap', 'codpiece', 'loincloth', 'gstring',
]

/** Any word that begins with one of these stems is removed (only for stems that are never innocent). */
export const BLOCKED_PREFIXES: readonly string[] = [
  'fuck', 'shit', 'cunt', 'nigg', 'bitch', 'whore', 'slut', 'porn', 'pedoph', 'paedoph', 'rapist', 'masturb', 'genocid', 'terroris', 'jihad', 'nazi', 'faggot', 'wank', 'blowjob', 'handjob',
  'orgasm', 'ejaculat', 'fornicat', 'copulat', 'sodom', 'homosex', 'lesbian', 'masochis', 'sadis', 'suicid', 'homicid', 'murder', 'assassin', 'massacr', 'torture', 'mutilat', 'castrat', 'incest',
  'prostitut', 'genital', 'penis', 'vagin', 'clitor', 'scrot', 'testic', 'erotic', 'sexu', 'narcot', 'cocain', 'heroin', 'marijuan', 'amphetam', 'morphin', 'holocaust', 'lynch', 'slaughter',
  'abortion', 'epilep', 'schizo', 'psychopath', 'cannibal', 'necrophil', 'bestial', 'pervers', 'deprav', 'debauch', 'licentious', 'lascivi', 'libidin', 'salaci', 'concubin', 'adulter',
]

/** Valid guesses, but never a daily answer (upsetting, violent, sad, crude or too specialised for a daily puzzle). */
export const AVOID_AS_ANSWER: readonly string[] = [
  'abuse', 'arson', 'ashes', 'badly', 'beast', 'betray', 'blood', 'bleed', 'bones', 'brute', 'burnt', 'cruel', 'curse', 'death', 'dying', 'dead', 'dread', 'drunk', 'dully',
  'dumpy', 'evils', 'fatal', 'fault', 'fears', 'fiend', 'filth', 'gloom', 'grave', 'greed', 'grief', 'grime', 'gross', 'guilt', 'harsh', 'hates', 'hatred', 'hurts', 'idiot', 'liars', 'loser', 'lying',
  'moron', 'pains', 'panic', 'peril', 'pests', 'phony', 'poise', 'prick', 'rages', 'rotten', 'rumor', 'sadly', 'scare', 'scorn', 'sinks', 'slain', 'slave', 
  'stink', 'stole', 'sulky', 'thief', 'toxic', 'ugly', 'vomit', 'wrath', 'wrong', 'worse', 'worst', 'wreck', 'yells',
  'bully', 'brawl', 'burns', 'chaos', 'crime', 'crook', 'crude', 'cried', 'cries', 'cults', 'debts', 'decay', 'demon', 'devil', 'dirge', 'doomy', 'feign', 'flaws', 'folly',
  'fraud', 'freak', 'ghoul', 'gruff', 'hades', 'havoc', 'horde', 'hater', 'heist', 'jerky', 'junky', 'kills', 'lousy', 'lurid', 'magot', 'maggot', 'mourn', 'nasty', 'poorly',
  'quake', 'ruins', 'sever', 'skull', 'sloth', 'snore', 'spill', 'spite', 'spook', 'squid', 'strife', 'tease', 'tragic', 'tumor', 'vices',
  'vile', 'vicar', 'wails', 'wasps', 'weeps', 'whine', 'woe', 'woes', 'wraps', 'wrest', 'wring', 'wrung', 'bombs', 'drugs', 'drunks', 'booze', 'beers', 'wines', 'vodka', 'rum',
  'vices', 'sinner', 'tombs', 'tomb', 'coffin', 'burial', 'bury', 'grief', 'hurt', 'bitter', 'spank', 'booty', 'boobs', 'nudes', 'gutsy', 'gutty', 'spasm', 'sheik', 'chink', 'kinky',
  'skimp', 'whack', 'smack', 'slap', 'slaps', 'smash', 'thump', 'thrash', 'bash', 'battle', 'tanks', 'arms', 'armed', 'army', 'spear', 'lance', 'bayonet', 'dagger', 'shiv',
  'mafia', 'gangs', 'thugs', 'mobs', 'riot', 'riots', 'siege', 'raids', 'looter', 'loots', 
]
