import {
  PERSONAL_NAME,
  PRONOUN_PERSONS,
  fromStored,
  normalizeEnglish,
  shardKey,
  type CheckerConfig,
  type FramesData,
  type StoredFramesData,
  type PronounRow,
  type EnglishShard,
  type Entry,
  type Hit,
  type LanguageMeta,
  type PickRow,
  type StoredPronounRow,
  type WordShard,
} from './types.ts'
import { accentCombinations, segment as segmentUnits, syllablesByPlain, units } from './text.ts'

export * from './types.ts'
export * from './pos.ts'

/**
 * Data packages this version of the API reads by default, as a jsDelivr version range.
 * Bump it when the data format changes.
 */
export const DATA_VERSION = '0.1'

/** Labels left out of search results unless `exclude` is passed. */
export const DEFAULT_EXCLUDED_LABELS = [
  'vulgar', 'offensive', 'derogatory', 'archaic', 'obsolete', 'dated', 'historical', 'rare', 'abbreviation',
]

// Search ranks plain, everyday words first. Labels in the first set cost a little (still normal speech,
// just a particular register); the second set costs more (specialized, playful or uncommon).
const MILD_LABELS = new Set(['colloquial', 'informal', 'familiar', 'polite', 'formal', 'endearing', 'honorific'])
const LABEL_PENALTY = (h: Hit) =>
  h.labels.reduce((sum, l) => sum + (MILD_LABELS.has(l) ? 1 : 2), 0)

/** Loads one data file by its path inside the data folder, e.g. "meta.json" or "en/no.json". */
export type LoadJson = (path: string) => Promise<unknown>

export type DictionaryOptions = {
  /** ISO 639 code of a published data package, e.g. "vi" for which-dialect-vi. */
  lang: string
  /**
   * Where the data folder is served. Defaults to the data package on jsDelivr, so nothing has to be
   * bundled: https://cdn.jsdelivr.net/npm/which-dialect-<lang>@<DATA_VERSION>/data
   */
  baseUrl?: string
  /** Custom loader instead of fetch, e.g. reading from disk in Node. Overrides baseUrl. */
  load?: LoadJson
}

export type SearchOptions = {
  /**
   * Only return words used in this region, or in any region of a group (see meta().regions and
   * meta().regionGroups, e.g. Vietnamese "Southern" or English "North America"). Untagged words count as every region.
   */
  region?: string
  /** Only return these parts of speech (Wiktionary codes, see POS_NAMES), e.g. ['verb']. */
  pos?: string[]
  /** Labels to leave out. Defaults to DEFAULT_EXCLUDED_LABELS; pass [] to include everything. */
  exclude?: string[]
  /** Maximum number of results (default 10). */
  limit?: number
  /**
   * Return every matching sense of each word instead of one result per word (its best-ranked sense), so
   * a caller can choose between a word's senses itself. `limit` then counts words, not results.
   */
  allSenses?: boolean
}

export type PronounOptions = {
  /** Only this relationship's row, by id (e.g. "parent"). Unknown ids throw, listing the valid ones. */
  listener?: string
  /** Only words used in this region or region group; untagged words count as every region. */
  region?: string
  /** Drop words only the other gender uses ("anh" vs "chị" toward someone younger). */
  speaker?: 'male' | 'female'
  /** Labels to leave out. Defaults to DEFAULT_EXCLUDED_LABELS; pass [] to include everything. */
  exclude?: string[]
}

/** One word of a text, as the dictionary splits it (see Dictionary.segment). */
export type WordSegment = {
  /** The word as written; offsets are into the text in Unicode NFC form. */
  text: string
  start: number
  end: number
  /** The word's dictionary entries; empty for words the dictionary doesn't have (names, typos). */
  entries: Entry[]
}

/** Another way to write a word with the same letters (see Dictionary.variants). */
export type WordVariant = {
  word: string
  entries: Entry[]
  /** Zipf frequency (see Entry.frequency), or the syllable's for one syllable; undefined when unknown. */
  frequency?: number
}

