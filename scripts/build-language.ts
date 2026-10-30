// Builds one language's data package from Kaikki's Wiktionary extraction.
//
//   node --experimental-strip-types scripts/build-language.ts vi [--refresh]
//
// Downloads kaikki.org's JSONL for the language (cached in .cache/, --refresh re-downloads), keeps the
// fields a learner needs, and writes packages/<lang>/data/: meta.json, words/<shard>.json (by headword),
// en/<shard>.json (English term -> words) and, when the config has them, pronouns.json (see pronouns.ts)
// and picks.json (see picks.ts).
// The data is CC BY-SA 4.0 (see packages/<lang>/LICENSE).

import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  PERSONAL_NAME,
  PRONOUN_PERSONS,
  glossTerms,
  shardKey,
  toStored,
  type EnglishShard,
  type Entry,
  type Hit,
  type LanguageMeta,
  type Sense,
  type StoredPronounRow,
  type WordShard,
  type FormShard,
  type StoredForm,
} from '../packages/core/src/types.ts'
import { recordDataUpdate } from './data-updates.ts'
import { buildFrames } from './frames.ts'
import { writePicks } from './picks.ts'
import { buildPronounTable } from './pronouns.ts'
import { loadFrequencies, WORDFREQ_CREDIT } from './frequency.ts'
import type { LanguageConfig } from './language-config.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Source tags kept as usage labels. Grammar tags (transitive, alt-of, …) are left out.
const LABELS = new Set([
  'colloquial', 'informal', 'slang', 'Internet', 'familiar', 'endearing', 'humorous', 'euphemistic',
  'formal', 'polite', 'honorific', 'literary', 'dated', 'archaic', 'obsolete', 'historical', 'rare',
  'uncommon', 'neologism', 'dialectal', 'figuratively', 'idiomatic', 'abbreviation',
  'derogatory', 'disapproving', 'offensive', 'vulgar',
])

// A subpage title's suffix: "/languages A to L", "/languages M to Z".
const SUBPAGE = /\/languages [A-Z] to [A-Z]$/

// Kaikki JSONL fields this script reads.
type KaikkiSense = {
  glosses?: string[]
  tags?: string[]
  raw_tags?: string[]
  topics?: string[]
  synonyms?: { word: string }[]
  examples?: { text?: string; translation?: string; english?: string; type?: string }[]
  translations?: { word?: string; lang_code?: string; code?: string; tags?: string[] }[]
  alt_of?: { word: string }[]
  form_of?: { word: string }[]
  categories?: (string | { name?: string; kind?: string; parents?: string[] })[]
}
type KaikkiTranslation = NonNullable<KaikkiSense['translations']>[number] & { sense?: string }
type KaikkiEntry = {
  word: string
  pos: string
  senses?: KaikkiSense[]
  synonyms?: { word: string; sense?: string }[]
  translations?: KaikkiTranslation[]
}

// Synonyms kept per sense; enough for dialect equivalents without bloating large languages.
const MAX_SYNONYMS = 8
// Translation-table tags worth keeping: places (capitalized, e.g. South, North-America) and register.
// Grammatical tags (masculine, direct-object, …) are dropped.
const TABLE_REGISTER_TAGS = new Set(['colloquial', 'informal', 'formal', 'polite', 'familiar', 'slang', 'vulgar', 'archaic', 'dated', 'rare', 'literary'])
const MAX_TABLE_WORDS = 12

function pickTranslations(raw: KaikkiSense['translations'], langs: string[] | undefined): Sense['translations'] {
  if (!raw?.length || !langs?.length) return undefined
  const out: NonNullable<Sense['translations']> = {}
  for (const t of raw) {
    const lang = t.lang_code ?? t.code
    if (!lang || !langs.includes(lang) || !t.word) continue
    // "(leísmo) les" -> "les", "mueble (El Norte)" -> "mueble"; placeholders like "various" are skipped.
    const word = t.word.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    if (!word || word === 'various' || word === '-' || word.length > 40) continue
    const list = (out[lang] ??= [])
    if (list.length >= MAX_TABLE_WORDS || list.some((x) => x.word === word)) continue
    const tags = (t.tags ?? []).filter((tag) => /^[A-Z]/.test(tag) || TABLE_REGISTER_TAGS.has(tag))
    list.push(tags.length ? { word, tags } : { word })
  }
  return Object.keys(out).length ? out : undefined
}

