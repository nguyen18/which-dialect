// Shapes of the data. The build script (scripts/build-language.ts) writes the Stored* types to the
// data files; the API in index.ts reads them and returns the full Sense/Entry/Hit types.

/** One meaning of a word. Regions are per sense: a word can be common in one meaning and regional in another. */
export type Sense = {
  glosses: string[]
  /**
   * Regions where this sense is used. Senses with no region tag in the source are listed under
   * every region of the language (see `regionTagged`).
   */
  regions: string[]
  /** true when the source tagged the region(s); false when all regions were assumed because it had no tag. */
  regionTagged: boolean
  /** Usage labels from the source, e.g. colloquial, literary, slang, archaic, vulgar. */
  labels: string[]
  /** Set when this sense is a variant of another word, e.g. Vietnamese "hông" is a Southern form of "không". */
  altOf?: string
  /**
   * Same-language words with this meaning, from Wiktionary: often the other dialects' words
   * (Vietnamese "ngô" -> "bắp", "lợn" -> "heo", English "lift" -> "elevator").
   */
  synonyms?: string[]
  /** Example sentences from Wiktionary, with an English translation for non-English languages. */
  examples?: Example[]
  /**
   * English senses only: Wiktionary's translation table for this meaning, by language code: the words
   * editors list as the usual translation of exactly this sense, with region/register tags when given
   * (e.g. "I" → vi: tôi, tớ [informal], tui [South]).
   */
  translations?: Record<string, TableTranslation[]>
}

export type TableTranslation = { word: string; tags?: string[] }

export type Example = { text: string; translation?: string }

export type Entry = {
  word: string
  /** Part of speech, e.g. noun, verb, adj, pron, particle. */
  pos: string
  senses: Sense[]
  /**
   * How common the word is, as a Zipf frequency from wordfreq: log10 of uses per billion words (about 7
   * for "the", 6 for everyday words, 3 for rare ones). Undefined when unknown (usually rare).
   */
  frequency?: number
}

/** One way to say an English term: a word plus the sense that matched. */
export type Hit = {
  word: string
  pos: string
  /** The gloss the English term came from. */
  gloss: string
  regions: string[]
  regionTagged: boolean
  labels: string[]
  altOf?: string
  /** Position of the sense within its entry; earlier senses are usually the main meaning. */
  senseIndex: number
  /** How many senses the word has in total (a fallback commonness signal when `frequency` is missing). */
  senses: number
  /** How common the word is (Zipf frequency, see Entry.frequency). */
  frequency?: number
  /** true when the English term is the first meaning listed in the gloss (e.g. "now" in "now, today"). */
  primary: boolean
  /** true for a hand-picked phrase that isn't a dictionary headword ("bữa tối"); its details are the pick's. */
  phrase?: boolean
}

export type LanguageMeta = {
  /** ISO 639 code, e.g. "vi". */
  lang: string
  /** English name, e.g. "Vietnamese". */
  name: string
  /** The language's regions, e.g. ["Northern", "Central", "Southern"], or countries for English. */
  regions: string[]
  /**
   * Named groups of regions that can be searched as one, e.g. English "North America" or "British Isles".
   * Omitted when the language has none.
   */
  regionGroups?: Record<string, string[]>
  source: { name: string; url: string; retrieved: string; lastModified: string | null }
  license: { name: string; url: string }
  /** Where word frequencies come from, with the credit its license requires. */
  frequencySource?: { name: string; url: string; license: string; sources: string }
  counts: { entries: number; senses: number; regionTaggedSenses: number; englishTerms: number }
  /** Shard file names (without .json) in words/ and en/. */
  shards: { words: string[]; en: string[] }
  /** Letters per shard key; see shardKey. Omitted means 2. */
  shardLength?: number
  /** true when the language has a pronoun table (pronouns.json, see PronounRow). */
  pronouns?: boolean
  /** true when the language has hand-picked translations (picks.json, see PickRow). */
  picks?: boolean
  /** true when the language has checker settings (checker.json, see CheckerConfig). */
  checker?: boolean
  /** true when the language has a syllable list (syllables.json: syllable → Zipf frequency, 0 when unknown). */
  syllables?: boolean
  /** true when the language has sentence frames (frames.json, see FramesData). */
  frames?: boolean
}

/**
 * Pronoun slots in sentence frames ({I}, {YOU}, …) and the pronoun-table column each one fills from, for
 * the listener (or the table's default row).
 */
export const FRAME_PRONOUNS: Record<string, { person: PronounPerson; inclusive?: boolean }> = {
  I: { person: 'self' },
  YOU: { person: 'addressee' },
  WE: { person: 'selfPlural', inclusive: false },
  WE_INCL: { person: 'selfPlural', inclusive: true },
  YOU_PL: { person: 'addresseePlural' },
  HE_SHE: { person: 'third' },
  THEY: { person: 'thirdPlural' },
}

