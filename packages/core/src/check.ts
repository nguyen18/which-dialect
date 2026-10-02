// Checking text in one language. By default it's a spellchecker that gives a correction for every word it
// can: syllables that aren't in the language get their accented forms ("khong" → "không"), and words in the
// learner's own language (English by default) get the target-language word ("market" → "chợ"). Further
// checks are opt-in (`rules`): words from another region, pronouns and polite endings that fit who you're
// talking to, and consistency within the text.
//
// Every rule reads only the language's data: its dictionary, pronoun table, checker.json and
// syllables.json (see CheckerConfig). Adding a language means adding data and settings in
// languages/<lang>.ts, not code here. A rule whose data a language doesn't have is skipped.
//
// The checker only speaks up when it's confident and stays silent otherwise, so no issues means none of
// the checks found anything, not that the text is correct.

import { createDictionary, resolveRegion, type Dictionary } from './index.ts'
import { accentCombinations, joined, matchCase, plain, segment, sentencesOf, spellingCandidates, syllablesByPlain, units, type Unit, type Word } from './text.ts'
import { markLanguages } from './detect.ts'
import { createTranslator, type Translator, type TranslatorOptions } from './translate.ts'
import {
  PRONOUN_PERSONS,
  type CheckerConfig,
  type Entry,
  type LanguageMeta,
  type PronounPerson,
  type PronounRow,
} from './types.ts'

export type CheckRule =
  | 'spelling'
  | 'foreign-word'
  | 'dialect'
  | 'pronoun-relationship'
  | 'pronoun-pair'
  | 'pronoun-consistency'
  | 'polite-ending'

/**
 * Which checks run unless `rules` says otherwise: the spellchecker (spelling, and words in the learner's
 * own language, with their translation). The rest are opt-in, e.g. `rules: { dialect: true }`.
 */
export const DEFAULT_CHECK_RULES: Record<CheckRule, boolean> = {
  spelling: true,
  'foreign-word': true,
  dialect: false,
  'pronoun-relationship': false,
  'pronoun-pair': false,
  'pronoun-consistency': false,
  'polite-ending': false,
}

export type CheckIssue = {
  rule: CheckRule
  /**
   * 'error': almost certainly wrong (not a word of the language). 'warning': wrong for the chosen region
   * or relationship. 'suggestion': often better; worth a look.
   */
  severity: 'error' | 'warning' | 'suggestion'
  /** Character offsets of `text` in the checked text (`CheckResult.text`, the input in Unicode NFC form). */
  start: number
  end: number
  /** The text the issue is about. */
  text: string
  /** One sentence for the learner, e.g. “khong” isn't a Vietnamese syllable. Did you mean “không”? */
  message: string
  /** Replacements for `text`, best first; empty when there's nothing specific to suggest. */
  suggestions: string[]
}

export type CheckOptions = {
  /** Language code of the text, e.g. "vi". */
  lang: string
  /**
   * The learner's own language, whose words in the text are translated (`foreign-word`). Default "en";
   * none when it's the text's language.
   */
  base?: string
  /**
   * Region or region group the text should be in, e.g. "Southern": translations use its words, and the
   * `dialect` check flags other regions' words (without it, mixed regions).
   */
  region?: string
  /** 'casual' allows colloquial translations (Southern "tui"); otherwise plain ones come first. */
  register?: 'casual' | 'neutral' | 'polite'
  /** Who you're talking to, as a pronoun-table row id (see Dictionary.pronouns), e.g. "parent". */
  listener?: string
  /** Who you're talking about, as a pronoun-table row id, for "he/she" and "they" pronouns. */
  about?: string
  /** The speaker's gender, for pronouns that depend on it. */
  speaker?: 'male' | 'female'
  /**
   * Turn checks on or off. By default only the spellchecker runs (DEFAULT_CHECK_RULES: `spelling` and
   * `foreign-word`); opt in to others, e.g. { dialect: true, 'pronoun-relationship': true }.
   */
  rules?: Partial<Record<CheckRule, boolean>>
}

export type CheckResult = {
  /** The checked text: the input in Unicode NFC form, which the issues' offsets refer to. */
  text: string
  /** Sorted by position. */
  issues: CheckIssue[]
  /** The text split by language (the target and the base), in order; one part when no base is given. */
  parts: { text: string; lang: string; start: number; end: number }[]
}

export type Checker = {
  check(text: string, options: CheckOptions): Promise<CheckResult>
}

/** Same as the translator's: where each language's data comes from. */
export type CheckerOptions = TranslatorOptions

