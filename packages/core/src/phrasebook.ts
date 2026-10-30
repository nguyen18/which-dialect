// Sentence frames: common sentences with slots ("Where is {place}?" → "{place} ở {WHERE}?"), filled for a
// region, a listener and a register. The frames, their words and the pronoun table are the language's data
// (frames.json, pronouns.json), so this file has no language-specific rules: it picks words by region and
// labels, fills pronouns from the pronoun table, and translates content slots with the translator.
//
// Three directions: list and fill frames (`frames`, `render`), recognize an English sentence as a frame
// (`match`), and recognize a frame in a sentence in the language itself (`matchFrames`), which is how the
// journal review checks a sentence against frames ("Bạn có đi?" is the yes/no frame missing "không").

import { createDictionary, resolveRegion, type Dictionary } from './index.ts'
import { matchCase, plain } from './text.ts'
import { createTranslator, type Translator, type TranslatorOptions } from './translate.ts'
import {
  FRAME_PRONOUNS,
  type FrameData,
  type FramesData,
  type FrameWordChoice,
  type LanguageMeta,
  type PronounChoice,
  type PronounRow,
} from './types.ts'

export type FrameOptions = {
  /** The language to say it in, e.g. "vi". */
  lang: string
  /** Region or region group; its words come first, and words only used elsewhere are left out. */
  region?: string
  /** Who you're talking to, as a pronoun-table row id; without it, the table's default row. */
  listener?: string
  /** The speaker's gender, for pronouns that depend on it. */
  speaker?: 'male' | 'female'
  /** 'casual' allows colloquial words (Southern "hông", "tui"); otherwise they're left out. */
  register?: 'casual' | 'neutral' | 'polite'
}

/** One piece of a filled frame, with why it was chosen, for highlighting and explanations. */
export type FramePart = {
  text: string
  /** Fixed wording, a frame word ({WHERE}), a pronoun ({I}) or a content slot ({place}). */
  kind: 'fixed' | 'word' | 'pronoun' | 'content'
  slot?: string
  /** e.g. "where (Central)", "“I”, talking to your parents". */
  why?: string
  regions?: string[]
  /** For content slots given in English: the English, and whether no translation was found. */
  from?: string
  untranslated?: boolean
}

export type FilledFrame = {
  id: string
  topic: string
  /** The English way to say it, with slots filled when given. */
  en: string
  /** The sentence; open content slots stay as {name}. */
  text: string
  parts: FramePart[]
  /** The content slots and their parts of speech. */
  slots: { name: string; pos: 'noun' | 'verb' | 'adj' }[]
  /** true when every content slot is filled (and translated). */
  complete: boolean
  /** true for frames that can be part of a sentence ("but it was {quality}"). */
  clause?: boolean
}

/** A content slot value: English (translated for you) or `{ text }` in the target language. */
export type SlotValue = string | { text: string }

/** A frame recognized in a sentence in the language itself, and what the frame says should change. */
export type FrameMatch = {
  frame: { id: string; en: string }
  /** The sentence as the frame would have it, for the given region, listener and register. */
  text: string
  changes: { slot: string; from: string; to: string; why: string }[]
}

export type Phrasebook = {
  /** The language's frames, filled for the region, listener and register, with content slots open. */
  frames(options: FrameOptions & { topic?: string }): Promise<FilledFrame[]>
  /** One frame with its content slots filled. Unknown ids throw, listing the valid ones. */
  render(id: string, options: FrameOptions & { slots?: Record<string, SlotValue> }): Promise<FilledFrame>
  /** The frame an English sentence (or clause) follows, filled with its slot values; null when none. */
  match(english: string, options: FrameOptions): Promise<FilledFrame | null>
  /** Frames a sentence in the language itself follows, with the changes the frame suggests. */
  matchFrames(sentence: string, options: FrameOptions): Promise<FrameMatch[]>
}

export type PhrasebookOptions = TranslatorOptions & {
  /** Share a translator (and its dictionaries) instead of creating one. */
  translator?: Translator
}

