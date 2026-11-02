// Reviewing a journal entry written in the target language, the learner's own language, or a mix of both
// ("Hôm nay tôi đi market với má"), and giving the corrected entry in the target language. For each sentence:
//
//   1. Each word is marked as the target or the base language (detect.ts), from the two dictionaries alone.
//   2. A whole base-language sentence or clause that follows a sentence frame is filled in ("but it was
//      expensive" → "nhưng mắc quá"; "Where is the bathroom?" → "Phòng tắm ở đâu?").
//   3. The checker runs on the whole entry. By default that's the spellchecker: every misspelled word gets
//      its accents ("khong" → "không") and every remaining base-language word its translation ("market" →
//      "chợ"); opt-in checks (`checks`: regions, pronouns, consistency, polite endings) join it. Errors and
//      warnings are applied; suggestions are returned as hints.
//   4. The sentence frames the corrected sentence follows are listed, for the learner to reuse. Frames don't
//      change the sentence.
//
// Everything is rule-based and runs on the language's data: no API, and nothing language-specific here.

import { createChecker, type CheckRule } from './check.ts'
import { markLanguages } from './detect.ts'
import { createDictionary, type Dictionary } from './index.ts'
import { createPhrasebook, type FrameOptions } from './phrasebook.ts'
import { sentencesOf, units, type Unit } from './text.ts'
import { createTranslator, type TranslatorOptions } from './translate.ts'

export type ReviewOptions = FrameOptions & {
  /** The learner's own language, whose words are translated into the target language (default "en"). */
  base?: string
  /** Checks to add to the spellchecker, e.g. { dialect: true, 'pronoun-consistency': true } (see CheckRule). */
  checks?: Partial<Record<CheckRule, boolean>>
}

export type ReviewChange = {
  /** What was written. */
  from: string
  /** The correction; empty when the word is left out (Vietnamese has no "the"). */
  to: string
  /** One sentence for the learner. */
  why: string
  /** 'frame' (a base-language sentence or clause filled into a sentence frame), or the checker rule. */
  kind: 'frame' | CheckRule
}

/** A checker suggestion that wasn't applied ("end with ạ"), for the learner to consider. */
export type ReviewHint = { rule: CheckRule; text: string; message: string; suggestions: string[] }

export type ReviewSentence = {
  /** Offsets of the sentence in Review.text, including its final punctuation. */
  start: number
  end: number
  original: string
  /** The sentence split by language, e.g. [{ text: 'Hôm nay tôi đi', lang: 'vi' }, { text: 'market', lang: 'en' }, …]. */
  parts: { text: string; lang: string }[]
  corrected: string
  changes: ReviewChange[]
  hints: ReviewHint[]
  /** Sentence frames the sentence follows or was built from: the frame's English and its pattern. */
  frames: { id: string; en: string; text: string }[]
  /** Words the review couldn't correct (a base-language word with no translation), left as written. */
  unchecked: string[]
}

export type Review = {
  /** The entry, in Unicode NFC form; sentence offsets refer to it. */
  text: string
  /** The whole entry with every sentence corrected. */
  corrected: string
  sentences: ReviewSentence[]
}

export type Reviewer = {
  review(entry: string, options: ReviewOptions): Promise<Review>
}