// How each pronoun-table column is named in messages.
const PERSON_NAMES: Record<PronounPerson, string> = {
  self: 'I', addressee: 'you', third: 'he/she', selfPlural: 'we', addresseePlural: 'you (plural)', thirdPlural: 'they',
}
// Columns chosen by `about` (who you're talking about); the rest by `listener`.
const ABOUT_PERSONS = new Set<PronounPerson>(['third', 'thirdPlural'])
const SELF_PERSONS = new Set<PronounPerson>(['self', 'selfPlural'])
const ADDRESSEE_PERSONS = new Set<PronounPerson>(['addressee', 'addresseePlural'])

type Sentence = { units: Unit[]; words: Word[]; langs: string[] }
type PronounMatch = { text: string; lower: string; start: number; end: number; person: PronounPerson; sentence: number }

type Context = {
  text: string
  options: CheckOptions
  meta: LanguageMeta
  config: CheckerConfig
  sentences: Sentence[]
  dict: Dictionary
  rows: () => Promise<PronounRow[]>
  pronounMatches: () => PronounMatch[]
  suggestRegional: (word: Word, region: string) => Promise<string[]>
  /** The learner's own language, or undefined when not checked. */
  base: string | undefined
  /** Whether a unit is in the base language (by its start offset). */
  inBase: (u: Unit) => boolean
  translator: Translator
}

const quote = (s: string) => `“${s}”`
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const listOf = (items: string[], conjunction = 'and') =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
const unique = <T>(items: T[]) => [...new Set(items)]

// --- Rules -----------------------------------------------------------------------------------------------

// Spelling and accents, for languages written in syllables with a syllable list (with frequencies):
// - a syllable that isn't in the language is flagged, with the accented forms it could be ("khong" →
//   "không"); plain-letter syllables with no accented form are left alone (names, foreign words: "email");
// - a plain-letter syllable that is a word but a rare one, next to a much more common accented form, is
//   probably missing its accents ("toi" → "tôi", "hom" → "hôm"). In a sentence typed without accents (at
//   least half plain letters and a missing-accents error already, or 3+ words with no accent at all; half,
//   because filled-in sentence frames add accented words), any accented form that's more common
//   counts ("an" → "ăn"; but not "con" → "còn", about as common). Left alone: capitalized words
//   mid-sentence (names) and the language's listed pronouns, some written without accents ("tui").
// - a syllable that isn't in the language may also be a letter typo: one letter missing, extra, wrong or two
//   swapped ("khôg", "khôngg" → "không"; "họk" → "học"), with any accents (spellingCandidates). Plain-letter
//   ones count only when a one-letter fix gives a common syllable ("tihch" → "thích"); real syllables are
//   never letter-changed, so correct words stay.
// Not checked: abbreviations and names with a capital after the first letter ("GĐ", "TKiều"), and words
// with letters the language's syllables don't use (Chinese characters in Vietnamese text).
// First, a doubtful syllable (one of the above) is tried with its neighbors: when fixing its accents (or a
// letter) makes a dictionary word with them, that word is suggested for the run ("hom nay" → "hôm nay", not
// "hôm này"; "cảm ơm" → "cảm ơn", not "cảm ôm").
// Units inside a known word, or in the learner's own language, aren't checked.
// Zipf points by which an accented form must be more common than a plain-letter word to be suggested.
const ACCENTS_GAP = 1.5
const ACCENTS_GAP_UNACCENTED_TEXT = 0.2
// Accent forms tried per doubtful syllable when looking for a word with its neighbors, and how many
// combinations are looked up at most.
const COMPOUND_FORMS_PER_SYLLABLE = 5
const COMPOUND_MAX_COMBINATIONS = 64
// When none of a run's syllables is doubtful on its own (all real words written without accents, "mua sam"),
// its accented form is suggested only if one dictionary word clearly wins: ahead of the next by this many
// Zipf points ("ban an" could be "bản án" or "bàn ăn", equally common, so it's left alone).
const PLAIN_RUN_MARGIN = 0.5
// In a run that has accents elsewhere, only syllables less common than this (Zipf) may change that way: a
// common word left without accents next to accented ones is usually meant ("tháng sau", next month, isn't
// "tháng sáu", June). A run with no accents at all ("nha bang") was probably typed without them, so any of
// its syllables may change ("nhà băng", bank), still only when one word clearly wins.
const PLAIN_RUN_MAX_ZIPF = 5
// A plain-letter non-syllable with no accented form is checked as a typo only if a one-letter fix gives a
// syllable at least this common (Zipf); otherwise it's probably a name or a foreign word.
const PLAIN_TYPO_MIN_ZIPF = 4
// Candidates kept per misspelled syllable.
const SPELLING_CANDIDATES = 3

