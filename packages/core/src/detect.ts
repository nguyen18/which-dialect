// Which language each word of a mixed text is in: the target language or the learner's own (the base,
// English by default), from the two languages' data alone. Shared by the checker and the journal review.

import type { Dictionary } from './index.ts'
import { plain, syllablesByPlain, type Unit } from './text.ts'
import { phraseKey, type Translator } from './translate.ts'

/**
 * Marks each unit (of one sentence) with `lang` or `base`. A unit the target knows and the base doesn't
 * is the target's, and the other way round. A unit both know ("em", "an", "to") goes by how common it is
 * in each: clearly more common in the target, the target's (Vietnamese "em", "di" next to English
 * "hello", "shopping": English has rare "em", "di"); far more common in the base, the base's ("the");
 * otherwise, and for units neither knows (names), the nearest decided neighbors' language when they agree,
 * else the target's (the text is mainly the target language: "an" next to English "the"). In languages
 * written in syllables, a base word that's a target word only once accents are added is weighed the same
 * way, using its accented form's frequency: "rat" is "rất" (far more common than English "rat"); close
 * calls ("met": mệt or English met) go to the target only when their neighbors are the target's ("Tôi met
 * quá"), so English stays English among English ("kem but it was": but, not bút). A word only the target
 * knows without its accents ("khong") is still the target's. Languages written in words do the same with
 * whole words and their inflected forms (Spanish "cancion" → canción, "tambien" → también). The base is known through the translator, so
 * inflected forms count ("went", "cooked").
 */
// Zipf points by which a word both languages know must be more common in one to count as that language's
// whatever its neighbors: less for the target, since the text is mainly the target language.
const TARGET_MARGIN = 1
const BASE_MARGIN = 2
// For a base word that's a target word only with accents added, a smaller lead keeps it the base's: it was
// typed exactly as the base word ("but" is 1.9 more common in English than "bút" in Vietnamese).
const BASE_MARGIN_ACCENTS = 1
// The longest base phrase a word is joined to its base neighbors by (see the phrase pass below): the
// phrasebook's longest English phrases have five words ("how much does it cost").
const BASE_PHRASE_UNITS = 5

// The English of a target language's phrasebook, as phrase keys: built once per dictionary.
const phrasebookEnglish = new WeakMap<Dictionary, Promise<Set<string>>>()
const englishPhrases = (d: Dictionary) => {
  let keys = phrasebookEnglish.get(d)
  if (!keys) phrasebookEnglish.set(d, (keys = d.phrases().then((rows) => new Set(rows.map((r) => phraseKey(r.en))))))
  return keys
}