const SLOT = /\{([A-Za-z_]+)\}/g
// Words for a casual register only.
const CASUAL = new Set(['colloquial', 'informal', 'familiar', 'slang', 'Internet'])
const PERSON_NAMES: Record<string, string> = {
  self: 'I', addressee: 'you', third: 'he/she', selfPlural: 'we', addresseePlural: 'you (plural)', thirdPlural: 'they',
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const quote = (s: string) => `“${s}”`
// Words and their accent-less forms ("tôi", "toi"), longest first so "chúng tôi" wins over "tôi".
const withPlain = (words: string[]) => [...new Set(words.flatMap((w) => [w, plain(w)]))].sort((a, b) => b.length - a.length)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// English sentences compare without case, curly quotes, extra spaces or the final punctuation.
const normalizeEn = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '').trim()
// Spaces after filling: one between words, none before punctuation or after an empty slot.
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([.,!?…])/g, '$1').trim()

type Choice = Pick<FrameWordChoice, 'word' | 'regions' | 'regionTagged' | 'labels' | 'when'> & { note?: string }

/** Everything filling a frame needs for one request: the language's data and the chosen row. */
type Setting = {
  meta: LanguageMeta
  data: FramesData
  rows: PronounRow[]
  row: PronounRow | undefined
  wanted: Set<string> | null
  casual: boolean
}

function choose<T extends Choice>(choices: T[], s: Setting): T | undefined {
  return choices
    .filter((c) => !s.wanted || c.regions.some((r) => s.wanted!.has(r)))
    .filter((c) => c.when !== 'respect' || s.row?.respect)
    .filter((c) => s.casual || !c.labels.some((l) => CASUAL.has(l)))
    .map((c, i) => ({ c, i, regional: s.wanted && c.regionTagged ? 1 : 0, casual: s.casual && c.labels.some((l) => CASUAL.has(l)) ? 1 : 0 }))
    .sort((a, b) => b.casual - a.casual || b.regional - a.regional || a.i - b.i)[0]?.c
}

function pronounChoices(row: PronounRow | undefined, slot: string): PronounChoice[] {
  const p = FRAME_PRONOUNS[slot]
  if (!row || !p) return []
  return row[p.person].filter((c) => p.inclusive === undefined || c.inclusive === undefined || c.inclusive === p.inclusive)
}