// Longer examples are usually literary quotations, not everyday sentences.
const MAX_EXAMPLE_LENGTH = 160

// Short everyday examples ("example") before quotations; with a translation first for non-English words.
function pickExamples(raw: KaikkiSense['examples'], max: number): Sense['examples'] {
  const usable = (raw ?? [])
    .filter((x) => x.text && x.text.length <= MAX_EXAMPLE_LENGTH)
    .map((x, i) => ({ x, i, rank: (x.type === 'example' ? 0 : 2) + (x.translation || x.english ? 0 : 1) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, max)
    .map(({ x }) => {
      const translation = x.translation ?? x.english
      return { text: x.text!.trim(), ...(translation ? { translation: translation.trim() } : {}) }
    })
  return usable.length ? usable : undefined
}

// Words that say nothing about which meaning a translation-table label is for.
const LABEL_STOPWORDS = new Set('the and for with from that this any used'.split(' '))
const labelWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !LABEL_STOPWORDS.has(w))
      .map((w) => w.replace(/s$/, '')),
  )

/**
 * Kaikki puts some translation tables on the entry instead of a sense (English "I", "boy", "friend"),
 * each row labelled with a short description of the meaning ("personal pronoun", "aircraft type"). Each
 * label's rows go to the sense whose definitions share the most words with the label, else the first
 * sense. A sense's own table for a language wins over these.
 */
function attachEntryTranslations(raw: KaikkiTranslation[] | undefined, senses: Sense[], langs: string[] | undefined) {
  if (!raw?.length || !langs?.length || !senses.length) return
  const byLabel = new Map<string, KaikkiTranslation[]>()
  for (const t of raw) byLabel.set(t.sense ?? '', [...(byLabel.get(t.sense ?? '') ?? []), t])
  const senseWords = senses.map((s) => labelWords(s.glosses.join(' ')))
  for (const [label, rows] of byLabel) {
    const table = pickTranslations(rows, langs)
    if (!table) continue
    const wanted = labelWords(label)
    let best = 0
    let bestScore = 0
    senseWords.forEach((words, i) => {
      let score = 0
      for (const w of wanted) if (words.has(w)) score++
      if (score > bestScore) [best, bestScore] = [i, score]
    })
    const target = senses[best]
    for (const [lang, list] of Object.entries(table)) {
      if (!target.translations?.[lang]) target.translations = { ...target.translations, [lang]: list }
    }
  }
}

