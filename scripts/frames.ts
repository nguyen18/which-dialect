// Sentence frames for one language: the shared catalog (languages/frames.ts) joined with how the language
// says each frame (`frames` in languages/<lang>.ts) and the words for its frame word slots (`frameWords`,
// e.g. {WHERE}: "đâu", Central "mô"). Each word comes from a dictionary definition, keeping its region and
// labels, or from an override with a note, like the pronoun table. Problems are reported, not fatal.

import { FRAMES } from '../languages/frames.ts'
import { FRAME_PRONOUNS, toStored, type Entry, type FrameWordChoice, type Sense, type StoredFramesData } from '../packages/core/src/types.ts'
import type { FrameWordPick, LanguageConfig } from './language-config.ts'

export type FramesReport = { frames: number; fromGlosses: number; overrides: number; problems: string[] }

const SLOT = /\{([A-Za-z_]+)\}/g

export function buildFrames(entries: Entry[], config: LanguageConfig): { data: StoredFramesData; report: FramesReport } {
  const senses = new Map<string, Sense[]>()
  for (const e of entries) senses.set(e.word, [...(senses.get(e.word) ?? []), ...e.senses])
  const report: FramesReport = { frames: 0, fromGlosses: 0, overrides: 0, problems: [] }

  const pick = (key: string, p: FrameWordPick): FrameWordChoice | null => {
    const extra = { ...(p.when ? { when: p.when } : {}), ...(p.note ? { note: p.note } : {}) }
    if (!p.gloss) {
      report.overrides++
      return { word: p.word, source: 'override', regions: p.regions ?? config.regions, regionTagged: Boolean(p.regions), labels: p.labels ?? [], ...extra }
    }
    for (const s of senses.get(p.word) ?? []) {
      const gloss = s.glosses.find((g) => p.gloss!.test(g))
      if (!gloss) continue
      report.fromGlosses++
      return { word: p.word, gloss, source: 'gloss', regions: s.regions, regionTagged: s.regionTagged, labels: s.labels, ...extra }
    }
    report.problems.push(`${key}: no definition of ${p.word} matches ${p.gloss}`)
    return null
  }

  const words: StoredFramesData['words'] = {}
  for (const [key, w] of Object.entries(config.frameWords ?? {})) {
    if (!/^[A-Z_]+$/.test(key) || FRAME_PRONOUNS[key]) report.problems.push(`frameWords.${key}: use an uppercase name that isn't a pronoun slot`)
    words[key] = {
      meaning: w.meaning,
      ...(w.optional ? { optional: true } : {}),
      choices: w.words.map((p) => pick(key, p)).filter((c) => c !== null).map((c) => toStored(c)),
    }
  }

  const frames: StoredFramesData['frames'] = []
  for (const row of config.frames ?? []) {
    const entry = FRAMES.find((f) => f.id === row.frame)
    if (!entry) {
      report.problems.push(`frames: unknown frame "${row.frame}" (not in languages/frames.ts)`)
      continue
    }
    const slots = entry.slots ?? {}
    const used = [...row.text.matchAll(SLOT)].map((m) => m[1])
    for (const name of used) {
      if (!slots[name] && !FRAME_PRONOUNS[name] && !words[name]) report.problems.push(`${row.frame}: unknown slot {${name}}`)
    }
    for (const name of Object.keys(slots)) if (!used.includes(name)) report.problems.push(`${row.frame}: slot {${name}} isn't used`)
    for (const en of row.en ?? []) if (!entry.en.includes(en)) report.problems.push(`${row.frame}: "${en}" isn't one of the catalog's English ways`)
    const en = row.en?.filter((e) => entry.en.includes(e)) ?? entry.en
    frames.push({
      id: entry.id, topic: entry.topic, en: en.length ? en : entry.en, slots, ...(entry.clause ? { clause: true } : {}), text: row.text,
    })
  }
  report.frames = frames.length
  return { data: { frames, words }, report }
}
