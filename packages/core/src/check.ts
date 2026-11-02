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
  /** The language's phrasebook phrases of several units, by lower-case text, as written there ("việt nam" → "Việt Nam"). */
  phrasebook: Map<string, string>
  /** The same phrases' lower-case texts by their letters without accents ("thuc day" → ["thức dậy"]). */
  phrasebookByPlain: Map<string, string[]>
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
// Zipf points by which an accented form must be more common than a common plain-letter syllable written
// beside accented ones for the run to change it.
const COMMONER_ACCENTED_GAP = 0.3
// How common (Zipf) a word must be for such a change.
const COMMONER_MIN_WORD_ZIPF = 5
// How common a phrasebook phrase counts as, at least, when its accents are chosen: the phrasebook lists
// everyday phrases, many of which aren't headwords ("thức dậy", "đông người"), so have no frequency.
const PHRASEBOOK_ZIPF = 5
// A plain-letter non-syllable with no accented form is checked as a typo only if a one-letter fix gives a
// syllable at least this common (Zipf); otherwise it's probably a name or a foreign word.
const PLAIN_TYPO_MIN_ZIPF = 4
// Candidates kept per misspelled syllable.
const SPELLING_CANDIDATES = 3

async function spelling(ctx: Context): Promise<CheckIssue[]> {
  if (ctx.config.units === 'words') return wordSpelling(ctx)
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
    // The writer's syllable with a typed mark dropped keeps a place: a wrongly accented syllable often had a
    // mark it shouldn't ("suỹ": quỹ, then suy), which ranks below fixes keeping the writer's marks.
    const marksOf = (s: string) => [...s.normalize('NFD')].filter((c) => /\p{M}/u.test(c))
    const dropsMarks = (written: string, w: string) => {
      const left = marksOf(written)
      const mine = marksOf(w)
      return mine.length < left.length && mine.every((m) => left.includes(m) && left.splice(left.indexOf(m), 1))
    }
    const candidates = (u: Unit, limit = SPELLING_CANDIDATES) => {
      const all = spellingCandidates(lowerOf(u), syllables, byPlain, { limit: 50, similar })
      const top = all.slice(0, limit).map((c) => c.word)
      const same = all.find((c) => c.edits === 0 && dropsMarks(lowerOf(u), c.word))?.word
      if (same && !top.includes(same)) top.splice(Math.min(1, top.length), 0, same)
      return top.slice(0, limit)
    }
    // The same letters with any other accents (or none), most common first.
    const sameLetters = (u: Unit) =>
      (byPlain.get(plain(lowerOf(u))) ?? []).filter((c) => c !== lowerOf(u)).sort((a, b) => syllables[b] - syllables[a]).slice(0, COMPOUND_FORMS_PER_SYLLABLE)
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
    // What a unit most likely is: its best fix when it's misspelled or missing accents, else as written.
    const asFixed = (u: Unit) => candidatesOf.get(u)?.[0] ?? (plainWords.has(u) ? betterForms(u)[0] : undefined) ?? lowerOf(u)
    // The form the next word says a misspelled or plain-letter unit is (CheckerConfig.nextCues): "luc 8 gio"
    // → "lúc", "nhung toi" → "nhưng" (the next word counts as fixed: "toi" is "tôi").
    const cueOf = (u: Unit): string | undefined => {
      if (!unknown.has(u) && !plainWords.has(u)) return undefined
      const next = sentence.units[sentence.units.indexOf(u) + 1]
      if (!next || !joined(ctx.text, u, next)) return undefined
      const nextWord = /^\d/.test(next.text) ? '#number' : asFixed(next)
      const lower = lowerOf(u)
      for (const cue of ctx.config.nextCues ?? []) {
        if (!cue.before.includes(nextWord)) continue
        const form = cue.forms.find((f) => f !== lower && plain(f) === plain(lower))
        if (form) return form
      }
      return undefined
    }
    const classifiers = new Set(ctx.config.classifiers ?? [])

    // First, runs of syllables with a doubtful one that make a word once their accents are fixed: "hom nay"
    // → "hôm nay", "an com" → "ăn cơm", "hôm nây" → "hôm nay". The word decides between forms a syllable
    // alone can't ("nay" alone could be này, nảy…). Syllables written without accents may change too
    // ("mua sam" → "mua sắm": "sam" is a word, but "mua sam" isn't, and "mua sắm" is); when none of them is
    // doubtful on its own, only if one word clearly wins. Syllables written with accents never change
    // unless they're doubtful.
    const covered = new Set<Unit>()
    const loneSet = new Set(checked)
    const maxUnits = ctx.config.maxWordUnits ?? 3
    // The parts of speech the word before a unit points to (posCues), when it's one of the language's cues.
    // Cues may be two syllables ("có thể"); the longer match wins.
    const cuedPos = (at: number) => {
      const units = sentence.units
      for (const n of [2, 1]) {
        const before = units.slice(at - n, at)
        if (before.length < n || before.some((b, j) => !joined(ctx.text, b, before[j + 1] ?? units[at]))) continue
        // As written, or as fixed when typed without accents ("mot cai ao": một).
        const written = before.map(lowerOf).join(' ')
        const fixed = before.map(asFixed).join(' ')
        const cue = ctx.config.posCues?.find((c) => c.before.includes(written) || c.before.includes(fixed))
        if (cue) return new Set(cue.pos)
      }
      return undefined
    }
    // The issue for a run's fixes (best first), and its units marked as covered.
    // A phrase only the phrasebook has may include syllables that are right as written, as context:
    // "chẳng the nao" is "chẳng thể nào" (can't possibly), not "thế nào" (how). Those stay out of the
    // issue, which covers what changes: "the nao" → "thể nào". (A dictionary word is suggested whole:
    // "Hom nay" → "Hôm nay".)
    const emit = async (span: Unit[], written: string[], found: { word: string; phraseOnly: boolean }[], plainOnly: boolean) => {
      const k = span.length
      const fixes = found.map((f) => f.word.split(' '))
      const same = (j: number) => fixes.every((f) => f[j]?.toLowerCase() === written[j])
      let first = 0
      let last = k - 1
      if (found[0].phraseOnly) {
        while (first < last && same(first)) first++
        while (last > first && same(last)) last--
        // But not into a word: "đi mua sam" is "mua sam" → "mua sắm", "Cảm ơm bạn" is "Cảm ơm" → "Cảm ơn".
        const isWord = async (from: number, to: number) => (await ctx.dict.lookup(fixes[0].slice(from, to + 1).join(' '))).length > 0
        while (first > 0 && (await isWord(first - 1, first))) first--
        while (last < k - 1 && (await isWord(last, last + 1))) last++
      }
      const at = { start: span[first].start, end: span[last].end, text: ctx.text.slice(span[first].start, span[last].end) }
      const suggestions = unique(fixes.map((f) => matchCase(at.text, f.slice(first, last + 1).join(' '))))
      const quoted = listOf(suggestions.map(quote), 'or')
      issues.push({
        rule: 'spelling', severity: 'warning', ...at, suggestions,
        message: plainOnly
          ? `${quote(at.text)} looks typed without accents. Did you mean ${quoted}?`
          : `${quote(at.text)} isn't spelled right. Did you mean ${quoted}?`,
      })
      span.forEach((u) => covered.add(u))
    }
    // Phrasebook phrases that change one syllable beside syllables kept as written wait until every run has
    // been tried: they apply only if no word fixed that syllable ("màu nau" → "màu nâu", but "đã lam chu" is
    // "làm chủ", not the phrase "đã làm").
    const deferred: { span: Unit[]; written: string[]; found: { word: string; phraseOnly: boolean }[]; plainOnly: boolean }[] = []
    for (let i = 0; i < sentence.units.length; i++) {
      for (let k = Math.min(maxUnits, sentence.units.length - i); k >= 2; k--) {
        const span = sentence.units.slice(i, i + k)
        if (span.some((u, j) => !loneSet.has(u) || covered.has(u) || (j > 0 && !joined(ctx.text, span[j - 1], u)))) continue
        const doubtful = span.some(suspect)
        const allPlain = span.every(isPlain)
        const rarePlain = (u: Unit) => plainWords.has(u) && (allPlain || (syllables[lowerOf(u)] ?? 0) < PLAIN_RUN_MAX_ZIPF)
        // Next to a misspelled syllable, plain-letter syllables may be missing their accents too, however
        // common they are on their own: "suỹ nghi" → "suy nghĩ".
        const nearMisspelled = span.some((u) => unknown.has(u))
        // Beside syllables written with accents, a common plain-letter one may still be missing its own,
        // but only for forms clearly more common than it: "thanh công" → "thành công" (thành is more common
        // than thanh), never "cho con" → "chó con" (cho is far more common than chó).
        const commoner = (u: Unit) =>
          !allPlain && plainWords.has(u)
            ? (byPlain.get(lowerOf(u)) ?? []).filter((c) => syllables[c] >= syllables[lowerOf(u)] + COMMONER_ACCENTED_GAP)
            : []
        const mayChange = (u: Unit) => suspect(u) || rarePlain(u) || (nearMisspelled && plainWords.has(u)) || commoner(u).length > 0
        if (!doubtful && !span.some((u) => rarePlain(u) || commoner(u).length)) continue
        const written = span.map(lowerOf)
        const nounCued = cuedPos(i)?.has('noun')
        // Phrasebook phrases count when a syllable is in doubt; a common word changed only for a commoner form
        // beside accented ones is left to the dictionary ("con dao này", this knife, isn't "dạo này", lately).
        const phrases = doubtful || span.some(rarePlain) || nearMisspelled
        const words = async (forms: (u: Unit) => string[]) => {
          const combos = accentCombinations(written, byPlain, {
            fixed: span.map((u) => !mayChange(u)),
            // Misspelled syllables may change letters too ("cảm ơm" → "cảm ơn").
            forms: span.map((u) => (unknown.has(u) ? forms(u) : mayChange(u) && !suspect(u) && !rarePlain(u) && !nearMisspelled ? commoner(u) : undefined)),
            perUnit: COMPOUND_FORMS_PER_SYLLABLE,
            max: COMPOUND_MAX_COMBINATIONS,
          }).filter((c) => c !== written.join(' '))
          // Phrasebook phrases with the same letters, however far down each syllable's forms they are ("pho
          // bo": phở and bò are 7th and 5th among pho's and bo's forms), keeping the syllables that may not change.
          for (const c of phrases ? (ctx.phrasebookByPlain.get(plain(written.join(' '))) ?? []) : []) {
            const syllablesOf = c.split(' ')
            if (!combos.includes(c) && span.every((u, j) => mayChange(u) || syllablesOf[j] === written[j])) combos.push(c)
          }
          // After a word that's followed by a noun ("một", "các"), a classifier and a noun count as a word:
          // "một cái áo" (a shirt) isn't a headword, "cài áo" (to button up) is. Only there: classifiers are
          // everyday words too ("con lai" is "còn lại", "trái banh" a ball).
          const lookup = async (c: string): Promise<Entry[]> => {
            const entries = await ctx.dict.lookup(c)
            const [first, second, ...rest] = c.split(' ')
            if (entries.length || rest.length || !second || !nounCued || !classifiers.has(first)) return entries
            const nouns = (await ctx.dict.lookup(second)).filter((e) => e.pos === 'noun')
            return nouns.length ? [{ word: c, pos: 'noun', senses: [], frequency: Math.max(...nouns.map((e) => e.frequency ?? -1)) }] : []
          }
          return (await Promise.all(combos.map(async (c) => ({ word: c, entries: await lookup(c), phrase: phrases ? ctx.phrasebook.get(c) : undefined }))))
          // Names (found through a capitalized headword) only for a misspelled run: "nhat ban" → "Nhật Bản",
          // but "hoa lan" (orchid, every syllable a word) isn't "Hòa Lan" (the Netherlands).
            .map((f) => ({ ...f, entries: doubtful ? f.entries : f.entries.filter((e) => e.word === e.word.toLowerCase()) }))
            .filter((f) => f.entries.length || f.phrase)
            // A unit the next word decides keeps that form ("luc 8": lúc).
            .filter((f) => span.every((u, j) => {
              const cue = cueOf(u)
              return !cue || f.word.split(' ')[j] === cue
            }))
            // Spelled as the phrasebook or the headword has it: names keep their capitals ("nhat ban" → "Nhật Bản").
            .map((f) => ({
              word: f.phrase ?? (f.entries[0].word.toLowerCase() === f.word ? f.entries[0].word : f.word),
              frequency: Math.max(f.phrase ? PHRASEBOOK_ZIPF : -1, ...f.entries.map((e) => e.frequency ?? -1)),
              pos: new Set(f.entries.map((e) => e.pos)),
              phrase: Boolean(f.phrase),
              phraseOnly: Boolean(f.phrase) && !f.entries.length,
              // A phrase only the phrasebook has that changes one syllable, keeping its neighbors as written
              // ("màu nau" → "màu nâu"): see `deferred`.
              contextOne: !f.entries.length && f.word.split(' ').filter((x, j) => x !== written[j]).length === 1,
            }))
            // Everyday phrases first: "gia dinh" is "gia đình", not the place Gia Định; "noi tieng viet" is
            // "nói tiếng Việt", not "nổi tiếng" (famous) + Việt.
            .sort((a, b) => Number(b.phrase) - Number(a.phrase) || b.frequency - a.frequency)
            .slice(0, 3)
        }
        // Accent slips first, then letter typos: a word made by fixing a misspelled syllable's accents
        // ("cõ là" → "có là", "không nhừng" → "không những") beats one made by changing its letters ("cỡ",
        // "ngừng": they keep the typed mark, so the syllable alone ranks them first).
        const misspelled = span.some((u) => unknown.has(u))
        let found = misspelled ? await words(sameLetters) : []
        if (!found.length) found = await words((u) => bestCandidates(u, COMPOUND_FORMS_PER_SYLLABLE))
        if (found.length && found.every((f) => f.contextOne)) {
          deferred.push({ span, written, found, plainOnly: span.filter(mayChange).every(isPlain) })
          continue
        }
        found = found.filter((f) => !f.contextOne)
        if (!found.length) continue
        // Fixes that differ in part of speech: the word before tells which ("đã cong nhan": công nhận, a
        // verb; "các cong nhan": công nhân, a noun). The ones it points to come first, and a single one is
        // a clear winner however close the frequencies.
        const cued = cuedPos(i)
        const fits = (f: (typeof found)[number]) => [...f.pos].some((p) => cued?.has(p))
        // A single everyday phrase among the fixes wins too.
        const decided = (cued && found.length > 1 && found.filter(fits).length === 1 && !found.every(fits)) ||
          (found[0].phrase && !found[1]?.phrase)
        if (cued) found = [...found.filter(fits), ...found.filter((f) => !fits(f))]
        // Changed only for a commoner form: the word must be common too, since the written one may be a
        // word the dictionary lacks ("kỳ thi", exam, isn't a headword; "kỳ thị", discrimination, is).
        if (!doubtful && !span.some(rarePlain) && found[0].frequency < COMMONER_MIN_WORD_ZIPF) continue
        if (!doubtful && !decided && found.length > 1 && found[0].frequency - found[1].frequency < PLAIN_RUN_MARGIN) continue
        await emit(span, written, found, span.filter(mayChange).every(isPlain))
        break
      }
    }
    // Then the deferred phrases, for syllables no run fixed.
    for (const d of deferred) {
      const changed = d.span.filter((_, j) => d.found[0].word.split(' ')[j] !== d.written[j])
      if (!changed.some((u) => covered.has(u))) await emit(d.span, d.written, d.found, d.plainOnly)
    }

    // Then each remaining syllable on its own.
    for (const u of checked) {
      if (covered.has(u)) continue
      const lower = lowerOf(u)
      const cue = cueOf(u)
      const cueFirst = (forms: string[]) => (cue ? [cue, ...forms.filter((f) => f !== cue)].slice(0, SPELLING_CANDIDATES) : forms)
      if (unknown.has(u)) {
        const found = cueFirst(candidatesOf.get(u) ?? [])
        const accented = !isPlain(u)
        // Missing accents on plain letters is the common learner slip; a wrong accent is more surely wrong.
        suggest(u, found, accented ? 'error' : 'warning', found.length
          ? `${quote(u.text)} isn't a ${ctx.meta.name} syllable. Did you mean ${options(u, found)}?`
          : `${quote(u.text)} isn't a ${ctx.meta.name} syllable. Check the spelling and accents.`)
      } else if (plainWords.has(u)) {
        const better = cueFirst(betterForms(u))
        if (!better.length) continue
        suggest(u, better, 'warning', unaccented
          ? `${quote(u.text)} looks typed without accents. Did you mean ${options(u, better)}?`
          : `${quote(u.text)} is a rare word; did you mean ${options(u, better)}?`)
      }
    }

    issues.push(...falseFriendHints(ctx, target))
  }
  return issues
}

