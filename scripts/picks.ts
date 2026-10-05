// Hand-picked first choices: a speaker's judgment of the natural word for common English meanings,
// where the data ranks another word first ("get", "To fetch, bring, take" → Vietnamese "lấy").
//
// Rows live in the target language's config (languages/<lang>.ts `picks`), keyed by English meaning,
// so each language needs one list however many languages there are. This checks each row against the
// built English data (the meaning must exist) and the language's own data (each word must exist), and
// writes packages/<lang>/data/picks.json. Wiktionary rewords definitions, so rows that stop matching
// are reported, not silently dropped (like the pronoun table).
//
//   npm run build:picks -- <lang>     (after `npm run build:data -- <lang>`; needs the English data)

import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDictionary, type Dictionary, type LanguageMeta, type PickRow } from '../packages/core/src/index.ts'
import type { LanguageConfig, PickRowConfig } from './language-config.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const dataDir = (lang: string) => join(ROOT, 'packages', lang, 'data')
const localDictionary = (lang: string): Dictionary =>
  createDictionary({ lang, load: async (p) => JSON.parse(await readFile(join(dataDir(lang), p), 'utf8')) })

export type PicksReport = { rows: number; words: number; phrases: string[]; problems: string[] }

export async function buildPicks(rows: PickRowConfig[], english: Dictionary, target: Dictionary): Promise<{ rows: PickRow[]; report: PicksReport }> {
  const report: PicksReport = { rows: 0, words: 0, phrases: [], problems: [] }
  const out: PickRow[] = []
  for (const row of rows) {
    const where = `${row.word} (${row.pos}) ${row.gloss}`
    const senses = (await english.lookup(row.word)).filter((e) => e.pos === row.pos).flatMap((e) => e.senses)
    // A nested sense's own definition is its last gloss (the first is the heading it shares with its
    // siblings): senses whose own definition matches come first, so a pattern for "Of a living being…"
    // finds that sense alone, not every sense under the "old" heading. A pattern for a heading only
    // ("good", "Of a person or an animal:") is a choice for the whole heading: every sense under it.
    const own = senses.filter((s) => row.gloss.test(s.glosses.at(-1) ?? ''))
    const matching = own.length ? own : senses.filter((s) => s.glosses.some((g) => row.gloss.test(g)))
    if (!matching.length) {
      report.problems.push(`${where}: no English sense matches`)
      continue
    }
    if (own.length > 1) report.problems.push(`${where}: matches ${own.length} senses, using "${own[0].glosses.at(-1)}"`)
    const glosses = own.length ? [own[0].glosses.at(-1) ?? ''] : matching.map((s) => s.glosses.at(-1) ?? '')
    const picks: PickRow['picks'] = []
    for (const p of row.picks) {
      const pick = typeof p === 'string' ? { word: p } : p
      // Phrases that aren't headwords are kept ("bữa tối"); a single word that isn't one is likely a typo.
      if (!(await target.lookup(pick.word)).length) {
        if (pick.word.includes(' ')) report.phrases.push(pick.word)
        else report.problems.push(`${where}: "${pick.word}" isn't in the dictionary`)
      }
      picks.push(pick.tags?.length ? { word: pick.word, tags: pick.tags } : { word: pick.word })
    }
    const exclude = row.exclude?.filter((w) => !picks.some((p) => p.word === w)) ?? []
    for (const gloss of glosses) out.push({ word: row.word, pos: row.pos, gloss, picks, ...(exclude.length ? { exclude } : {}), ...(row.first ? { first: true } : {}) })
    report.rows++
    report.words += picks.length
  }
  return { rows: out, report }
}

/** Writes picks.json for a built language and sets meta.picks (or removes both when there are none). */
export async function writePicks(config: LanguageConfig): Promise<void> {
  const dir = dataDir(config.lang)
  const metaFile = join(dir, 'meta.json')
  const meta = JSON.parse(await readFile(metaFile, 'utf8')) as LanguageMeta
  delete meta.picks
  await rm(join(dir, 'picks.json'), { force: true })
  if (config.picks?.length) {
    if (!existsSync(join(dataDir('en'), 'meta.json'))) {
      console.warn('  WARNING: picks skipped: build the English data first (npm run build:data -- en)')
    } else {
      const { rows, report } = await buildPicks(config.picks, localDictionary('en'), localDictionary(config.lang))
      await writeFile(join(dir, 'picks.json'), JSON.stringify(rows))
      meta.picks = true
      console.log(`Picks: ${report.rows} English meanings, ${report.words} words`)
      if (report.phrases.length) console.log(`  phrases that aren't headwords: ${[...new Set(report.phrases)].join(', ')}`)
      for (const p of report.problems) console.warn(`  WARNING: ${p}`)
    }
  }
  await writeFile(metaFile, JSON.stringify(meta, null, 2))
}

async function main() {
  const lang = process.argv[2]
  if (!lang) throw new Error('usage: npm run build:picks -- <lang>')
  if (!existsSync(join(dataDir(lang), 'meta.json'))) throw new Error(`build the data first: npm run build:data -- ${lang}`)
  const config = (await import(join(ROOT, 'languages', `${lang}.ts`))).default as LanguageConfig
  await writePicks(config)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