export async function markLanguages(
  list: Unit[],
  o: { lang: string; base: string; target: Dictionary; baseDictionary: Dictionary; translator: Translator },
): Promise<string[]> {
  const syllables = await o.target.syllables()
  const syllableLanguage = Object.keys(syllables).length > 0
  // Each syllable's accented forms by their plain letters, most common first: built once per language
  // (syllablesByPlain caches it), since this runs for every sentence and stripping the accents from all
  // ~7,000 Vietnamese syllables each time was a fifth of a journal check's CPU (2026-11-01).
  const byPlain = syllablesByPlain(syllables)
  // 'exact': a target word as written; 'accents': one only with accents added ("khong" → "không").
  const targetKnows = async (u: Unit): Promise<'exact' | 'accents' | false> => {
    const lower = u.text.toLowerCase()
    // Languages written in words compare whole words: "cancion" is Spanish "canción" without its accent.
    if (!syllableLanguage) {
      if ((await o.target.lookup(lower)).length > 0) return 'exact'
      return (await o.target.variants(lower, { limit: 1 })).length > 0 ? 'accents' : false
    }
    if (lower !== plain(lower)) return 'exact'
    // A plain-letter syllable never seen as written (Zipf 0: "nau", an obsolete word for pain) is a word only
    // with accents added, as far as text goes ("nấu", to cook).
    if (lower in syllables && (syllables[lower] > 0 || (byPlain.get(lower) ?? []).every((f) => f === lower))) return 'exact'
    return byPlain.has(lower) ? 'accents' : false
  }
  const baseKnows = async (u: Unit) => (await o.translator.senses(u.text, { from: o.base }).catch(() => [])).length > 0
  const marks = await Promise.all(list.map(async (u) => {
    if (/\d/.test(u.text)) return '?'
    const [t, b] = await Promise.all([targetKnows(u), baseKnows(u)])
    if (t === 'exact') return b ? 'both' : o.lang
    if (b) return t === 'accents' ? 'accents' : o.base
    return t === 'accents' ? o.lang : '?'
  }))
  // The most common form a plain-letter unit takes once accents are added ("rat" → rất, 6.4).
  const accentedFrequency = async (u: Unit) => {
    if (!syllableLanguage) return (await o.target.variants(u.text.toLowerCase(), { limit: 1 }))[0]?.frequency ?? 0
    const forms = byPlain.get(plain(u.text.toLowerCase()))
    return forms ? Math.max(0, syllables[forms[0]]) : 0
  }
  // How common a word is in each language (Zipf; 0 when unknown).
  const targetFrequency = async (u: Unit) => {
    const lower = u.text.toLowerCase()
    if (syllableLanguage) return syllables[lower] ?? 0
    return (await o.target.lookup(lower))[0]?.frequency ?? 0
  }
  const baseFrequency = async (u: Unit) => (await o.baseDictionary.lookup(u.text.toLowerCase()))[0]?.frequency ?? 0
  // Words both languages know, decided by frequency when it's clear. Base words that are target words with
  // accents added use that form's frequency, and close calls are marked '?accents' (decided by neighbors,
  // more strictly).
  const decided = await Promise.all(marks.map(async (m, i) => {
    if (m !== 'both' && m !== 'accents') return m
    const [t, b] = await Promise.all([m === 'accents' ? accentedFrequency(list[i]) : targetFrequency(list[i]), baseFrequency(list[i])])
    if (t - b >= TARGET_MARGIN) return o.lang
    if (b - t >= (m === 'accents' ? BASE_MARGIN_ACCENTS : BASE_MARGIN)) return o.base
    return m === 'accents' ? '?accents' : '?'
  }))
  const known = (x: string) => x !== '?' && x !== '?accents'
  const langs = decided.map((m, i) => {
    if (known(m)) return m
    const left = decided.slice(0, i).reverse().find(known)
    const right = decided.slice(i + 1).find(known)
    // A word written as typed in the base language needs every decided neighbor to be the target's to be
    // read as the target's without its accents ("Tôi met quá": mệt); otherwise it's the base's.
    if (m === '?accents') return (left ?? o.lang) === o.lang && (right ?? o.lang) === o.lang && (left || right) ? o.lang : o.base
    return left && right && left !== right ? o.lang : left ?? right ?? o.lang
  })
  // A word both languages know, read as the base's by frequency, is the target's when it makes a target
  // word with a neighbor, accents added if need be: "không the" (không thể). The neighbor may be such a word
  // too ("co the": có thể) when the pair is all there is or has a target word beside it ("Tôi co the đi").
  // English among English stays English: "I like the phở" ("the phở" isn't a word), "to the store".
  if (syllableLanguage) {
    const flippable = (i: number) => langs[i] === o.base && (marks[i] === 'both' || marks[i] === 'accents')
    const makesWord = async (a: Unit, b: Unit) => {
      const phrase = `${a.text} ${b.text}`.toLowerCase()
      return (await o.target.lookup(phrase)).length > 0 || (await o.target.variants(phrase, { limit: 1 })).length > 0
    }
    for (let i = 0; i + 1 < list.length; i++) {
      const [a, b] = [flippable(i), flippable(i + 1)]
      if (!(a || b)) continue
      if (a && b) {
        const beside = [langs[i - 1], langs[i + 2]].filter((l) => l !== undefined)
        if (beside.length && !beside.includes(o.lang)) continue
      } else if (langs[a ? i + 1 : i] !== o.lang) continue
      if (await makesWord(list[i], list[i + 1])) langs[i] = langs[i + 1] = o.lang
    }
  }
  // The other way: a word both languages know, read as the target's, is the base's when it makes a base
  // phrase with its base neighbors: "tôi go home sớm" ("go" is also Vietnamese, and with "tôi" on one side
  // and "home" on the other its neighbors disagree). A phrase is one the target's phrasebook has in English
  // ("go home", "watch a movie") or the base dictionary knows. Its other words must be the base's or such
  // words too ("go to bed": "to" is Vietnamese "big"), with at least one already the base's, so target words
  // stay the target's ("Tôi đi market").
  if (o.base === 'en') {
    const phrasebook = await englishPhrases(o.target)
    const isPhrase = async (from: number, to: number) => {
      const phrase = list.slice(from, to + 1).map((u) => u.text).join(' ')
      return phrasebook.has(phraseKey(phrase)) || (await o.baseDictionary.lookup(phrase.toLowerCase())).length > 0
    }
    const flippable = (i: number) => langs[i] === o.lang && (marks[i] === 'both' || marks[i] === 'accents')
    for (let i = 0; i < list.length; i++) {
      if (!flippable(i)) continue
      search: for (let k = BASE_PHRASE_UNITS; k >= 2; k--) {
        for (let from = Math.max(0, i - k + 1); from <= i && from + k <= list.length; from++) {
          const to = from + k - 1
          const span = list.slice(from, to + 1).map((_, j) => from + j)
          if (!span.every((j) => langs[j] === o.base || flippable(j)) || !span.some((j) => langs[j] === o.base)) continue
          if (await isPhrase(from, to)) {
            for (const j of span) langs[j] = o.base
            break search
          }
        }
      }
    }
  }
  return langs
}