// Words with another meaning than the learner's look-alike (CheckerConfig.falseFriends): a hint only, since
// they're often used right (Vietnamese "bài hát hot", a hit song; Spanish "embarazada", pregnant).
function falseFriendHints(ctx: Context, target: Unit[]): CheckIssue[] {
  return target.flatMap((u) => {
    const friend = ctx.config.falseFriends?.find((f) => f.word === u.text.toLowerCase())
    if (!friend) return []
    return [{
      rule: 'spelling' as const, severity: 'suggestion' as const, start: u.start, end: u.end, text: u.text,
      message: `In ${ctx.meta.name}, ${quote(u.text)} means ${friend.means}; for ${friend.for}, say ${listOf(friend.say.map(quote), 'or')}.`,
      suggestions: friend.say.map((w) => matchCase(u.text, w)),
    }]
  })
}

// Wiktionary's own misspelling entries ("misspelling of también", "common misspelling of …"). A word counts
// as misspelt when it's a misspelling and otherwise only an out-of-use spelling ("tambien": misspelling, and
// obsolete spelling, of también).
const MISSPELLING = /\bmisspelling of ([\p{L}\p{M}'-]+)/iu
const NOT_IN_USE_SPELLING = /\b(misspelling|obsolete spelling|archaic spelling|dated spelling|obsolete form|archaic form) of\b/i
// Zipf points below the most common look-alike beyond which another isn't suggested.
const RARE_VARIANT_GAP = 2
// A known word written without accents gets its accented look-alike when that is this many Zipf points more
// common (Spanish "trafico", I traffic, 3.4 → "tráfico", traffic, 4.6), or when the word before asks for a
// part of speech (posCues) only the look-alike has ("la practica" → "práctica"). "esta"/"está" (6.4/6.2) and
// "mas"/"más" (5.9/6.6) stay: both are common.
const WORD_ACCENTS_GAP = 1
// One-letter fixes of unknown words (similarLetters, silentLetters) must be at least this common.
const LETTER_FIX_MIN_ZIPF = 3

// Spelling and accents for languages written in words (Spanish), from the dictionary alone: a word it doesn't
// know, as a headword or an inflected form (the forms index), that matches known words once accents are
// dropped gets the most common of them ("cancion" → "canción", "tambien" → "también"). Known words are left
// alone even when an accented one is more
// common ("esta" is a word, as "está" is), and so are unknown words with no such match (names, other
// languages, typos this can't fix), and words capitalized mid-sentence (names).
async function wordSpelling(ctx: Context): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = []
  for (const sentence of ctx.sentences) {
    issues.push(...falseFriendHints(ctx, sentence.units.filter((u) => !ctx.inBase(u))))
    for (const w of sentence.words) {
      if (w.units.length !== 1) continue
      // Words the dictionary lists only as misspellings or old spellings ("tambien": "misspelling of también";
      // "jardin": "obsolete spelling of jardín") count as unknown, with the spelling they stand for.
      const senses = w.entries.flatMap((e) => e.senses)
      const misspelt = senses.length > 0 && senses.every((s) => NOT_IN_USE_SPELLING.test(s.glosses[0] ?? ''))
      const u = w.units[0]
      if (ctx.inBase(u) || !/\p{L}/u.test(u.text)) continue
      if (u !== sentence.units[0] && /\p{Lu}/u.test(u.text.charAt(0))) continue
      if (w.entries.length && !misspelt) {
        const issue = await accentLookAlike(ctx, sentence, w)
        if (issue) issues.push(issue)
        continue
      }
      // Look-alikes that are themselves old spellings stand for their current spelling ("abia": "abía", an
      // obsolete spelling of "había").
      const variants = (await ctx.dict.variants(u.text, { limit: 3 })).map((v) => {
        const vs = v.entries.flatMap((e) => e.senses)
        const now = vs.length && vs.every((x) => NOT_IN_USE_SPELLING.test(x.glosses[0] ?? '')) ? vs.find((x) => x.altOf)?.altOf : undefined
        return now ? { ...v, word: now } : v
      })
      // Rare look-alikes don't crowd out the word meant ("nino": niño, not also ñiño).
      const best = variants[0]?.frequency
      const found = unique([
        ...(misspelt ? senses.map((s) => s.altOf ?? MISSPELLING.exec(s.glosses[0] ?? '')?.[1]) : []).filter((x): x is string => Boolean(x)),
        ...variants.filter((v) => best === undefined || (v.frequency ?? -Infinity) >= best - RARE_VARIANT_GAP).map((v) => v.word),
      ]).slice(0, 3)
      if (!found.length) found.push(...(await letterFixes(ctx, u.text)))
      if (!found.length) continue
      // Missing accents is the common learner slip; a wrong accent is more surely wrong. Old spellings
      // ("sólo" for "solo") are still seen, so they're a warning.
      const accented = plain(u.text) !== u.text
      const old = misspelt && !senses.some((s) => MISSPELLING.test(s.glosses[0] ?? ''))
      issues.push({
        rule: 'spelling',
        severity: accented && !old ? 'error' : 'warning',
        start: u.start,
        end: u.end,
        text: u.text,
        message: `${quote(u.text)} isn't a ${ctx.meta.name} word. Did you mean ${listOf(found.map(quote), 'or')}?`,
        suggestions: found.map((c) => matchCase(u.text, c)),
      })
    }
  }
  return issues
}

// A known word with no accents whose accented look-alike is far more common, or is the part of speech the
// word before asks for (see WORD_ACCENTS_GAP): a warning, since the word as written is a real word.
async function accentLookAlike(ctx: Context, sentence: Context['sentences'][number], w: Word): Promise<CheckIssue | undefined> {
  const u = w.units[0]
  if (plain(u.text) !== u.text) return undefined
  const own = Math.max(...w.entries.map((e) => e.frequency ?? -Infinity))
  const i = sentence.words.indexOf(w)
  const before = i > 0 && joined(ctx.text, sentence.words[i - 1].units[0], u) ? sentence.words[i - 1].lower : undefined
  const cued = new Set(ctx.config.posCues?.filter((c) => before !== undefined && c.before.includes(before)).flatMap((c) => c.pos) ?? [])
  const hasCued = (entries: Entry[]) => entries.some((e) => cued.has(e.pos))
  const found = (await ctx.dict.variants(u.text, { limit: 3 })).filter((v) =>
    plain(v.word) === v.word.toLowerCase() ? false : (v.frequency ?? -Infinity) >= own + WORD_ACCENTS_GAP || (cued.size > 0 && hasCued(v.entries) && !hasCued(w.entries)),
  )
  if (!found.length) return undefined
  return {
    rule: 'spelling',
    severity: 'warning',
    start: u.start,
    end: u.end,
    text: u.text,
    message: `${quote(u.text)} is a ${ctx.meta.name} word, but ${listOf(found.map((v) => quote(v.word)), 'or')} is more likely here.`,
    suggestions: found.map((v) => matchCase(u.text, v.word)),
  }
}

// Words an unknown word becomes with one letter swapped within a group of letters often confused
// (CheckerConfig.similarLetters: Spanish "cosina" → "cocina") or one silent letter added or dropped
// (silentLetters: "ablar" → "hablar"), each with its accents fixed, the most common first.
async function letterFixes(ctx: Context, word: string): Promise<string[]> {
  const lower = word.toLowerCase()
  const groups = ctx.config.similarLetters ?? []
  const silent = ctx.config.silentLetters ?? []
  if (!groups.length && !silent.length) return []
  const tries = new Set<string>()
  for (let i = 0; i <= lower.length; i++) {
    const c = lower[i]
    if (c) for (const g of groups) if (g.includes(c)) for (const o of g) if (o !== c) tries.add(lower.slice(0, i) + o + lower.slice(i + 1))
    for (const l of silent) tries.add(lower.slice(0, i) + l + lower.slice(i))
    if (c && silent.includes(c)) tries.add(lower.slice(0, i) + lower.slice(i + 1))
  }
  tries.delete(lower)
  const found = new Map<string, number>()
  for (const t of tries) {
    const own = await ctx.dict.lookup(t)
    const usable = own.filter((e) => !e.senses.every((s) => NOT_IN_USE_SPELLING.test(s.glosses[0] ?? '')))
    if (usable.length) found.set(t, Math.max(...usable.map((e) => e.frequency ?? -Infinity)))
    for (const v of await ctx.dict.variants(t, { limit: 2 })) found.set(v.word, Math.max(found.get(v.word) ?? -Infinity, v.frequency ?? -Infinity))
  }
  return [...found].filter(([, f]) => f >= LETTER_FIX_MIN_ZIPF).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w)
}