async function download(config: LanguageConfig, refresh: boolean) {
  const url = `https://kaikki.org/dictionary/${config.kaikkiName}/kaikki.org-dictionary-${config.kaikkiName}.jsonl`
  const file = join(ROOT, '.cache', `kaikki-${config.lang}.jsonl`)
  const infoFile = `${file}.info.json`
  if (!refresh && existsSync(file) && existsSync(infoFile)) {
    console.log(`Using cached ${file} (pass --refresh to re-download)`)
    return { file, url, ...(JSON.parse(await readFile(infoFile, 'utf8')) as { lastModified: string | null; retrieved: string }) }
  }
  console.log(`Downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  const info = { lastModified: res.headers.get('last-modified'), retrieved: new Date().toISOString() }
  await writeFile(infoFile, JSON.stringify(info))
  return { file, url, ...info }
}

// Proper names that are places ("Japan"), from Wiktionary's place categories: 'country' for countries,
// else 'place'. The categories are the page's, attached to whichever sense (Vietnamese "Nhật" has
// "Countries in Asia" on its given-name sense), so they're read per entry, and the entry's senses that
// aren't personal names are its place senses. Only those senses of proper names are indexed for English
// search (see LanguageConfig.placeNames). Build-time only; not stored.
const PLACE_ENTRIES = new WeakMap<Entry, 'country' | 'place'>()
// Names kept only as places (their part of speech is skipped otherwise): non-country ones are dropped
// below placeNames.minZipf once frequencies are known.
const PLACE_ONLY = new WeakSet<Entry>()

function placeKind(raw: KaikkiEntry): 'country' | 'place' | null {
  const categories = (raw.senses ?? []).flatMap((s) => s.categories ?? []).filter((c) => typeof c === 'object')
  if (!categories.some((c) => c.kind === 'place')) return null
  return categories.some((c) => c.name?.startsWith('Countries') || c.parents?.includes('Countries')) ? 'country' : 'place'
}

/** Whether a sense of an entry is a place name: a place entry's sense that isn't a personal name. */
const isPlaceSense = (e: Entry, s: Sense) => PLACE_ENTRIES.has(e) && !PERSONAL_NAME.test(s.glosses[0] ?? '')

// Inflected forms for a language with a forms index (LanguageConfig.formsIndex): form → its lemmas, each
// with its part of speech and what form it is. The description is the gloss up to the lemma, which becomes
// "{}" ("first-person singular present indicative of {}"), so the few hundred kinds of form are stored once
// (in meta.json). Verb forms come as a heading and the form ("inflection of hablar:", "first-person singular
// present indicative"); notes after the lemma ("…of muy, synonym of …") and the phrase a reflexive form is
// used in ("only used in te querelles, …") are dropped.
const FORMS = new Map<string, { lemma: string; pos: string; description: string }[]>()

function formDescription(lemma: string, glosses: string[]): string {
  const [first, ...rest] = glosses
  // The lemma as a whole word ("ir" in "first-person singular preterite indicative of ir", not in "first").
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const at = first.search(new RegExp(`(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, 'u'))
  // Reflexive verb forms name the phrase they're used in ("only used in te querelles, second-person …"):
  // the kind of form is the rest.
  const before = (at >= 0 ? first.slice(0, at).trim() : 'form of').replace(/^only used in [^,]+, /i, '')
  // "inflection of {}:" followed by the form itself.
  if (rest.length && /^inflection of$/i.test(before)) return `${rest[rest.length - 1].replace(/[.:;]$/, '')} of {}`
  return `${before} {}`
}

function addForm(form: string, lemma: string, pos: string, glosses: string[]) {
  const description = formDescription(lemma, glosses)
  const list = FORMS.get(form) ?? []
  if (!list.some((f) => f.lemma === lemma && f.pos === pos && f.description === description)) list.push({ lemma, pos, description })
  FORMS.set(form, list)
}