/**
 * One choice for a frame word slot ({WHERE} → "đâu", "mô"): from a dictionary definition (region and
 * labels from that sense) or a hand-written override with a note. `when: 'respect'` choices are used only
 * when the listener's pronoun-table row is marked respect (Vietnamese "ạ").
 */
export type FrameWordChoice = {
  word: string
  gloss?: string
  source: 'gloss' | 'override'
  regions: string[]
  regionTagged: boolean
  labels: string[]
  note?: string
  when?: 'respect'
}

/** A frame word slot: what it means, whether a sentence is fine without it, and its choices in order. */
export type FrameWords = { meaning: string; optional?: boolean; choices: FrameWordChoice[] }

/**
 * A sentence frame in one language: the catalog's id, topic, English ways to say it and slots, and this
 * language's `text` with {slot} placeholders: content slots (lowercase, from `slots`), pronoun slots
 * (FRAME_PRONOUNS) and frame word slots (uppercase, from FramesData.words).
 */
export type FrameData = {
  id: string
  topic: string
  en: string[]
  slots: Record<string, 'noun' | 'verb' | 'adj'>
  clause?: boolean
  text: string
}

export type FramesData = { frames: FrameData[]; words: Record<string, FrameWords> }

export type StoredFrameWordChoice = Omit<FrameWordChoice, 'regions' | 'regionTagged' | 'labels'> & { regions?: string[]; labels?: string[] }
export type StoredFramesData = { frames: FrameData[]; words: Record<string, Omit<FrameWords, 'choices'> & { choices: StoredFrameWordChoice[] }> }

/**
 * How the checker reads one language (languages/<lang>.ts `checker`, stored as data/checker.json). Every
 * field is optional: a language without it is read as space-separated words, and gets the checks that
 * only need its dictionary (dialect mixing).
 */
export type CheckerConfig = {
  /**
   * What spaces separate: 'words' (English), or 'syllables' that group into dictionary words (Vietnamese
   * "thịt heo", "kết quả"). With 'syllables' the build also writes syllables.json for accent suggestions.
   */
  units?: 'words' | 'syllables'
  /** The longest dictionary word to look for, in units (default 3). */
  maxWordUnits?: number
  /**
   * Pronouns that are reliably pronouns, by pronoun-table column ("tôi", "tao", "mày"). The pronoun checks
   * look only at these: kinship words like Vietnamese "con" (also "child", a classifier) aren't listed.
   */
  pronouns?: Partial<Record<PronounPerson, string[]>>
  /** Listed pronouns that are also common nouns ("bạn": you, or friend); checked, but only as suggestions. */
  ambiguousPronouns?: string[]
  /** Sentence endings expected when speaking up (pronoun-table rows marked `respect`), e.g. Vietnamese "ạ". */
  politeEndings?: string[]
  /**
   * English words (English is the bridge) this language usually has no word for, so the checker suggests
   * leaving them out rather than translating them: Vietnamese has no articles ("the", "a", "an").
   */
  leaveOut?: string[]
  /**
   * Groups of letters often confused, by sound or by neighboring keys ("ckq": Vietnamese c, k and q sound
   * alike). The spellchecker counts swapping within a group as half a change, so "họk" → "học" before "họ".
   */
  similarLetters?: string[]
}

/**
 * Hand-picked first choices for one English meaning, in one target language (picks.json). A speaker's
 * judgment of the natural word where the data ranks another first ("get", "To fetch, bring, take" →
 * Vietnamese "lấy", not "đưa"). Keyed by English meaning, so each language needs one list, and
 * translating between two other languages reaches it through the English meaning.
 */
export type PickRow = {
  /**
   * The English headword, part of speech and definition of the meaning, as in the English data. For a
   * nested sense (a heading plus its own definition: "old", "Of a living being…") it's the sense's own,
   * last definition, so senses under one heading are told apart.
   */
  word: string
  pos: string
  gloss: string
  /** Best first. `tags` name regions like translation-table tags ("Southern"). A pick needn't be a headword ("bữa tối"). */
  picks: TableTranslation[]
  /** Words never given for this meaning (a speaker removed them: wrong or unnatural here). */
  exclude?: string[]
  /** Put this meaning first when the caller gives no `pos` or `meaning` ("got" → "Have/has."). */
  first?: boolean
}