// Words in the learner's own language (English by default), with the target-language word to use: "market"
// → "chợ". Runs of base units are split into the longest phrases the language's phrasebook has or the base
// dictionary knows ("wash the dishes", "ice cream"), each translated in the region and register. Words the
// language usually has no word for (CheckerConfig.leaveOut: Vietnamese has no articles) are suggested to
// be left out.
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
          const [group] = await ctx.translator.translate(phrase, {
            from: base, to: ctx.options.lang, toRegion: ctx.options.region, register: ctx.options.register, listener: ctx.options.listener, limit: 3,
          }).catch(() => [])
          // A phrase of several words counts when the language's phrasebook has it ("wash the dishes") or
          // the base dictionary knows it ("ice cream").
          const inPhrasebook = group?.translations[0]?.bridge === 'phrasebook'
          if (k > 1 && !inPhrasebook && !(await ctx.translator.senses(phrase, { from: base }).catch(() => [])).length) continue
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

// The longest base-language phrase looked up as one ("ice cream", "go to the market", "how much does it cost":
// the phrasebook's longest English phrases have five words).
const MAX_FOREIGN_UNITS = 5

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

// A language's phrasebook phrases of several units, by lower-case text: built once per dictionary.
type Phrasebook = { byText: Map<string, string>; byPlain: Map<string, string[]> }
const phrasebooks = new WeakMap<Dictionary, Promise<Phrasebook>>()
const phrasebookOf = (d: Dictionary) => {
  let p = phrasebooks.get(d)
  if (!p) {
    p = d.phrases().then((rows) => {
      const byText = new Map(rows.filter((r) => r.text.includes(' ')).map((r) => [r.text.toLowerCase(), r.text]))
      const byPlain = new Map<string, string[]>()
      for (const lower of byText.keys()) byPlain.set(plain(lower), [...(byPlain.get(plain(lower)) ?? []), lower])
      return { byText, byPlain }
    })
    phrasebooks.set(d, p)
  }
  return p
}

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
      // Phrasebook phrases count as words: written right, their syllables aren't checked one by one ("kỳ
      // thi" isn't "kỳ thị"), and spelling fixes can make them ("o nha" → "ở nhà").
      const { byText: phrasebook, byPlain: phrasebookByPlain } = await phrasebookOf(d)
      const lookupOrPhrase = async (phrase: string): Promise<Entry[]> => {
        const entries = await lookup(phrase)
        const text = entries.length ? undefined : phrasebook.get(phrase.toLowerCase())
        return text ? [{ word: text, pos: 'phrase', senses: [] }] : entries
      }
      const base = (opts.base ?? 'en') === opts.lang ? undefined : (opts.base ?? 'en')
      const sentences: Sentence[] = []
      for (const list of sentencesOf(text, units(text))) {
        const langs = base ? await markLanguages(list, { lang: opts.lang, base, target: d, baseDictionary: dict(base), translator }) : list.map(() => opts.lang)
        sentences.push({ units: list, langs, words: await segment(text, list, config.maxWordUnits ?? 3, lookupOrPhrase) })
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
        phrasebook,
        phrasebookByPlain,
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