async function readEntries(file: string, config: LanguageConfig): Promise<Entry[]> {
  const skipPos = new Set(config.skipPos ?? [])
  const dropLabels = new Set(config.dropLabels ?? [])
  const cut = (g: string) =>
    config.maxGlossLength && g.length > config.maxGlossLength ? `${g.slice(0, config.maxGlossLength - 1).trimEnd()}…` : g
  const entries: Entry[] = []
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    const raw = JSON.parse(line) as KaikkiEntry
    // Wiktionary splits very long pages into subpages ("i/languages M to Z" for the letter i), and Kaikki
    // uses the subpage title as the word.
    raw.word = raw.word.replace(SUBPAGE, '')
    // Proper names of a language that skips them still keep their place senses, with placeNames.
    const place = raw.pos === 'name' && config.placeNames ? placeKind(raw) : null
    const placesOnly = raw.pos === 'name' && skipPos.has('name') && Boolean(place)
    if ((skipPos.has(raw.pos) && !placesOnly) || (config.keepWord && !config.keepWord(raw.word))) continue
    if (config.dropTechnical && raw.senses?.length && raw.senses.every((s) => s.topics?.length)) continue
    const senses: Sense[] = []
    for (const s of raw.senses ?? []) {
      const glosses = (s.glosses ?? []).filter((g) => g.trim()).map(cut)
      if (glosses.length === 0) continue
      if (placesOnly && PERSONAL_NAME.test(glosses[0])) continue
      const tags = s.tags ?? []
      // Inflections are dropped (all of them, or outside formOfPos), but spelling/dialect variants ("alt-of") are kept.
      const inflection = tags.includes('form-of') && !tags.includes('alt-of')
      // With a forms index, inflections go there instead (one per form, lemma and kind of form).
      if (inflection && config.formsIndex) {
        const lemma = s.form_of?.[0]?.word
        if (lemma && lemma !== raw.word && (config.formsIndex.keep?.(tags, raw.pos) ?? true)) addForm(raw.word, lemma, raw.pos, glosses)
        continue
      }
      if (inflection && (config.skipFormOf || (config.formOfPos && !config.formOfPos.includes(raw.pos)))) continue
      const lemma = s.form_of?.[0]?.word
      if (inflection && lemma && config.keepFormOf && !config.keepFormOf(raw.word, lemma, raw.pos)) continue
      if (tags.some((t) => dropLabels.has(t))) continue
      const tagged = config.regionsFromTags(tags, s.raw_tags ?? [])
      const sense: Sense = {
        glosses,
        // The rule for untagged senses: they belong to every region. (Shared array: stored files omit it.)
        regions: tagged.length > 0 ? config.regions.filter((r) => tagged.includes(r)) : config.regions,
        regionTagged: tagged.length > 0,
        labels: tags.filter((t) => LABELS.has(t)),
      }
      // Never on an entry's first sense: that's its main meaning, technical or not ("gold" the metal,
      // "circle" the shape); only later senses are moved after everyday ones.
      for (const { label, topics, gloss } of senses.length ? (config.senseLabels ?? []) : []) {
        const match = (topics && s.topics?.some((t) => topics.includes(t))) || (gloss && glosses.some((g) => gloss.test(g)))
        if (match && !sense.labels.includes(label)) sense.labels.push(label)
      }
      const altOf = s.alt_of?.[0]?.word ?? s.form_of?.[0]?.word
      if (altOf) sense.altOf = altOf
      const synonyms = [...new Set((s.synonyms ?? []).map((x) => x.word).filter((w) => w && w !== raw.word))]
      if (synonyms.length) sense.synonyms = synonyms.slice(0, MAX_SYNONYMS)
      const examples = pickExamples(s.examples, config.maxExamples ?? 2)
      if (examples) sense.examples = examples
      const translations = pickTranslations(s.translations, config.translationLangs)
      if (translations) sense.translations = translations
      senses.push(sense)
    }
    attachEntryTranslations(raw.translations, senses, config.translationLangs)
    // Entry-level synonyms (not tied to a sense) belong to the main meaning.
    const entrySynonyms = (raw.synonyms ?? []).filter((x) => !x.sense).map((x) => x.word).filter((w) => w && w !== raw.word)
    if (entrySynonyms.length && senses.length) {
      senses[0].synonyms = [...new Set([...(senses[0].synonyms ?? []), ...entrySynonyms])].slice(0, MAX_SYNONYMS)
    }
    if (senses.length > 0) {
      const entry: Entry = { word: raw.word, pos: raw.pos, senses: config.maxSensesPerEntry ? senses.slice(0, config.maxSensesPerEntry) : senses }
      if (place) PLACE_ENTRIES.set(entry, place)
      if (placesOnly) PLACE_ONLY.add(entry)
      entries.push(entry)
    }
  }
  return entries
}


// Proper names aren't translations of English words, so they're left out of the English index (they can
// still be looked up by word), except place names, with placeNames: "Japan" finds "Nhật Bản".
const NOT_IN_ENGLISH_INDEX = new Set(['name'])