// Accent forms tried per syllable: more for one syllable, fewer for longer words, where every
// combination is looked up (at most MAX_VARIANT_COMBINATIONS).
const VARIANT_FORMS_ONE_SYLLABLE = 12
const VARIANT_FORMS_PER_SYLLABLE = 5
const MAX_VARIANT_COMBINATIONS = 64

export type Dictionary = {
  /** The language's name, regions, source, license and counts. */
  meta(): Promise<LanguageMeta>
  /** Entries for a word in the language, e.g. lookup("má"). */
  lookup(word: string): Promise<Entry[]>
  /**
   * Ways to say an English word or short phrase, best first, one result per word. With a region,
   * words the source tags for that region rank ahead of untagged ones.
   */
  searchEnglish(term: string, options?: SearchOptions): Promise<Hit[]>
  /**
   * How to say "I", "you", "he/she", "we", plural "you" and "they" depending on who you're talking to
   * (or about), one row per relationship, for languages whose pronouns depend on it (Vietnamese). Empty
   * for languages without a pronoun table.
   */
  pronouns(options?: PronounOptions): Promise<PronounRow[]>
  /** Hand-picked first choices for English meanings (see PickRow). Empty for languages without any. */
  picks(): Promise<PickRow[]>
  /** How the checker reads this language (see CheckerConfig); `{}` for languages without settings. */
  checker(): Promise<CheckerConfig>
  /** Syllable → Zipf frequency (0 when unknown), for languages written in syllables; `{}` otherwise. */
  syllables(): Promise<Record<string, number>>
  /** The language's sentence frames and frame words, unfilled (see FramesData); empty without frames. */
  frames(): Promise<FramesData>
  /**
   * The text split into the language's words: at each point, the longest run of units (syllables or
   * words, up to the checker's `maxWordUnits`, default 3) that's a headword, so Vietnamese "hôm nay" is one
   * word ("today"), not "hôm" + "nay". Units join only across spaces. Units the dictionary doesn't know
   * are words of their own with no entries. Punctuation isn't returned.
   */
  segment(text: string): Promise<WordSegment[]>
  /**
   * Other words written with the same letters but other accents, that the dictionary has, most common
   * first: "muộn" → muốn, mượn, …; for words of several syllables, every syllable varies ("hom nay" →
   * "hôm nay"). For languages written in syllables (with a syllable list); `[]` otherwise. The word
   * itself isn't included.
   */
  variants(word: string, options?: { limit?: number }): Promise<WordVariant[]>
}

/**
 * The regions a region or region-group name stands for (e.g. English "North America" -> US, Canada),
 * or null when no region is given. Throws for names the language doesn't have, listing the valid ones.
 */
export function resolveRegion(meta: LanguageMeta, region: string | undefined): Set<string> | null {
  if (!region) return null
  const members = meta.regions.includes(region) ? [region] : meta.regionGroups?.[region]
  if (!members) {
    const groups = Object.keys(meta.regionGroups ?? {})
    throw new Error(
      `which-dialect: "${region}" isn't a ${meta.name} region or group ` +
        `(regions: ${meta.regions.join(', ')}${groups.length ? `; groups: ${groups.join(', ')}` : ''})`,
    )
  }
  return new Set(members)
}

export function dataUrl(lang: string): string {
  return `https://cdn.jsdelivr.net/npm/which-dialect-${lang}@${DATA_VERSION}/data`
}

function fetchLoader(baseUrl: string): LoadJson {
  const base = baseUrl.replace(/\/+$/, '')
  return async (path) => {
    const res = await fetch(`${base}/${path}`)
    if (!res.ok) throw new Error(`which-dialect: couldn't load ${base}/${path} (${res.status})`)
    return res.json()
  }
}