// What a sentence keeps around its words: closing quotes and brackets with the end punctuation ('"hola".'),
// and the opening ones right before its first word (Spanish "¡", "¿").
const TERMINAL = /^[.!?…"”’'»)\]]+/
const OPENING = /[¿¡"“‘'«(\[]+$/
// Spaces after a word was left out: one between words, none before punctuation.
const tidy = (s: string) => s.replace(/[^\S\n]+/g, ' ').replace(/ ([.,!?…])/g, '$1').trim()

export function createReviewer(options: TranslatorOptions = {}): Reviewer {
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
  const phrasebook = createPhrasebook({ ...options, dictionary: dict, translator })
  const checker = createChecker({ ...options, dictionary: dict })

  return {
    async review(entry, o) {
      const text = entry.normalize('NFC')
      const base = o.base ?? 'en'
      // A frame as shown to the learner: its English and its pattern for these settings, slots open.
      const frameInfo = new Map<string, { id: string; en: string; text: string }>()
      const frameOf = async (id: string) => {
        if (!frameInfo.has(id)) {
          const f = await phrasebook.render(id, o)
          frameInfo.set(id, { id, en: f.en, text: f.text })
        }
        return frameInfo.get(id)!
      }

      // 1–2. Sentences, languages, and base-language sentences or clauses that follow a frame.
      type Draft = {
        start: number; coreEnd: number; end: number; parts: ReviewSentence['parts']
        replacements: { start: number; end: number; to: string; change: ReviewChange }[]
        frames: ReviewSentence['frames']
      }
      const drafts: Draft[] = []
      for (const list of sentencesOf(text, units(text))) {
        const start = list[0].start - (OPENING.exec(text.slice(drafts[drafts.length - 1]?.end ?? 0, list[0].start))?.[0].length ?? 0)
        const coreEnd = list[list.length - 1].end
        const end = coreEnd + (TERMINAL.exec(text.slice(coreEnd))?.[0].length ?? 0)
        const langs = base === o.lang ? list.map(() => o.lang) : await markLanguages(list, { lang: o.lang, base, target: dict(o.lang), baseDictionary: dict(base), translator })
        const groups: { lang: string; units: Unit[] }[] = []
        list.forEach((u, i) => {
          if (groups.length && groups[groups.length - 1].lang === langs[i]) groups[groups.length - 1].units.push(u)
          else groups.push({ lang: langs[i], units: [u] })
        })
        const draft: Draft = {
          start, coreEnd, end, replacements: [], frames: [],
          parts: groups.map((g) => ({ text: text.slice(g.units[0].start, g.units[g.units.length - 1].end), lang: g.lang })),
        }
        const whole = groups.length === 1 && groups[0].lang === base
        const fill = async (span: Unit[], frame: NonNullable<Awaited<ReturnType<typeof phrasebook.match>>>) => {
          const from = text.slice(span[0].start, span[span.length - 1].end)
          const info = await frameOf(frame.id)
          let to = frame.text.replace(/[.!?…]+$/, '')
          if (span[0].start !== start) to = to.charAt(0).toLowerCase() + to.slice(1)
          draft.replacements.push({
            start: span[0].start, end: span[span.length - 1].end, to,
            change: { kind: 'frame', from, to, why: `Sentence frame “${info.en}”` },
          })
          draft.frames.push(info)
        }
        for (const g of groups.filter((g) => g.lang === base)) {
          // A whole sentence is matched with its own punctuation ("Where is the bathroom?").
          const whole_ = whole ? text.slice(start, end) : text.slice(g.units[0].start, g.units[g.units.length - 1].end)
          const frame = await phrasebook.match(whole_, o)
          if (frame?.complete) {
            await fill(g.units, frame)
            continue
          }
          // Otherwise a clause frame ending the part, longest first ("the ice cream but it was expensive":
          // "but it was expensive"); the rest is translated word by word by the checker. Only spans ending
          // with the part, so a clause isn't cut short ("but it was very" with "expensive" left over).
          for (let len = g.units.length - 1; len >= 2; len--) {
            const span = g.units.slice(g.units.length - len)
            const m = await phrasebook.match(text.slice(span[0].start, span[len - 1].end), o)
            if (!m?.complete || !m.clause) continue
            await fill(span, m)
            break
          }
        }
        drafts.push(draft)
      }

      // The entry with those parts filled in, keeping where each sentence now is.
      let draftText = ''
      let cursor = 0
      const placed: { start: number; coreEnd: number; end: number }[] = []
      for (const d of drafts) {
        draftText += text.slice(cursor, d.start)
        const s = draftText.length
        let core = text.slice(d.start, d.coreEnd)
        for (const r of [...d.replacements].sort((a, b) => b.start - a.start)) {
          core = core.slice(0, r.start - d.start) + r.to + core.slice(r.end - d.start)
        }
        if (/\p{Lu}/u.test(text.charAt(d.start))) core = core.charAt(0).toUpperCase() + core.slice(1)
        draftText += core + text.slice(d.coreEnd, d.end)
        placed.push({ start: s, coreEnd: s + core.length, end: draftText.length })
        cursor = d.end
      }
      draftText += text.slice(cursor)

      // 3. The checker on the whole entry; 4. the frames each corrected sentence follows.
      const { issues } = await checker.check(draftText, {
        lang: o.lang, base, region: o.region, listener: o.listener, speaker: o.speaker, register: o.register, rules: o.checks,
      })
      const sentences: ReviewSentence[] = []
      for (const [i, d] of drafts.entries()) {
        const p = placed[i]
        const mine = issues.filter((x) => x.start >= p.start && x.end <= p.coreEnd)
        const changes: ReviewChange[] = d.replacements.sort((a, b) => a.start - b.start).map((r) => r.change)
        const hints: ReviewHint[] = []
        const unchecked: string[] = []
        const applied: ReviewChange[] = []
        let core = draftText.slice(p.start, p.coreEnd)
        let lastStart = Infinity
        for (const x of [...mine].sort((a, b) => b.start - a.start)) {
          if (!x.suggestions.length) {
            if (x.rule === 'foreign-word') unchecked.unshift(x.text)
            else hints.unshift({ rule: x.rule, text: x.text, message: x.message, suggestions: x.suggestions })
            continue
          }
          if (x.severity === 'suggestion' || x.end > lastStart) {
            hints.unshift({ rule: x.rule, text: x.text, message: x.message, suggestions: x.suggestions })
            continue
          }
          core = core.slice(0, x.start - p.start) + x.suggestions[0] + core.slice(x.end - p.start)
          applied.unshift({ kind: x.rule, from: x.text, to: x.suggestions[0], why: x.message })
          lastStart = x.start
        }
        changes.push(...applied)
        core = tidy(core)
        if (/\p{Lu}/u.test(draftText.charAt(p.start))) core = core.charAt(0).toUpperCase() + core.slice(1)
        const corrected = core + draftText.slice(p.coreEnd, p.end)
        const frames = [...d.frames]
        for (const m of await phrasebook.matchFrames(corrected, o)) {
          if (!frames.some((f) => f.id === m.frame.id)) frames.push(await frameOf(m.frame.id))
        }
        sentences.push({
          start: d.start, end: d.end, original: text.slice(d.start, d.end), parts: d.parts,
          corrected, changes, hints, frames, unchecked,
        })
      }

      let corrected = ''
      cursor = 0
      for (const s of sentences) {
        corrected += text.slice(cursor, s.start) + s.corrected
        cursor = s.end
      }
      corrected += text.slice(cursor)
      return { text, corrected, sentences }
    },
  }
}