function buildEnglishIndex(entries: Entry[], regionalOnly = false): Map<string, Hit[]> {
  const frequency = new Map(entries.map((e) => [e.word, e.frequency]))
  // Variant senses ("Southern Vietnam form of không") get the English terms of the word they point to,
  // from that word's senses that aren't themselves variants, preferring the same part of speech
  // (the pronoun "tui" takes the pronoun meanings of "tôi", not its noun "servant").
  const mainGlosses = new Map<string, string[]>()
  const add = (key: string, glosses: string[]) => mainGlosses.set(key, [...(mainGlosses.get(key) ?? []), ...glosses])
  for (const e of entries) {
    const glosses = e.senses.filter((s) => !s.altOf).flatMap((s) => s.glosses)
    if (!glosses.length) continue
    add(`${e.word}\u0000${e.pos}`, glosses)
    add(e.word, glosses)
  }

  // How many senses a word has across all its entries: a rough stand-in for how common it is, since
  // the source has no frequency data (everyday words like "chờ" or "mẹ" have many; obscure ones, one).
  const senseCount = new Map<string, number>()
  for (const e of entries) senseCount.set(e.word, (senseCount.get(e.word) ?? 0) + e.senses.length)

  const index = new Map<string, Hit[]>()
  const seen = new Set<string>()
  entries.forEach((e, entryIndex) => {
    const placesOnly = NOT_IN_ENGLISH_INDEX.has(e.pos)
    e.senses.forEach((sense, senseIndex) => {
      if (placesOnly && !isPlaceSense(e, sense)) return
      if (regionalOnly && !sense.regionTagged) return
      const sources = sense.altOf
        ? (mainGlosses.get(`${sense.altOf}\u0000${e.pos}`) ?? mainGlosses.get(sense.altOf) ?? [])
        : sense.glosses
      for (const gloss of sources) {
        for (const [term, position] of glossTerms(gloss)) {
          // Per entry: a word can have several entries with the same part of speech (one per etymology;
          // Vietnamese "ta" has two pronouns), and each entry's sense 0 is a different sense.
          const id = `${term}\u0000${entryIndex}\u0000${senseIndex}`
          if (seen.has(id)) continue
          seen.add(id)
          const hit: Hit = {
            word: e.word,
            pos: e.pos,
            gloss: sense.glosses[0],
            regions: sense.regions,
            regionTagged: sense.regionTagged,
            labels: sense.labels,
            senseIndex,
            senses: senseCount.get(e.word) ?? 1,
            ...(frequency.get(e.word) !== undefined ? { frequency: frequency.get(e.word) } : {}),
            primary: position === 0,
          }
          if (sense.altOf) hit.altOf = sense.altOf
          index.set(term, [...(index.get(term) ?? []), hit])
        }
      }
    })
  })
  for (const hits of index.values()) hits.sort((a, b) => Number(b.primary) - Number(a.primary) || a.senseIndex - b.senseIndex)
  return index
}

async function writeShards<T>(dir: string, items: Map<string, T>, shardLength: number): Promise<string[]> {
  const shards = new Map<string, Record<string, T>>()
  for (const [key, value] of [...items].sort(([a], [b]) => a.localeCompare(b))) {
    const shard = shardKey(key, shardLength)
    if (!shards.has(shard)) shards.set(shard, {})
    shards.get(shard)![key] = value
  }
  await mkdir(dir, { recursive: true })
  for (const [shard, data] of shards) await writeFile(join(dir, `${shard}.json`), JSON.stringify(data))
  return [...shards.keys()].sort()
}