/**
 * One word in the pronoun table: how to say "I", "you", "he/she", "we", plural "you" or "they" in one
 * relationship. Most come from a dictionary definition that describes the relationship ("you, a male
 * who's (presumably) slightly older than me"); regular compounds the dictionary doesn't list come from a
 * grammar rule ("các" + "anh" = plural "you" to older men); the rest are hand-written overrides for what
 * the definitions don't say (Vietnamese "em" is never defined as "I").
 */
export type PronounChoice = {
  word: string
  /** The definition this choice comes from. Omitted for rules and overrides. */
  gloss?: string
  /**
   * Where the choice comes from: a dictionary definition, a grammar rule (a regular compound, with a
   * `note` naming the rule), or a hand-written override with a `note`.
   */
  source: 'gloss' | 'rule' | 'override'
  regions: string[]
  regionTagged: boolean
  labels: string[]
  /** Only when the speaker is male or female ("anh" if you're a man, "chị" if a woman). */
  speaker?: 'male' | 'female'
  /** The gender of the person the word refers to, when it has one ("anh ấy" he, "chị ấy" she). */
  gender?: 'male' | 'female'
  /** For "we": true when it includes the listener ("chúng ta"), false when it doesn't ("chúng tôi"). */
  inclusive?: boolean
  note?: string
}

/** The pronoun table's columns: I, you, he/she, we, you (plural), they. */
export const PRONOUN_PERSONS = ['self', 'addressee', 'third', 'selfPlural', 'addresseePlural', 'thirdPlural'] as const
export type PronounPerson = (typeof PRONOUN_PERSONS)[number]

/**
 * A relationship and the words for it, e.g. Vietnamese "Your parents": you say "con", you call them
 * "ba"/"má" (Southern) or "bố"/"mẹ". For "he/she" and "they" the relationship is with the person you're
 * talking about.
 */
export type PronounRow = {
  /** Stable id, e.g. "parent", "older-male". */
  id: string
  /** Who you're talking to (or about), for display: "Your parents". */
  label: string
  /** How to say "I". */
  self: PronounChoice[]
  /** How to say "you". */
  addressee: PronounChoice[]
  /** How to say "he"/"she" about this person. */
  third: PronounChoice[]
  /** How to say "we" (you and others, talking to this person). */
  selfPlural: PronounChoice[]
  /** How to say "you" to several people like this. */
  addresseePlural: PronounChoice[]
  /** How to say "they" about several people like this. */
  thirdPlural: PronounChoice[]
  /** The row to use when the relationship isn't known (neutral words: Vietnamese "tôi", "bạn"). */
  default?: boolean
  /** Speaking up to this person (parents, elders, teachers): polite sentence endings are expected. */
  respect?: boolean
  /** A caution for the whole row, e.g. that "tao"/"mày" are rude outside close friendships. */
  warning?: string
}

export type StoredPronounChoice = Omit<PronounChoice, 'regions' | 'regionTagged' | 'labels'> & { regions?: string[]; labels?: string[] }
/** Stored rows leave out empty columns. */
export type StoredPronounRow = Omit<PronounRow, PronounPerson> & Partial<Record<PronounPerson, StoredPronounChoice[]>>

// Stored forms. To keep files small, a sense with no region tag has no `regions` (it means every
// region, regionTagged false), and empty `labels` are left out. The API fills both back in.
export type StoredSense = Omit<Sense, 'regions' | 'regionTagged' | 'labels'> & { regions?: string[]; labels?: string[] }
export type StoredEntry = Omit<Entry, 'senses'> & { senses: StoredSense[] }
export type StoredHit = Omit<Hit, 'regions' | 'regionTagged' | 'labels'> & { regions?: string[]; labels?: string[] }

/** words/<shard>.json: entries keyed by headword. */
export type WordShard = Record<string, StoredEntry[]>

/** en/<shard>.json: hits keyed by lowercase English term. */
export type EnglishShard = Record<string, StoredHit[]>

/** Converts a full sense or hit to its stored form. */
export function toStored<T extends { regions: string[]; regionTagged: boolean; labels: string[] }>(item: T) {
  const { regions, regionTagged, labels, ...rest } = item
  return {
    ...rest,
    ...(regionTagged ? { regions } : {}),
    ...(labels.length ? { labels } : {}),
  }
}

/** Converts a stored sense or hit back to its full form, given the language's regions. */
export function fromStored<T extends { regions?: string[]; labels?: string[] }>(item: T, allRegions: string[]) {
  return {
    ...item,
    regions: item.regions ?? allRegions,
    regionTagged: item.regions !== undefined,
    labels: item.labels ?? [],
  }
}

/**
 * Which shard file a term lives in: its first `length` letters (two by default) without diacritics (đ counts as d, ñ as n),
 * so a lookup only downloads a small file. Characters outside a-z become "_", e.g. "ở" -> "o_", "3D" -> "_d".
 */
