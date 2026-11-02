// The everyday phrasebook: common multi-word phrases and an English way to say each, written by a speaker
// rather than taken from a corpus ("ở nhà" "at home", "have you eaten?" "ăn cơm chưa"). The translator
// reads it in both directions for multi-word input (see phrasebookGroup in packages/core/src/translate.ts).
//
// Rows live in languages/phrases/<lang>.tsv, one English–phrase pair per line:
//   English<TAB>phrase<TAB>regions (optional, comma-separated)<TAB>note (optional)
// "## Topic" lines start a topic; other "#" lines are comments. This checks regions against the config
// and, for languages written in syllables, every syllable against the built syllable list (unknown ones
// are reported, not dropped: loanwords like "video" are real usage), and writes
// packages/<lang>/data/phrases.json.
//
//   npm run build:phrases -- <lang>     (after `npm run build:data -- <lang>`)

import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { phraseKey, type LanguageMeta, type StoredPhrases } from '../packages/core/src/index.ts'
import type { LanguageConfig } from './language-config.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = (lang: string) => join(ROOT, 'packages', lang, 'data')
export const phrasesSource = (lang: string) => join(ROOT, 'languages', 'phrases', `${lang}.tsv`)

export type PhrasesReport = { rows: number; topics: number; problems: string[]; unknownSyllables: string[] }

export function parsePhrases(tsv: string, regions: string[], syllables: Record<string, number> | null): { data: StoredPhrases; report: PhrasesReport } {
  const data: StoredPhrases = { topics: [], rows: [] }
  const report: PhrasesReport = { rows: 0, topics: 0, problems: [], unknownSyllables: [] }
  const seen = new Set<string>()
  const unknown = new Set<string>()
  tsv.split('\n').forEach((raw, i) => {
    const line = raw.normalize('NFC').replace(/\r$/, '')
    const topic = /^## (.+)$/.exec(line)
    if (topic) return void data.topics.push(topic[1].trim())
    if (!line.trim() || line.startsWith('#')) return
    const [en, text, tags = '', note = ''] = line.split('\t').map((c) => c.trim())
    const where = `line ${i + 1}`
    if (!en || !text) return void report.problems.push(`${where}: needs English and the phrase, tab-separated`)
    if (!data.topics.length) return void report.problems.push(`${where}: before the first "## Topic"`)
    const rowRegions = tags ? tags.split(',').map((t) => t.trim()) : []
    const bad = rowRegions.filter((r) => !regions.includes(r))
    if (bad.length) return void report.problems.push(`${where}: unknown region ${bad.join(', ')} (regions: ${regions.join(', ')})`)
    const key = `${phraseKey(en)}\t${phraseKey(text)}`
    if (seen.has(key)) return void report.problems.push(`${where}: repeats "${en}" / "${text}"`)
    seen.add(key)
    if (syllables) for (const s of phraseKey(text).split(/[\s-]+/)) if (!(s in syllables)) unknown.add(s)
    data.rows.push({
      en, text, topic: data.topics.length - 1,
      ...(rowRegions.length ? { regions: regions.filter((r) => rowRegions.includes(r)) } : {}),
      ...(note ? { note } : {}),
    })
  })
  report.rows = data.rows.length
  report.topics = data.topics.length
  report.unknownSyllables = [...unknown]
  return { data, report }
}

/** Writes phrases.json for a built language and sets meta.phrases (or removes both when it has none). */
export async function writePhrases(config: LanguageConfig): Promise<void> {
  const dir = dataDir(config.lang)
  const metaFile = join(dir, 'meta.json')
  const meta = JSON.parse(await readFile(metaFile, 'utf8')) as LanguageMeta
  delete meta.phrases
  await rm(join(dir, 'phrases.json'), { force: true })
  if (existsSync(phrasesSource(config.lang))) {
    const syllables = meta.syllables ? JSON.parse(await readFile(join(dir, 'syllables.json'), 'utf8')) as Record<string, number> : null
    const { data, report } = parsePhrases(await readFile(phrasesSource(config.lang), 'utf8'), config.regions, syllables)
    await writeFile(join(dir, 'phrases.json'), JSON.stringify(data))
    meta.phrases = true
    console.log(`Phrasebook: ${report.rows} phrases in ${report.topics} topics`)
    if (report.unknownSyllables.length) console.log(`  syllables not in the syllable list: ${report.unknownSyllables.join(', ')}`)
    for (const p of report.problems) console.warn(`  WARNING: ${p}`)
  }
  await writeFile(metaFile, JSON.stringify(meta, null, 2))
}

async function main() {
  const lang = process.argv[2]
  if (!lang) throw new Error('usage: npm run build:phrases -- <lang>')
  if (!existsSync(join(dataDir(lang), 'meta.json'))) throw new Error(`build the data first: npm run build:data -- ${lang}`)
  const config = (await import(join(ROOT, 'languages', `${lang}.ts`))).default as LanguageConfig
  await writePhrases(config)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