export function createDictionary(options: DictionaryOptions): Dictionary {
  const load = options.load ?? fetchLoader(options.baseUrl ?? dataUrl(options.lang))
  // Each file is loaded at most once; a failed load is forgotten so it can be retried.
  const cache = new Map<string, Promise<unknown>>()
  const loadOnce = <T>(path: string): Promise<T> => {
    let pending = cache.get(path)
    if (!pending) {
      pending = load(path).catch((err: unknown) => {
        cache.delete(path)
        throw err
      })
      cache.set(path, pending)
    }
    return pending as Promise<T>
  }

  const meta = () => loadOnce<LanguageMeta>('meta.json')

  // Missing shards simply mean no words start with those letters, so they aren't requested.
  async function shard<T>(kind: 'words' | 'en', term: string): Promise<T | null> {
    const m = await meta()
    const key = shardKey(term, m.shardLength)
    return m.shards[kind].includes(key) ? loadOnce<T>(`${kind}/${key}.json`) : null
  }

  async function lookup(word: string): Promise<Entry[]> {
    const w = word.trim()
    const [m, data] = await Promise.all([meta(), shard<WordShard>('words', w)])
    // The word as written, else lowercase ("Mẹ" → "mẹ"), else capitalized for names written in lowercase
    // ("nhật" → "Nhật", Japan; "nhật bản" → "Nhật Bản"), which spellchecker suggestions and learners do.
    const titled = w.toLowerCase().replace(/(^|[\s-])(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    const stored = data?.[w] ?? data?.[w.toLowerCase()] ?? data?.[titled] ?? []
    return stored.map((e) => ({ ...e, senses: e.senses.map((s) => fromStored(s, m.regions)) }))
  }

  const checker = async (): Promise<CheckerConfig> => {
    const m = await meta()
    return m.checker ? loadOnce<CheckerConfig>('checker.json') : {}
  }

  const syllables = async (): Promise<Record<string, number>> => {
    const m = await meta()
    return m.syllables ? loadOnce<Record<string, number>>('syllables.json') : {}
  }

  return {
    meta,
    lookup,
    checker,
    syllables,

    async segment(input) {
      const text = input.normalize('NFC')
      const config = await checker()
      const words = await segmentUnits(text, units(text), config.maxWordUnits ?? 3, lookup)
      return words.map(({ text: t, start, end, entries }) => ({ text: t, start, end, entries }))
    },

    async variants(word, { limit = 5 } = {}) {
      const list = await syllables()
      if (!Object.keys(list).length) return []
      const written = word.trim().normalize('NFC').toLowerCase()
      const parts = written.split(/\s+/)
      const combos = accentCombinations(parts, syllablesByPlain(list), {
        perUnit: parts.length === 1 ? VARIANT_FORMS_ONE_SYLLABLE : VARIANT_FORMS_PER_SYLLABLE,
        max: MAX_VARIANT_COMBINATIONS,
      }).filter((c) => c !== written)
      // Each form as written in lowercase and capitalized, for names ("nhat" → "Nhật", Japan; "nhat ban" →
      // "Nhật Bản").
      const forms = [...new Set(combos.flatMap((c) => [c, c.replace(/(^|\s)(\S)/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())]))]
      // Each form counts only as its own headword (lookup also finds other cases: "nhật" finds "Nhật"), and a
      // capitalized one only when it's more than a person's name (a place, a people), so given names don't
      // crowd out words.
      const found = (await Promise.all(forms.map(async (c) => ({ word: c, entries: await lookup(c) })))).map((v) => ({
        ...v,
        entries: v.entries.filter((e) =>
          v.word === v.word.toLowerCase()
            ? !(e.word !== v.word && e.word.toLowerCase() === v.word)
            : e.word === v.word && e.senses.some((s) => !PERSONAL_NAME.test(s.glosses[0] ?? '')),
        ),
      }))
      const frequency = (v: { word: string; entries: Entry[] }) => {
        const known = v.entries.map((e) => e.frequency).filter((f): f is number => f !== undefined)
        return known.length ? Math.max(...known) : parts.length === 1 ? list[v.word.toLowerCase()] || undefined : undefined
      }
      // Most common first; ties (and unknown frequencies) keep the order of more common syllable forms.
      return found
        .filter((v) => v.entries.length)
        .map((v) => ({ ...v, frequency: frequency(v) }))
        .sort((a, b) => (b.frequency ?? -1) - (a.frequency ?? -1))
        .slice(0, limit)
    },

    async searchEnglish(term, { region, pos, exclude = DEFAULT_EXCLUDED_LABELS, limit = 10, allSenses = false } = {}) {
      const key = normalizeEnglish(term)
      if (!key) return []
      const m = await meta()
      const wanted = resolveRegion(m, region)
      const inWanted = (h: Hit) => !wanted || h.regions.some((r) => wanted.has(r))
      const hits = ((await shard<EnglishShard>('en', key))?.[key] ?? []).map((h) => fromStored(h, m.regions))
      const excluded = new Set(exclude)
      const regional = (h: Hit) => Boolean(wanted && h.regionTagged)
      // Best first: the English term is the gloss's main meaning, the word is tagged for the requested
      // region, the word is plain rather than slang or literary, the word is common (has more senses),
      // then the word's earlier senses.
      const ranked = hits
        .filter((h) => !h.labels.some((l) => excluded.has(l)))
        .filter(inWanted)
        .filter((h) => !pos || pos.includes(h.pos))
        .sort(
          (a, b) =>
            Number(b.primary) - Number(a.primary) ||
            Number(regional(b)) - Number(regional(a)) ||
            LABEL_PENALTY(a) - LABEL_PENALTY(b) ||
            // Common words first: wordfreq's frequency when the data has it, else the number of senses.
            (b.frequency ?? 0) - (a.frequency ?? 0) ||
            b.senses - a.senses ||
            a.senseIndex - b.senseIndex,
        )
      // One result per word, its best-ranked sense (or every sense of the first `limit` words).
      const seen = new Set<string>()
      const words = ranked.filter((h) => !seen.has(h.word) && seen.add(h.word)).slice(0, limit)
      if (!allSenses) return words
      const kept = new Set(words.map((h) => h.word))
      return ranked.filter((h) => kept.has(h.word))
    },

    async picks() {
      const m = await meta()
      return m.picks ? loadOnce<PickRow[]>('picks.json') : []
    },

    async frames() {
      const m = await meta()
      if (!m.frames) return { frames: [], words: {} }
      const stored = await loadOnce<StoredFramesData>('frames.json')
      return {
        frames: stored.frames,
        words: Object.fromEntries(Object.entries(stored.words).map(([k, w]) => [k, { ...w, choices: w.choices.map((c) => fromStored(c, m.regions)) }])),
      }
    },

    async pronouns({ listener, region, speaker, exclude = DEFAULT_EXCLUDED_LABELS } = {}) {
      const m = await meta()
      if (!m.pronouns) return []
      const rows = await loadOnce<StoredPronounRow[]>('pronouns.json')
      if (listener && !rows.some((r) => r.id === listener)) {
        throw new Error(`which-dialect: unknown listener "${listener}" for ${m.name}. Use one of: ${rows.map((r) => r.id).join(', ')}`)
      }
      const wanted = resolveRegion(m, region)
      const excluded = new Set(exclude)
      const keep = (c: PronounRow['self'][number]) =>
        (!wanted || c.regions.some((r) => wanted.has(r))) &&
        (!speaker || !c.speaker || c.speaker === speaker) &&
        !c.labels.some((l) => excluded.has(l))
      return rows
        .filter((r) => !listener || r.id === listener)
        .map((r) => {
          const row = { ...r } as PronounRow
          for (const person of PRONOUN_PERSONS) row[person] = (r[person] ?? []).map((c) => fromStored(c, m.regions)).filter(keep)
          return row
        })
    },
  }
}

export * from './translate.ts'
export * from './check.ts'
export * from './text.ts'
export * from './phrasebook.ts'
export * from './review.ts'
export * from './detect.ts'