async function spelling(ctx: Context): Promise<CheckIssue[]> {
  if (ctx.config.units !== 'syllables' || !ctx.meta.syllables) return []
  const syllables = await ctx.dict.syllables()
  const byPlain = syllablesByPlain(syllables)
  const issues: CheckIssue[] = []
  const suggest = (u: Unit, candidates: string[], severity: CheckIssue['severity'], message: string) =>
    issues.push({ rule: 'spelling', severity, start: u.start, end: u.end, text: u.text, message, suggestions: candidates.map((c) => matchCase(u.text, c)) })
  const options = (u: Unit, candidates: string[]) => listOf(candidates.map((c) => quote(matchCase(u.text, c))), 'or')
  const pronouns = new Set(Object.values(ctx.config.pronouns ?? {}).flat().map((w) => w.toLowerCase()))
  // The language's letters (without accents), from its syllables: words using others aren't its own.
  const alphabet = new Set([...byPlain.keys()].join(''))
  const ownLetters = (u: Unit) => [...plain(u.text.toLowerCase()).replace(/[’']/g, '')].every((c) => alphabet.has(c))
  const abbreviation = (u: Unit) => /\p{Lu}/u.test(u.text.slice(1))

  for (const sentence of ctx.sentences) {
    const lone = sentence.words.filter((w) => !w.entries.length || w.units.length === 1).flatMap((w) => w.units).filter((u) => !ctx.inBase(u))
    const target = sentence.units.filter((u) => !ctx.inBase(u) && /\p{L}/u.test(u.text))
    const isPlain = (u: Unit) => u.text.toLowerCase() === plain(u.text.toLowerCase())
    const mostlyPlain = target.filter(isPlain).length >= target.length * 0.5
    const lowerOf = (u: Unit) => u.text.toLowerCase().replace(/[’']/g, '')
    const inWord = (u: Unit) => sentence.words.some((w) => w.entries.length && w.units.length > 1 && w.units.includes(u))
    // What each lone unit is: not a syllable of the language (with forms it could be), or a plain-letter
    // syllable that could be missing its accents.
    const checked = lone.filter((u) => !/\d/.test(lowerOf(u)) && !inWord(u) && !abbreviation(u) && ownLetters(u))
    const name = (u: Unit) => u !== sentence.units[0] && /\p{Lu}/u.test(u.text.charAt(0))
    // Each non-syllable's candidates: accents and one-letter changes, the writer's own accents first.
    const candidatesOf = new Map<Unit, string[]>()
    const similar = ctx.config.similarLetters ?? []
    const candidates = (u: Unit, limit = SPELLING_CANDIDATES) =>
      spellingCandidates(lowerOf(u), syllables, byPlain, { limit, similar }).map((c) => c.word)
    // For words with neighbors, only the best-ranked candidates: "muốm ăn" mustn't become "muối ăn" (salt)
    // through a worse fix of "muốm" than "muốn" just because "muối ăn" is a dictionary word.
    const bestCandidates = (u: Unit, limit: number) => {
      const all = spellingCandidates(lowerOf(u), syllables, byPlain, { limit: 50, similar })
      return all.filter((c) => c.marks === all[0]?.marks && c.edits === all[0]?.edits).slice(0, limit).map((c) => c.word)
    }
    const unknown = new Set(checked.filter((u) => {
      const lower = lowerOf(u)
      if (lower in syllables) return false
      if ((byPlain.get(plain(lower)) ?? []).length || !isPlain(u)) return true
      // Plain letters, no accented form: a typo only if a one-letter fix is a common syllable, and not a name.
      if (name(u)) return false
      const best = spellingCandidates(lower, syllables, byPlain, { limit: 1, minZipf: PLAIN_TYPO_MIN_ZIPF, similar })[0]
      return Boolean(best)
    }))
    for (const u of unknown) candidatesOf.set(u, candidates(u))
    const plainWords = new Set(checked.filter((u) => {
      const lower = lowerOf(u)
      return lower in syllables && lower === plain(lower) && !pronouns.has(lower) && (u === sentence.units[0] || !/\p{Lu}/u.test(u.text.charAt(0)))
    }))
    // Only accent slips count here ("khong"), not letter typos ("tihch").
    const missingAccents = [...unknown].some((u) => isPlain(u) && (byPlain.get(lowerOf(u)) ?? []).length > 0)
    // Typed without accents: mostly plain letters, and an accent error already, or 3+ words with no accent at all.
    const unaccented = mostlyPlain && (missingAccents || (target.length >= 3 && target.every(isPlain)))
    const gap = unaccented ? ACCENTS_GAP_UNACCENTED_TEXT : ACCENTS_GAP
    const betterForms = (u: Unit) => {
      const lower = lowerOf(u)
      return (byPlain.get(lower) ?? []).filter((c) => c !== lower && syllables[c] >= syllables[lower] + gap - 1e-9).slice(0, 3)
    }
    const suspect = (u: Unit) => unknown.has(u) || (plainWords.has(u) && betterForms(u).length > 0)

    // First, runs of syllables with a doubtful one that make a word once their accents are fixed: "hom nay"
    // → "hôm nay", "an com" → "ăn cơm", "hôm nây" → "hôm nay". The word decides between forms a syllable
    // alone can't ("nay" alone could be này, nảy…). Syllables written without accents may change too
    // ("mua sam" → "mua sắm": "sam" is a word, but "mua sam" isn't, and "mua sắm" is); when none of them is
    // doubtful on its own, only if one word clearly wins. Syllables written with accents never change
    // unless they're doubtful.
    const covered = new Set<Unit>()
    const loneSet = new Set(checked)
    const maxUnits = ctx.config.maxWordUnits ?? 3
    for (let i = 0; i < sentence.units.length; i++) {
      for (let k = Math.min(maxUnits, sentence.units.length - i); k >= 2; k--) {
        const span = sentence.units.slice(i, i + k)
        if (span.some((u, j) => !loneSet.has(u) || covered.has(u) || (j > 0 && !joined(ctx.text, span[j - 1], u)))) continue
        const doubtful = span.some(suspect)
        const allPlain = span.every(isPlain)
        const rarePlain = (u: Unit) => plainWords.has(u) && (allPlain || (syllables[lowerOf(u)] ?? 0) < PLAIN_RUN_MAX_ZIPF)
        const mayChange = (u: Unit) => suspect(u) || rarePlain(u)
        if (!doubtful && !span.some(rarePlain)) continue
        const written = span.map(lowerOf)
        const combos = accentCombinations(written, byPlain, {
          fixed: span.map((u) => !mayChange(u)),
          // Misspelled syllables may change letters too ("cảm ơm" → "cảm ơn").
          forms: span.map((u) => (unknown.has(u) ? bestCandidates(u, COMPOUND_FORMS_PER_SYLLABLE) : undefined)),
          perUnit: COMPOUND_FORMS_PER_SYLLABLE,
          max: COMPOUND_MAX_COMBINATIONS,
        }).filter((c) => c !== written.join(' '))
        const found = (await Promise.all(combos.map(async (c) => ({ word: c, entries: await ctx.dict.lookup(c) }))))
          // Names (found through a capitalized headword) only for a misspelled run: "nhat ban" → "Nhật Bản",
          // but "hoa lan" (orchid, every syllable a word) isn't "Hòa Lan" (the Netherlands).
          .map((f) => ({ ...f, entries: doubtful ? f.entries : f.entries.filter((e) => e.word === e.word.toLowerCase()) }))
          .filter((f) => f.entries.length)
          // Spelled as the headword: names keep their capitals ("nhat ban" → "Nhật Bản").
          .map((f) => ({ word: f.entries[0].word.toLowerCase() === f.word ? f.entries[0].word : f.word, frequency: Math.max(-1, ...f.entries.map((e) => e.frequency ?? -1)) }))
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 3)
        if (!found.length) continue
        if (!doubtful && found.length > 1 && found[0].frequency - found[1].frequency < PLAIN_RUN_MARGIN) continue
        const at = { start: span[0].start, end: span[k - 1].end, text: ctx.text.slice(span[0].start, span[k - 1].end) }
        const suggestions = found.map((f) => matchCase(at.text, f.word))
        const quoted = listOf(suggestions.map(quote), 'or')
        issues.push({
          rule: 'spelling', severity: 'warning', ...at, suggestions,
          message: span.filter(mayChange).every(isPlain)
            ? `${quote(at.text)} looks typed without accents. Did you mean ${quoted}?`
            : `${quote(at.text)} isn't spelled right. Did you mean ${quoted}?`,
        })
        span.forEach((u) => covered.add(u))
        break
      }
    }

    // Then each remaining syllable on its own.
    for (const u of checked) {
      if (covered.has(u)) continue
      const lower = lowerOf(u)
      if (unknown.has(u)) {
        const found = candidatesOf.get(u) ?? []
        const accented = !isPlain(u)
        // Missing accents on plain letters is the common learner slip; a wrong accent is more surely wrong.
        suggest(u, found, accented ? 'error' : 'warning', found.length
          ? `${quote(u.text)} isn't a ${ctx.meta.name} syllable. Did you mean ${options(u, found)}?`
          : `${quote(u.text)} isn't a ${ctx.meta.name} syllable. Check the spelling and accents.`)
      } else if (plainWords.has(u)) {
        const better = betterForms(u)
        if (!better.length) continue
        suggest(u, better, 'warning', unaccented
          ? `${quote(u.text)} looks typed without accents. Did you mean ${options(u, better)}?`
          : `${quote(u.text)} is a rare word; did you mean ${options(u, better)}?`)
      }
    }
  }
  return issues
}

// Words in the learner's own language (English by default), with the target-language word to use: "market"
// → "chợ". Runs of base units are split into the longest phrases the base dictionary knows ("ice cream"),
// each translated in the region and register. Words the language usually has no word for
// (CheckerConfig.leaveOut: Vietnamese has no articles) are suggested to be left out.
async function foreignWord(ctx: Context): Promise<CheckIssue[]> {
  const base = ctx.base
  if (!base) return []
  const leaveOut = new Set((ctx.config.leaveOut ?? []).map((w) => w.toLowerCase()))
  const issues: CheckIssue[] = []
  for (const s of ctx.sentences) {
    const runs: Unit[][] = []
    s.units.forEach((u, i) => {
      if (!ctx.inBase(u)) return
      const last = runs[runs.length - 1]
      if (last && last[last.length - 1] === s.units[i - 1] && joined(ctx.text, s.units[i - 1], u)) last.push(u)
      else runs.push([u])
    })
    for (const run of runs) {
      for (let i = 0; i < run.length; ) {
        // The longest phrase the base dictionary knows and the language has a word for; single words
        // always give an issue, with or without a translation.
        let found: { k: number; words: string[]; leave: boolean } | undefined
        for (let k = Math.min(MAX_FOREIGN_UNITS, run.length - i); k >= 1 && !found; k--) {
          const phrase = ctx.text.slice(run[i].start, run[i + k - 1].end)
          if (k === 1 && leaveOut.has(phrase.toLowerCase())) {
            found = { k, words: [], leave: true }
            break
          }
          if (k > 1 && !(await ctx.translator.senses(phrase, { from: base }).catch(() => [])).length) continue
          const [group] = await ctx.translator.translate(phrase, {
            from: base, to: ctx.options.lang, toRegion: ctx.options.region, register: ctx.options.register, listener: ctx.options.listener, limit: 3,
          }).catch(() => [])
          const words = unique((group?.translations ?? []).map((t) => t.word))
          if (words.length || k === 1) found = { k, words, leave: false }
        }
        const { k, words, leave } = found!
        const span = run.slice(i, i + k)
        const text = ctx.text.slice(span[0].start, span[k - 1].end)
        i += k
        const at = { rule: 'foreign-word' as const, severity: 'error' as const, start: span[0].start, end: span[k - 1].end, text }
        if (leave) {
          issues.push({ ...at, message: `${quote(text)} isn't ${ctx.meta.name}; ${ctx.meta.name} usually has no word for it, so leave it out.`, suggestions: [''] })
          continue
        }
        issues.push({
          ...at,
          message: words.length
            ? `${quote(text)} isn't ${ctx.meta.name}: say ${listOf(words.map(quote), 'or')}.`
            : `${quote(text)} isn't ${ctx.meta.name}, and no translation was found.`,
          suggestions: words.map((w) => (span[0].start === s.units[0].start ? matchCase(text, w) : w)),
        })
      }
    }
  }
  return issues
}

// Words from another region: a word whose main meaning (its first sense) is tagged for regions that don't
// include the text's region. With `region`, against that; without, against the regions most of the text's
// regional words share (so "lợn" stands out in otherwise Southern text). Words with an untagged main
// meaning are never flagged (Vietnamese "má" is "cheek" everywhere, "mother" only in the South).
async function dialect(ctx: Context): Promise<CheckIssue[]> {
  const all = new Set(ctx.meta.regions)
  const regional = ctx.sentences
    .flatMap((s) => s.words)
    .filter((word) => !word.units.some((u) => ctx.inBase(u)))
    .map((word) => ({ word, sense: word.entries[0]?.senses[0] }))
    .filter((x): x is { word: Word; sense: Entry['senses'][number] } =>
      Boolean(x.sense?.regionTagged && x.sense.regions.length < all.size))
  if (!regional.length) return []

  const issue = (word: Word, regions: string[], message: string, suggestions: string[], severity: CheckIssue['severity']): CheckIssue => ({
    rule: 'dialect',
    severity,
    start: word.start,
    end: word.end,
    text: word.text,
    message: `${quote(word.text)} is ${listOf(regions)}${message}` +
      // The best word only; the others (often niche: Southern "cúi", "ỉn" after "heo") are in suggestions.
      (suggestions.length ? `, say ${quote(suggestions[0])}.` : '.'),
    suggestions,
  })

  if (ctx.options.region) {
    const target = resolveRegion(ctx.meta, ctx.options.region)!
    const where = listOf(ctx.meta.regions.filter((r) => target.has(r)))
    const issues: CheckIssue[] = []
    for (const { word, sense } of regional) {
      if (sense.regions.some((r) => target.has(r))) continue
      const suggestions = await ctx.suggestRegional(word, ctx.options.region)
      issues.push(issue(word, sense.regions, `; in ${where} ${ctx.meta.name}`, suggestions, 'warning'))
    }
    return issues
  }

  // No region given: the regions most regional words share are the text's region, and words that fit none
  // of them stand out. When no region has a majority but some words can't go together ("lợn", Northern,
  // with "nha", Central and Southern), every regional word is pointed out, without a guess.
  const counts = new Map<string, number>()
  for (const { sense } of regional) for (const r of sense.regions) counts.set(r, (counts.get(r) ?? 0) + 1)
  const most = Math.max(...counts.values())
  const majority = new Set([...counts].filter(([, n]) => n === most).map(([r]) => r))
  const outliers = regional.filter(({ sense }) => !sense.regions.some((r) => majority.has(r)))
  if (outliers.length) {
    const where = ctx.meta.regions.filter((r) => majority.has(r))
    return Promise.all(outliers.map(async ({ word, sense }) =>
      issue(word, sense.regions, `, but the rest of the text is ${listOf(where)}; there`, await ctx.suggestRegional(word, where[0]), 'suggestion')))
  }
  const clash = regional.some((a) => regional.some((b) => !a.sense.regions.some((r) => b.sense.regions.includes(r))))
  if (!clash) return []
  const mixed = listOf(regional.map(({ word, sense }) => `${quote(word.text)} (${listOf(sense.regions)})`))
  return regional.map(({ word, sense }) =>
    issue(word, sense.regions, `. This text mixes regions: ${mixed}. Pick one region`, [], 'suggestion'))
}

// Pronouns that don't fit who you're talking to (`listener`) or about (`about`): "tôi" to a parent, where
// it's "con". Only the language's reliable pronouns are checked (CheckerConfig.pronouns); ones that are
// also common nouns ("bạn": friend) only get a hedged suggestion.
async function pronounRelationship(ctx: Context): Promise<CheckIssue[]> {
  if (!ctx.options.listener && !ctx.options.about) return []
  const rows = await ctx.rows()
  const issues: CheckIssue[] = []
  for (const m of ctx.pronounMatches()) {
    const about = ABOUT_PERSONS.has(m.person)
    const row = rows.find((r) => r.id === (about ? ctx.options.about : ctx.options.listener))
    const fit = unique((row?.[m.person] ?? []).map((c) => c.word))
    if (!row || !fit.length || fit.includes(m.lower)) continue
    const ambiguous = ctx.config.ambiguousPronouns?.includes(m.lower)
    const who = `${about ? 'Talking about' : 'Talking to'} ${lowerFirst(row.label)}`
    issues.push({
      rule: 'pronoun-relationship',
      severity: ambiguous ? 'suggestion' : 'warning',
      start: m.start,
      end: m.end,
      text: m.text,
      message:
        (ambiguous ? `If ${quote(m.text)} means “${PERSON_NAMES[m.person]}” here: ${lowerFirst(who)}` : who) +
        `, say ${listOf(fit.map(quote), 'or')} for “${PERSON_NAMES[m.person]}”, not ${quote(m.text)}.`,
      suggestions: fit.map((w) => matchCase(m.text, w)),
    })
  }
  return issues
}

// "I" and "you" pronouns that never go together (Vietnamese "tao" goes with "mày", not "bạn"): no row of the
// pronoun table has both. Only when no listener is given; with one, pronoun-relationship covers it.
async function pronounPair(ctx: Context): Promise<CheckIssue[]> {
  if (ctx.options.listener) return []
  const matches = ctx.pronounMatches()
  const selves = matches.filter((m) => SELF_PERSONS.has(m.person))
  const yous = matches.filter((m) => ADDRESSEE_PERSONS.has(m.person))
  if (!selves.length || !yous.length) return []
  const rows = await ctx.rows()
  const words = (r: PronounRow, persons: Set<PronounPerson>) => [...persons].flatMap((p) => r[p].map((c) => c.word))
  const issues: CheckIssue[] = []
  for (const you of yous) {
    for (const me of selves) {
      const withMe = rows.filter((r) => words(r, SELF_PERSONS).includes(me.lower))
      if (!withMe.length || withMe.some((r) => words(r, ADDRESSEE_PERSONS).includes(you.lower))) continue
      const partners = unique(withMe.flatMap((r) => r[you.person].map((c) => c.word)))
      issues.push({
        rule: 'pronoun-pair',
        severity: ctx.config.ambiguousPronouns?.includes(you.lower) ? 'suggestion' : 'warning',
        start: you.start,
        end: you.end,
        text: you.text,
        message: `${quote(me.text)} and ${quote(you.text)} don't go together` +
          (partners.length ? `: with ${quote(me.text)}, say ${listOf(partners.map(quote), 'or')}.` : '.'),
        suggestions: partners.map((w) => matchCase(you.text, w)),
      })
      break
    }
  }
  return issues
}

// Switching words for the same person within one text ("tôi" in one sentence, "tui" in the next): the first
// one used is kept. Useful for journals and longer messages. Ambiguous pronouns ("bạn": also "friend") are
// never the ones flagged as a warning.
async function pronounConsistency(ctx: Context): Promise<CheckIssue[]> {
  const first = new Map<PronounPerson, PronounMatch>()
  const issues: CheckIssue[] = []
  for (const m of ctx.pronounMatches()) {
    const earlier = first.get(m.person)
    if (!earlier) {
      first.set(m.person, m)
      continue
    }
    if (earlier.lower === m.lower) continue
    const ambiguous = ctx.config.ambiguousPronouns?.includes(m.lower) || ctx.config.ambiguousPronouns?.includes(earlier.lower)
    issues.push({
      rule: 'pronoun-consistency',
      severity: ambiguous ? 'suggestion' : 'warning',
      start: m.start,
      end: m.end,
      text: m.text,
      message: `You used ${quote(earlier.text)} for “${PERSON_NAMES[m.person]}” earlier; keep one word: ${quote(earlier.lower)}.`,
      suggestions: [matchCase(m.text, earlier.lower)],
    })
  }
  return issues
}

// Polite endings when speaking up (the listener's row is marked `respect`): Vietnamese sentences to parents,
// elders and teachers usually end in "ạ". A suggestion, not an error: it isn't always needed.
async function politeEnding(ctx: Context): Promise<CheckIssue[]> {
  const endings = ctx.config.politeEndings ?? []
  if (!ctx.options.listener || !endings.length) return []
  const row = (await ctx.rows()).find((r) => r.id === ctx.options.listener)
  if (!row?.respect) return []
  const issues: CheckIssue[] = []
  for (const s of ctx.sentences) {
    const last = s.units[s.units.length - 1]
    if (endings.includes(last.text.toLowerCase())) continue
    // Exclamations ("Con nhớ má quá!") are often fine without it.
    if (/^[^\p{L}\p{N}]*!/u.test(ctx.text.slice(last.end))) continue
    issues.push({
      rule: 'polite-ending',
      severity: 'suggestion',
      start: last.start,
      end: last.end,
      text: last.text,
      message: `Talking to ${lowerFirst(row.label)}, end the sentence with ${listOf(endings.map(quote), 'or')} to sound polite.`,
      suggestions: endings.map((e) => `${last.text} ${e}`),
    })
  }
  return issues
}

// The longest base-language phrase looked up as one ("ice cream", "take care of").
const MAX_FOREIGN_UNITS = 3

const RULES: Record<CheckRule, (ctx: Context) => Promise<CheckIssue[]>> = {
  spelling,
  'foreign-word': foreignWord,
  dialect,
  'pronoun-relationship': pronounRelationship,
  'pronoun-pair': pronounPair,
  'pronoun-consistency': pronounConsistency,
  'polite-ending': politeEnding,
}

const SEVERITY_ORDER = { error: 0, warning: 1, suggestion: 2 }

export function createChecker(options: CheckerOptions = {}): Checker {
  const cache = new Map<string, Dictionary>()
  const dict = (lang: string) => {
    let d = cache.get(lang)
    if (!d) {
      d = options.dictionary?.(lang) ?? createDictionary({ lang, baseUrl: options.baseUrl?.(lang), load: options.load?.(lang) })
      cache.set(lang, d)
    }
    return d
  }
  const translator = createTranslator({ ...options, dictionary: dict })
  const lookups = new Map<string, Promise<Entry[]>>()

  return {
    async check(input, opts) {
      const text = input.normalize('NFC')
      const d = dict(opts.lang)
      const [meta, config] = await Promise.all([d.meta(), d.checker()])
      // Unknown listener/about ids throw, listing the valid ones (as the translator does).
      if (meta.pronouns) {
        if (opts.listener) await d.pronouns({ listener: opts.listener })
        if (opts.about) await d.pronouns({ listener: opts.about })
      }
      const lookup = (phrase: string) => {
        const key = `${opts.lang}\u0000${phrase}`
        let pending = lookups.get(key)
        if (!pending) {
          pending = d.lookup(phrase)
          lookups.set(key, pending)
        }
        return pending
      }
      const base = (opts.base ?? 'en') === opts.lang ? undefined : (opts.base ?? 'en')
      const sentences: Sentence[] = []
      for (const list of sentencesOf(text, units(text))) {
        const langs = base ? await markLanguages(list, { lang: opts.lang, base, target: d, baseDictionary: dict(base), translator }) : list.map(() => opts.lang)
        sentences.push({ units: list, langs, words: await segment(text, list, config.maxWordUnits ?? 3, lookup) })
      }
      const baseUnits = new Set(sentences.flatMap((s) => s.units.filter((_, i) => s.langs[i] !== opts.lang).map((u) => u.start)))

      let rows: Promise<PronounRow[]> | undefined
      let matches: PronounMatch[] | undefined
      const ctx: Context = {
        text,
        options: opts,
        meta,
        config,
        sentences,
        dict: d,
        rows: () => (rows ??= meta.pronouns ? d.pronouns({ region: opts.region, speaker: opts.speaker }) : Promise.resolve([])),
        // The language's reliable pronouns in the text, longest first ("chúng tôi" before "tôi"), matched on
        // units directly so pronouns the dictionary doesn't list as one word ("tụi mày") are found too.
        pronounMatches: () => (matches ??= findPronouns(text, sentences, config)),
        base,
        inBase: (u) => baseUnits.has(u.start),
        translator,
        suggestRegional: async (word, region) => {
          try {
            const [group] = await translator.translate(word.lower, {
              from: opts.lang, to: opts.lang, toRegion: region, pos: word.entries[0]?.pos, limit: 3,
            })
            return (group?.translations ?? []).map((t) => t.word).filter((w) => w !== word.lower)
          } catch {
            return []
          }
        },
      }
      const results = await Promise.all(
        (Object.keys(RULES) as CheckRule[]).filter((r) => opts.rules?.[r] ?? DEFAULT_CHECK_RULES[r]).map((r) => RULES[r](ctx)),
      )
      const issues = results.flat().sort((a, b) => a.start - b.start || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
      // The text split by language: consecutive units in one language, with the text between them.
      const parts: CheckResult['parts'] = []
      for (const s of sentences) {
        s.units.forEach((u, i) => {
          const last = parts[parts.length - 1]
          if (last && last.lang === s.langs[i]) last.end = u.end
          else parts.push({ text: '', lang: s.langs[i], start: u.start, end: u.end })
        })
      }
      for (const p of parts) p.text = text.slice(p.start, p.end)
      return { text, issues, parts }
    },
  }
}

function findPronouns(text: string, sentences: Sentence[], config: CheckerConfig): PronounMatch[] {
  const byWord = new Map<string, PronounPerson>()
  for (const person of PRONOUN_PERSONS) for (const w of config.pronouns?.[person] ?? []) byWord.set(w.toLowerCase(), person)
  if (!byWord.size) return []
  const longest = Math.max(...[...byWord.keys()].map((w) => w.split(' ').length))
  const out: PronounMatch[] = []
  sentences.forEach((s, sentence) => {
    for (let i = 0; i < s.units.length; ) {
      let step = 1
      for (let k = Math.min(longest, s.units.length - i); k >= 1; k--) {
        const span = s.units.slice(i, i + k)
        if (span.some((u, j) => j > 0 && !joined(text, span[j - 1], u))) continue
        const lower = span.map((u) => u.text.toLowerCase()).join(' ')
        const person = byWord.get(lower)
        if (person) {
          out.push({ text: text.slice(span[0].start, span[k - 1].end), lower, start: span[0].start, end: span[k - 1].end, person, sentence })
          step = k
          break
        }
      }
      i += step
    }
  })
  return out
}