async function main() {
  const [lang, ...flags] = process.argv.slice(2)
  if (!lang) throw new Error('Usage: build-language.ts <lang> [--refresh]')
  const config = (await import(join(ROOT, 'languages', `${lang}.ts`))).default as LanguageConfig
  for (const [group, members] of Object.entries(config.regionGroups ?? {})) {
    const unknown = members.filter((m) => !config.regions.includes(m))
    if (unknown.length) throw new Error(`Region group "${group}" has regions not in config.regions: ${unknown.join(', ')}`)
  }
  const source = await download(config, flags.includes('--refresh'))

  let entries = await readEntries(source.file, config)
  if (config.wordfreq) {
    const freq = await loadFrequencies(ROOT, config.lang, config.wordfreq)
    for (const e of entries) {
      const f = freq(e.word)
      if (f !== undefined) e.frequency = f
    }
    console.log(`Frequencies: ${entries.filter((e) => e.frequency !== undefined).length} of ${entries.length} entries`)
  }
  // Names kept only as places: countries always; other places when common enough, and not also an
  // ordinary word, whose frequency they'd borrow and whose capitalized form they'd take over ("Well", a
  // village: "Well, …" isn't a place; nor "Reading", "Bath", "Nice").
  const minZipf = config.placeNames?.minZipf
  if (minZipf !== undefined) {
    const words = new Set(entries.filter((e) => e.pos !== 'name').map((e) => e.word.toLowerCase()))
    entries = entries.filter((e) => !PLACE_ONLY.has(e) || PLACE_ENTRIES.get(e) === 'country' || ((e.frequency ?? -Infinity) >= minZipf && !words.has(e.word.toLowerCase())))
  }
  const places = entries.filter((e) => PLACE_ENTRIES.has(e))
  if (config.placeNames) console.log(`Place names: ${places.length} (${places.filter((e) => PLACE_ENTRIES.get(e) === 'country').length} countries)`)
  const byWord = new Map<string, Entry[]>()
  for (const e of entries) byWord.set(e.word, [...(byWord.get(e.word) ?? []), e])
  const english =
    config.englishIndex === false ? new Map<string, Hit[]>() : buildEnglishIndex(entries, config.englishIndex === 'regional')
  const shardLength = config.shardLength ?? 2

  const outDir = join(ROOT, 'packages', lang, 'data')
  await rm(outDir, { recursive: true, force: true })
  const storedWords = new Map<string, WordShard[string]>(
    [...byWord].map(([w, es]) => [w, es.map((e) => ({ ...e, senses: e.senses.map((s) => toStored(s)) }))]),
  )
  const storedEnglish = new Map<string, EnglishShard[string]>(
    [...english].map(([t, hits]) => [t, hits.map((h) => toStored(h))]),
  )
  const wordShards = await writeShards(join(outDir, 'words'), storedWords, shardLength)
  const enShards = await writeShards(join(outDir, 'en'), storedEnglish, shardLength)

  // The forms index: descriptions numbered by how often they're used, each form with its frequency.
  let formShards: string[] = []
  let formsMeta: LanguageMeta['forms']
  if (config.formsIndex) {
    const freq = config.wordfreq ? await loadFrequencies(ROOT, config.lang, config.wordfreq) : () => undefined
    const uses = new Map<string, number>()
    for (const list of FORMS.values()) for (const f of list) uses.set(f.description, (uses.get(f.description) ?? 0) + 1)
    const descriptions = [...uses.keys()].sort((a, b) => uses.get(b)! - uses.get(a)!)
    const index = new Map(descriptions.map((d, i) => [d, i]))
    const stored = new Map<string, FormShard[string]>(
      [...FORMS].map(([form, list]) => {
        const f = freq(form)
        return [form, list.map((x): StoredForm => (f !== undefined ? [x.lemma, x.pos, index.get(x.description)!, f] : [x.lemma, x.pos, index.get(x.description)!]))]
      }),
    )
    formShards = await writeShards(join(outDir, 'forms'), stored, shardLength)
    formsMeta = { descriptions, count: FORMS.size }
    console.log(`Forms index: ${FORMS.size} forms, ${descriptions.length} kinds of form`)
  }

  if (config.pronouns) {
    const { rows, report } = buildPronounTable(entries, config.pronouns, config.regions)
    const stored: StoredPronounRow[] = rows.map((r) => {
      const row: StoredPronounRow = {
        id: r.id,
        label: r.label,
        ...(r.default ? { default: true } : {}),
        ...(r.respect ? { respect: true } : {}),
        ...(r.warning ? { warning: r.warning } : {}),
      }
      for (const person of PRONOUN_PERSONS) if (r[person].length) row[person] = r[person].map((c) => toStored(c))
      return row
    })
    await writeFile(join(outDir, 'pronouns.json'), JSON.stringify(stored))
    console.log(
      `Pronoun table: ${rows.length} rows, ${report.fromGlosses} words from definitions, ` +
        `${report.rules} from grammar rules, ${report.overrides} overrides`,
    )
    for (const p of report.problems) console.warn(`  WARNING: ${p}`)
  }

  if (config.checker) {
    await writeFile(join(outDir, 'checker.json'), JSON.stringify(config.checker))
    if (config.checker.units === 'syllables') {
      // Every syllable of the headwords, with its frequency: the checker suggests accents from it.
      const freq = config.wordfreq ? await loadFrequencies(ROOT, config.lang, config.wordfreq) : () => undefined
      const syllables: Record<string, number> = {}
      for (const e of entries) {
        for (const s of e.word.toLowerCase().normalize('NFC').split(/[\s-]+/)) {
          if (/^[\p{L}\p{M}]+$/u.test(s) && !(s in syllables)) syllables[s] = freq(s) ?? 0
        }
      }
      await writeFile(join(outDir, 'syllables.json'), JSON.stringify(syllables))
      console.log(`Checker: ${Object.keys(syllables).length} syllables`)
    }
  }

  if (config.frames) {
    const { data, report } = buildFrames(entries, config)
    await writeFile(join(outDir, 'frames.json'), JSON.stringify(data))
    console.log(`Sentence frames: ${report.frames} frames, ${report.fromGlosses} words from definitions, ${report.overrides} overrides`)
    for (const p of report.problems) console.warn(`  WARNING: ${p}`)
  }

  const senses = entries.flatMap((e) => e.senses)
  const meta: LanguageMeta = {
    lang: config.lang,
    name: config.name,
    regions: config.regions,
    ...(config.regionGroups ? { regionGroups: config.regionGroups } : {}),
    source: {
      name: 'Wiktionary, via Kaikki.org (wiktextract)',
      url: source.url,
      retrieved: source.retrieved,
      lastModified: source.lastModified,
    },
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    ...(config.wordfreq ? { frequencySource: WORDFREQ_CREDIT } : {}),
    counts: {
      entries: entries.length,
      senses: senses.length,
      regionTaggedSenses: senses.filter((s) => s.regionTagged).length,
      englishTerms: english.size,
    },
    shards: { words: wordShards, en: enShards, ...(formShards.length ? { forms: formShards } : {}) },
    ...(shardLength !== 2 ? { shardLength } : {}),
    ...(config.pronouns ? { pronouns: true } : {}),
    ...(config.checker ? { checker: true } : {}),
    ...(config.checker?.units === 'syllables' ? { syllables: true } : {}),
    ...(config.frames ? { frames: true } : {}),
    ...(formsMeta ? { forms: formsMeta } : {}),
  }
  await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writePicks(config)
  await recordDataUpdate(ROOT, { lang: config.lang, name: config.name, lastModified: source.lastModified, retrieved: source.retrieved, entries: entries.length })

  let bytes = 0
  for (const [sub, names] of [['words', wordShards], ['en', enShards], ['forms', formShards]] as const) {
    for (const n of names) bytes += (await stat(join(outDir, sub, `${n}.json`))).size
  }
  console.log(`${config.name}: ${meta.counts.entries} entries, ${meta.counts.senses} senses ` +
    `(${meta.counts.regionTaggedSenses} region-tagged), ${meta.counts.englishTerms} English terms, ` +
    `${(bytes / 1e6).toFixed(1)} MB in ${wordShards.length + enShards.length} files`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