export function shardKey(term: string, length = 2): string {
  const base = term
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
  const letter = (c: string) => (c >= 'a' && c <= 'z' ? c : '_')
  let key = ''
  for (let i = 0; i < length; i++) key += letter(base.charAt(i))
  return key
}

/** Normalizes an English search term the same way the index keys were built. */
export function normalizeEnglish(term: string): string {
  return term
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(to|a|an|the) (?=\S)/, '')
}

/**
 * The most useful line of a sense's definitions for display. Wiktionary nests some senses under a
 * heading ("As a copulative verb:" → "Used to indicate that the subject and object are the same."), so
 * headings ending in ":" are skipped in favor of the specific definition.
 */
export function displayGloss(glosses: string[]): string {
  return glosses.find((g) => !g.trim().endsWith(':')) ?? glosses[0] ?? ''
}

// Trailing words dropped to also match the bare verb: "wait for" is found by "wait" too.
export const TRAILING_PARTICLE = / (for|to|at|on|with|about|of|in|into|up|out|off|over)$/

/** Definitions of personal names ("a male given name from Chinese", "a surname"), which aren't translated. */
export const PERSONAL_NAME = /\b(?:given name|surname|family name|patronymic|nickname)\b/i

/**
 * A definition without its parenthesized notes, nested ones too ("South Korea (a country …; official name:
 * Đại Hàn Dân Quốc (“Republic of Korea”))" → "South Korea"), and a note left open by a cut-off definition.
 */
export function withoutNotes(gloss: string): string {
  let text = gloss
  for (let previous = ''; previous !== text; ) {
    previous = text
    text = text.replace(/\([^()]*\)/g, ' ')
  }
  return text.replace(/\([^)]*$/, ' ')
}

/**
 * Splits an English gloss into search terms, main meaning first: "now, today, this time" ->
 * [["now", 0], ["today", 1], ["this time", 2]]. Parenthesized notes and final punctuation are dropped.
 * When a gloss explains before a colon ("Negates the meaning of the modified verb: not"), only the
 * part after it is used. Only short, plain phrases (up to 4 words) are kept. Returns [term, position].
 */
export function glossTerms(gloss: string): [string, number][] {
  // Grammar words are defined by what they do: "marks the future tense" (Vietnamese "sẽ"), "Used to
  // express the future tense" (English "will"). The phrase after marks/expresses/indicates/denotes is
  // their meaning, so it's a term too, placed after the gloss's own terms.
  const grammar = [...gloss.matchAll(GRAMMAR_PHRASE)].map((m) => normalizeEnglish(m[1])).filter((t) => t.split(' ').length <= 3)
  let cleaned = withoutNotes(gloss).replace(/[“”"]/g, '')
  if (cleaned.includes(':')) cleaned = cleaned.slice(cleaned.lastIndexOf(':') + 1)
  const terms: [string, number][] = []
  let position = 0
  // "I/me" lists two meanings, like "I; me". Sentences too: "To have. See usage notes." means "have",
  // and cross-references ("See usage notes", "Compare shall", "Synonym: …") aren't meanings.
  for (const part of cleaned.split(/[;,/]|\.\s+/)) {
    if (/^\s*(?:see|compare|cf|synonyms?|antonyms?)\b/i.test(part)) continue
    // "etc." is not a meaning: "walking etc" -> "walking", and a lone "etc" is skipped.
    const t = normalizeEnglish(part.replace(/[.!?]+\s*$/, '').replace(/\betc\.?$/i, '').trim())
    if (!t || t.split(' ').length > 4 || !/^[a-z][a-z' -]*$/.test(t)) continue
    terms.push([t, position])
    // The bare verb shares its phrase's position, so "wait" counts as the main meaning of "to wait for".
    const bare = t.replace(TRAILING_PARTICLE, '')
    if (bare !== t && bare) terms.push([bare, position])
    position++
  }
  // A grammar phrase is the main meaning when the gloss's first term is the grammar description itself
  // ("marks the future tense" → "future tense" is what "sẽ" means); otherwise it follows the other terms.
  const describesGrammar = terms.length === 0 || grammar.some((g) => terms[0][0].includes(g))
  for (const t of grammar) if (!terms.some(([x]) => x === t)) terms.push([t, describesGrammar ? 0 : position++])
  return terms
}

const GRAMMAR_PHRASE =
  /\b(?:marks?|marking|express(?:es|ing)?|indicat(?:es?|ing)|denot(?:es?|ing)|signals?)\s+(?:the\s+|a\s+|an\s+)?([a-z][a-z -]{2,30}?)(?=\s*(?:[,;.(]|$|\s+(?:of|in|with|for|or|and|when|that)\b))/gi