export function createPhrasebook(options: PhrasebookOptions = {}): Phrasebook {
  const cache = new Map<string, Dictionary>()
  const dict = (lang: string) => {
    let d = cache.get(lang)
    if (!d) {
      d = options.dictionary?.(lang) ?? createDictionary({ lang, baseUrl: options.baseUrl?.(lang), load: options.load?.(lang) })
      cache.set(lang, d)
    }
    return d
  }
  const translator = options.translator ?? createTranslator({ ...options, dictionary: dict })

  async function setting(o: FrameOptions): Promise<Setting> {
    const d = dict(o.lang)
    const [meta, data] = await Promise.all([d.meta(), d.frames()])
    // An unknown listener throws, listing the valid ones (as the translator does).
    if (meta.pronouns && o.listener) await d.pronouns({ listener: o.listener })
    const rows = meta.pronouns ? await d.pronouns({ region: o.region, speaker: o.speaker }) : []
    const row = o.listener ? rows.find((r) => r.id === o.listener) : rows.find((r) => r.default)
    return { meta, data, rows, row, wanted: resolveRegion(meta, o.region), casual: o.register === 'casual' }
  }

  // The word for a frame word or pronoun slot, with why; empty when the slot has no word here (no "ạ"
  // unless the listener's row is marked respect).
  function slotWord(name: string, s: Setting): FramePart {
    const words = s.data.words[name]
    if (words) {
      const c = choose(words.choices, s)
      if (!c) return { text: '', kind: 'word', slot: name }
      return {
        text: c.word, kind: 'word', slot: name, regions: c.regionTagged ? c.regions : undefined,
        why: `${words.meaning}${c.regionTagged ? ` (${c.regions.join(', ')})` : ''}${c.note ? `: ${c.note}` : ''}`,
      }
    }
    const c = choose(pronounChoices(s.row, name), s)
    const person = PERSON_NAMES[FRAME_PRONOUNS[name]?.person ?? '']
    if (!c) return { text: '', kind: 'pronoun', slot: name }
    return {
      text: c.word, kind: 'pronoun', slot: name, regions: c.regionTagged ? c.regions : undefined,
      why: `“${person}”${s.row && !s.row.default ? `, talking to ${lowerFirst(s.row.label)}` : ''}`,
    }
  }

  async function content(frame: FrameData, name: string, value: SlotValue | undefined, o: FrameOptions): Promise<FramePart> {
    if (value === undefined) return { text: `{${name}}`, kind: 'content', slot: name }
    if (typeof value !== 'string') return { text: value.text, kind: 'content', slot: name }
    const english = value.trim().replace(/^(the|a|an|some)\s+/i, '')
    const [group] = await translator.translate(english, {
      from: 'en', to: o.lang, toRegion: o.region, pos: frame.slots[name], register: o.register, limit: 1,
    }).catch(() => [])
    const word = group?.translations[0]?.word
    return word
      ? { text: word, kind: 'content', slot: name, from: value, why: `“${english}”`, regions: group.translations[0].regionTagged ? group.translations[0].regions : undefined }
      : { text: value, kind: 'content', slot: name, from: value, untranslated: true }
  }

  async function fill(frame: FrameData, o: FrameOptions, s: Setting, values: Record<string, SlotValue> = {}): Promise<FilledFrame> {
    const parts: FramePart[] = []
    let last = 0
    for (const m of frame.text.matchAll(SLOT)) {
      if (m.index! > last) parts.push({ text: frame.text.slice(last, m.index), kind: 'fixed' })
      const name = m[1]
      parts.push(frame.slots[name] ? await content(frame, name, values[name], o) : slotWord(name, s))
      last = m.index! + m[0].length
    }
    if (last < frame.text.length) parts.push({ text: frame.text.slice(last), kind: 'fixed' })
    let text = tidy(parts.map((p) => p.text).join(''))
    // The first letter, after any opening mark (Spanish "¿quieres…" → "¿Quieres…").
    if (!frame.clause) text = text.replace(/^([¿¡]?)(\p{L})/u, (_, mark: string, c: string) => mark + c.toUpperCase())
    const slots = Object.entries(frame.slots).map(([name, pos]) => ({ name, pos }))
    const en = Object.keys(frame.slots).reduce(
      (s, name) => (typeof values[name] === 'string' ? s.replace(`{${name}}`, values[name] as string) : s), frame.en[0])
    return {
      id: frame.id, topic: frame.topic, en, text, ...(frame.clause ? { clause: true } : {}),
      parts: parts.filter((p) => p.text),
      slots,
      complete: slots.every(({ name }) => values[name] !== undefined) && !parts.some((p) => p.untranslated),
    }
  }

  async function frameById(id: string, o: FrameOptions) {
    const s = await setting(o)
    const frame = s.data.frames.find((f) => f.id === id)
    if (!frame) {
      throw new Error(`which-dialect: unknown frame "${id}" for ${s.meta.name}. Use one of: ${s.data.frames.map((f) => f.id).join(', ') || '(none)'}`)
    }
    return { frame, s }
  }

  return {
    async frames(o) {
      const s = await setting(o)
      return Promise.all(s.data.frames.filter((f) => !o.topic || f.topic === o.topic).map((f) => fill(f, o, s)))
    },

    async render(id, o) {
      const { frame, s } = await frameById(id, o)
      return fill(frame, o, s, o.slots)
    },

    async match(english, o) {
      const s = await setting(o)
      const sentence = normalizeEn(english)
      for (const frame of s.data.frames) {
        for (const template of frame.en) {
          const names: string[] = []
          const pattern = escape(normalizeEn(template)).replace(/\\\{([A-Za-z_]+)\\\}/g, (_, name: string) => {
            names.push(name)
            return '(.+?)'
          })
          const m = new RegExp(`^${pattern}$`, 'u').exec(sentence)
          if (!m) continue
          const values = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]))
          const filled = await fill(frame, o, s, values)
          return { ...filled, en: english.trim() }
        }
      }
      return null
    },

    async matchFrames(sentence, o) {
      const s = await setting(o)
      const d = dict(o.lang)
      // Every pronoun of a column, in every row and region: a frame position decides it's a pronoun.
      const allRows = s.meta.pronouns ? await d.pronouns({ exclude: [] }) : []
      const terminal = /[?]\s*$/.test(sentence) ? '?' : ''
      const core = sentence.trim().replace(/[.!?…]+$/, '').trim()
      const out: FrameMatch[] = []
      for (const frame of s.data.frames) {
        if (frame.text.trim().endsWith('?') !== (terminal === '?')) continue
        const tokens = [...frame.text.replace(/[.!?…]+\s*$/, '').matchAll(/\{([A-Za-z_]+)\}|[^{]+/g)].map((m) => m[1] ? { slot: m[1] } : { fixed: m[0] })
        // Frames without fixed words ("{thing} {HOW}?") match only with every word present; frames with
        // fixed words can spot a missing required word ("Bạn có đi?" → "… không?"). Frames with neither
        // fixed words nor frame words ("{I} {quality}.") would match almost anything, so they're skipped.
        const anchored = tokens.some((t) => t.fixed && /\p{L}/u.test(t.fixed))
        if (!anchored && !tokens.some((t) => t.slot && s.data.words[t.slot])) continue
        const slots: { name: string; kind: 'content' | 'word' | 'pronoun'; optional: boolean }[] = []
        let pattern = ''
        for (const t of tokens) {
          if (t.fixed !== undefined) {
            pattern += t.fixed.trim() ? `\\s*${escape(t.fixed.trim()).replace(/\s+/g, '\\s+')}\\s*` : '\\s*'
            continue
          }
          const name = t.slot!
          if (frame.slots[name]) {
            slots.push({ name, kind: 'content', optional: false })
            pattern += '(.+?)'
          } else if (s.data.words[name]) {
            const alts = withPlain(s.data.words[name].choices.map((c) => c.word)).map(escape)
            const optional = Boolean(s.data.words[name].optional) || anchored
            slots.push({ name, kind: 'word', optional })
            pattern += `(${alts.join('|')})${optional ? '?' : ''}`
          } else {
            const alts = withPlain(allRows.flatMap((r) => pronounChoices(r, name)).map((c) => c.word))
            if (!alts.length) continue
            slots.push({ name, kind: 'pronoun', optional: false })
            pattern += `(${alts.map(escape).join('|')})`
          }
        }
        const m = new RegExp(`^${pattern}$`, 'iu').exec(core)
        if (!m) continue
        const changes: FrameMatch['changes'] = []
        const filled: Record<string, string> = {}
        slots.forEach((slot, i) => {
          let captured = m[i + 1] ?? ''
          filled[slot.name] = captured
          if (slot.kind === 'content') return
          // A word missing its accents in a frame position ("Toi" where the frame has a pronoun) is that word.
          const known = slot.kind === 'word'
            ? s.data.words[slot.name].choices.map((c) => c.word)
            : allRows.flatMap((r) => pronounChoices(r, slot.name)).map((c) => c.word)
          if (captured && !known.includes(captured.toLowerCase())) {
            const accented = known.find((w) => plain(w) === captured.toLowerCase())
            if (accented) {
              const fixed = matchCase(captured, accented)
              changes.push({ slot: slot.name, from: captured, to: fixed, why: `${quote(fixed)} needs its accents` })
              filled[slot.name] = captured = fixed
            }
          }
          const expected = slotWord(slot.name, s)
          if (slot.kind === 'pronoun') {
            // Pronouns change only for a chosen listener: in a journal, "Má" may be who you write about.
            const fits = pronounChoices(s.row, slot.name).some((c) => c.word === captured.toLowerCase())
            if (o.listener && expected.text && !fits) {
              filled[slot.name] = matchCase(captured, expected.text)
              changes.push({ slot: slot.name, from: captured, to: filled[slot.name], why: expected.why ?? '' })
            }
            return
          }
          const words = s.data.words[slot.name]
          const allowed = words.choices.filter((c) => choose([c], s))
          if (captured && !allowed.some((c) => c.word === captured.toLowerCase()) && expected.text) {
            filled[slot.name] = matchCase(captured, expected.text)
            changes.push({ slot: slot.name, from: captured, to: filled[slot.name], why: expected.why ?? '' })
          } else if (!captured && !words.optional && expected.text) {
            filled[slot.name] = expected.text
            changes.push({ slot: slot.name, from: '', to: expected.text, why: `${words.meaning}: this frame needs it` })
          }
        })
        let text = tidy(frame.text.replace(/[.!?…]+\s*$/, '').replace(SLOT, (_, name: string) => filled[name] ?? ''))
        text = matchCase(core, text) + (terminal || sentence.trim().match(/[.!?…]+$/)?.[0] || '')
        out.push({ frame: { id: frame.id, en: frame.en[0] }, text, changes })
      }
      return out
    },
  }
}
