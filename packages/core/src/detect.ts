// Which language each word of a mixed text is in: the target language or the learner's own (the base,
// English by default), from the two languages' data alone. Shared by the checker and the journal review.

import type { Dictionary } from './index.ts'
import { plain, type Unit } from './text.ts'
import type { Translator } from './translate.ts'

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

export async function markLanguages(
  list: Unit[],
  o: { lang: string; base: string; target: Dictionary; baseDictionary: Dictionary; translator: Translator },
): Promise<string[]> {
  const syllables = await o.target.syllables()
  const syllableLanguage = Object.keys(syllables).length > 0
  const plainSyllables = syllableLanguage ? new Set(Object.keys(syllables).map(plain)) : new Set<string>()
  // 'exact': a target word as written; 'accents': one only with accents added ("khong" → "không").
  const targetKnows = async (u: Unit): Promise<'exact' | 'accents' | false> => {
    const lower = u.text.toLowerCase()
    // Languages written in words compare whole words: "cancion" is Spanish "canción" without its accent.
    if (!syllableLanguage) {
      if ((await o.target.lookup(lower)).length > 0) return 'exact'
      return (await o.target.variants(lower, { limit: 1 })).length > 0 ? 'accents' : false
    }
    if (lower in syllables || lower !== plain(lower)) return 'exact'
    return plainSyllables.has(lower) ? 'accents' : false
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
    const bare = plain(u.text.toLowerCase())
    let best = 0
    for (const [s, f] of Object.entries(syllables)) if (f > best && plain(s) === bare) best = f
    return best
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
  return decided.map((m, i) => {
    if (known(m)) return m
    const left = decided.slice(0, i).reverse().find(known)
    const right = decided.slice(i + 1).find(known)
    // A word written as typed in the base language needs every decided neighbor to be the target's to be
    // read as the target's without its accents ("Tôi met quá": mệt); otherwise it's the base's.
    if (m === '?accents') return (left ?? o.lang) === o.lang && (right ?? o.lang) === o.lang && (left || right) ? o.lang : o.base
    return left && right && left !== right ? o.lang : left ?? right ?? o.lang
  })
}
