// Review sheet for hand-picked words: machine-drafted, reviewed by a speaker of the language.
//
//   npm run picks-sheet -- <lang> [--top 100 | --words list.txt] [--out file.csv]
//   npm run picks-sheet -- <lang> --apply file.csv
//
// The sheet lists the most frequent English words (wordfreq) or the words in a file (one per line; a
// leading "12. " is ignored), with each meaning's current top 3 from the ranking alone (picks off),
// Wiktionary's translation-table words and the current pick. A speaker fills in `your_pick` only where
// the first choice is wrong: words separated by "/", a region in parentheses ("heo (Southern) / lợn").
// --apply prints config rows for the filled-in rows, to paste into languages/<lang>.ts `picks`.
// Works the same for every language; only the reviewing needs a speaker.
//
// Or as a review page (an HTML page published as a claude.ai Artifact, saving decisions in its db):
//
//   npm run picks-sheet -- <lang> --top 300 --drafts reviews/<lang>-top300.json --html page.html
//   npm run picks-sheet -- <lang> --apply-decisions <dir> [--drafts reviews/<lang>-top300.json]
//
// The drafts file holds suggested picks for some meanings ({ rows: [{ english, pos, meaning (the start
// of the definition is enough), picks, confidence: 'sure' | 'check', why, example: { en, target }, first? }] });
// drafts for meanings the sheet doesn't list (an everyday meaning Wiktionary lists late) become extra rows.
// The page (scripts/picks-review.html) shows each meaning's current top words beside its draft; the
// reviewer keeps the current words, uses the suggestion, or types their own. Rows have stable ids, so a
// regenerated page keeps saved decisions. --apply-decisions reads the decisions (the db's "decisions"
// collection, saved as JSON files, e.g. with the Artifact tool's read_db and out_dir) and prints config rows.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDictionary, createTranslator, type PickRow } from '../packages/core/src/index.ts'
import { topWords } from './frequency.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COLUMNS = ['english', 'pos', 'meaning', 'ranked_top3', 'table_words', 'current_pick', 'your_pick']

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') row.push(cell), (cell = '')
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell), rows.push(row), (row = []), (cell = '')
    } else cell += ch
  }
  if (cell || row.length) row.push(cell), rows.push(row)
  return rows.filter((r) => r.some((c) => c.trim()))
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const load = (l: string) => async (p: string) => JSON.parse(await readFile(join(ROOT, 'packages', l, 'data', p), 'utf8'))

/** One meaning of an English word, with the target's current words for it. */
type SheetRow = { english: string; pos: string; meaning: string; ranked: string[]; table: string; current: string }

async function sheet(lang: string) {
  const tr = createTranslator({ load })
  const listFile = arg('--words')
  const words = listFile
    ? (await readFile(listFile, 'utf8')).split('\n').map((l) => l.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean)
    : await topWords(ROOT, 'en', 'large', Number(arg('--top') ?? 100))
  const picksFile = join(ROOT, 'packages', lang, 'data', 'picks.json')
  const picks: PickRow[] = existsSync(picksFile) ? JSON.parse(await readFile(picksFile, 'utf8')) : []

  const lines = [COLUMNS.join(',')]
  const rows: SheetRow[] = []
  const seen = new Set<string>()
  let meanings = 0
  let picked = 0
  for (const word of words) {
    // The first few meanings, as the translator orders them without context, from the ranking alone.
    const groups = (await tr.translate(word, { from: 'en', to: lang, limit: 3, picks: false })).slice(0, 4)
    for (const g of groups) {
      const s = g.source
      const key = `${s.lemma}\u0000${s.pos}\u0000${s.glosses[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      meanings++
      const current = picks.find((p) => p.word === s.lemma && p.pos === s.pos && p.gloss === s.glosses[0])
      if (current) picked++
      const row: SheetRow = {
        english: s.lemma, pos: s.pos, meaning: s.glosses[0] ?? '',
        ranked: g.translations.map((t) => t.word),
        table: (s.translations?.[lang] ?? []).map((t) => t.word + (t.tags?.length ? ` (${t.tags.join(', ')})` : '')).join(' / '),
        current: current?.picks.map((p) => p.word + (p.tags?.length ? ` (${p.tags.join(', ')})` : '')).join(' / ') ?? '',
      }
      rows.push(row)
      lines.push([row.english, row.pos, row.meaning, row.ranked.join(' / '), row.table, row.current, ''].map(csvCell).join(','))
    }
  }
  const html = arg('--html')
  if (html) return reviewPage(lang, rows, words.length, html)
  const out = arg('--out') ?? join(ROOT, '.cache', `picks-${lang}.csv`)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, lines.join('\n') + '\n')
  console.log(`${words.length} English words, ${meanings} meanings; ${picked} already picked. Wrote ${out}`)
}

/** A drafted pick for one meaning, from the drafts file (see the top of this file). */
type Draft = {
  english: string; pos: string; meaning: string; picks: string[]
  confidence?: 'sure' | 'check'; why?: string; example?: { en: string; target: string }; first?: boolean
}
// Parts of speech the review page files under "Grammar words" (handled by the pronoun table and the
// translator's grammar rules more than by picks).
const GRAMMAR_POS = new Set(['article', 'prep', 'conj', 'particle', 'pron', 'det', 'num'])
// A row's id in the page's db: stable across regenerated pages, so saved decisions stay with their row.
const rowId = (english: string, pos: string, meaning: string) =>
  'm' + createHash('sha1').update(`${english}\u0000${pos}\u0000${meaning}`).digest('hex').slice(0, 12)

async function readDrafts(file: string | undefined): Promise<Draft[]> {
  return file ? ((JSON.parse(await readFile(file, 'utf8')) as { rows: Draft[] }).rows ?? []) : []
}

async function reviewPage(lang: string, rows: SheetRow[], wordCount: number, out: string) {
  const drafts = await readDrafts(arg('--drafts'))
  const target = createDictionary({ lang, load: load(lang) })
  const meta = await target.meta()
  const used = new Set<Draft>()
  const findDraft = (r: { english: string; pos: string; meaning: string }) =>
    drafts.find((d) => !used.has(d) && d.english === r.english && d.pos === r.pos && r.meaning.startsWith(d.meaning))
  // Picks that aren't headwords (phrases like "bữa tối"), so the reviewer knows.
  const phrases = async (words: string[]) =>
    (await Promise.all(words.map(async (w) => ((await target.lookup(w)).some((e) => e.word === w) ? null : w)))).filter((w) => w !== null)
  const page: (SheetRow & { id: string; kind: string } & Record<string, unknown>)[] = []
  for (const r of rows) {
    const d = findDraft(r)
    if (d) used.add(d)
    page.push({
      id: rowId(r.english, r.pos, r.meaning), ...r,
      kind: d ? 'draft' : GRAMMAR_POS.has(r.pos) ? 'grammar' : 'fine',
      ...(d ? { draft: d.picks, conf: d.confidence ?? 'check', why: d.why ?? '', phrases: await phrases(d.picks), ...(d.example ? { example: d.example } : {}) } : {}),
    })
  }
  // Drafts for meanings the sheet doesn't list: everyday meanings Wiktionary lists late.
  for (const d of drafts.filter((x) => !used.has(x))) {
    page.push({
      id: rowId(d.english, d.pos, d.meaning), english: d.english, pos: d.pos, meaning: d.meaning, ranked: [], table: '', current: '',
      kind: 'draft', draft: d.picks, conf: d.confidence ?? 'check', why: d.why ?? '', phrases: await phrases(d.picks),
      extra: true, first: Boolean(d.first), ...(d.example ? { example: d.example } : {}),
    })
  }
  const template = await readFile(join(ROOT, 'scripts', 'picks-review.html'), 'utf8')
  const regionExample = meta.regions.length > 1 ? `word (${meta.regions[meta.regions.length - 1]}) / word` : 'word / other word'
  const fill: Record<string, string> = {
    __TITLE__: `${meta.name} Everyday Words Review`,
    __HEADING__: `Everyday words: ${meta.name} first choices`,
    __INTRO__: `The ${wordCount} most common`,
    __LANG_NAME__: meta.name,
    __LANG__: lang,
    __REGION_EXAMPLE__: regionExample,
    __ROWS__: JSON.stringify(page).replace(/<\//g, '<\\/'),
  }
  const html = template.replace(/__[A-Z_]+__/g, (k) => fill[k] ?? k)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)
  const count = (k: string) => page.filter((p) => p.kind === k).length
  console.log(`${page.length} rows: ${count('draft')} drafted (${drafts.length - used.size === 0 ? 'all' : used.size} matched the sheet), ${count('fine')} look fine, ${count('grammar')} grammar words. Wrote ${out}`)
}

/** "heo (Southern) / lợn" → config pick literals. */
function pickLiterals(cell: string): string[] {
  return cell.split('/').map((p) => {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(p.trim())
    const word = (m ? m[1] : p).trim()
    const tags = m ? m[2].split(',').map((t) => t.trim()).filter(Boolean) : []
    return tags.length ? `{ word: ${JSON.stringify(word)}, tags: ${JSON.stringify(tags)} }` : JSON.stringify(word)
  })
}

async function applyDecisions(lang: string, path: string) {
  // A directory of saved documents (read_db with out_dir writes <dir>/decisions/<id>.json), or one JSON array.
  const files = path.endsWith('.json')
    ? [path]
    : await (async () => {
        const dir = existsSync(join(path, 'decisions')) ? join(path, 'decisions') : path
        return (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => join(dir, f))
      })()
  const docs: { status: string; picks?: string; english: string; pos: string; meaning: string }[] = []
  for (const f of files) {
    const v = JSON.parse(await readFile(f, 'utf8'))
    docs.push(...(Array.isArray(v) ? v : [v.data ?? v]))
  }
  const drafts = await readDrafts(arg('--drafts'))
  const out: string[] = []
  let kept = 0
  for (const d of docs.sort((a, b) => a.english.localeCompare(b.english))) {
    if (d.status === 'reject') kept++
    if ((d.status !== 'accept' && d.status !== 'edit') || !d.picks?.trim()) continue
    const draft = drafts.find((x) => x.english === d.english && x.pos === d.pos && d.meaning.startsWith(x.meaning))
    const first = draft?.first ? ', first: true' : ''
    const note = draft?.why && d.status === 'accept' ? `\n      note: ${JSON.stringify(draft.why)},` : ''
    out.push(`    {\n      word: ${JSON.stringify(d.english)}, pos: ${JSON.stringify(d.pos)}, gloss: ${glossPattern(d.meaning)}, picks: [${pickLiterals(d.picks).join(', ')}]${first},${note}\n    },`)
  }
  console.log(`// ${out.length} picks from ${docs.length} decisions (${kept} kept as they are). Paste into languages/${lang}.ts \`picks\`, then rebuild.`)
  console.log(out.join('\n'))
}

// A definition pattern for the config: the start of the gloss, cut at a word boundary.
function glossPattern(gloss: string): string {
  let start = gloss.length <= 40 ? gloss : gloss.slice(0, 40).replace(/\s+\S*$/, '')
  start = start.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return `/^${start}/`
}

async function apply(lang: string, file: string) {
  const [header, ...rows] = parseCsv(await readFile(file, 'utf8'))
  const col = (name: string) => header.indexOf(name)
  const [en, pos, meaning, mine] = ['english', 'pos', 'meaning', 'your_pick'].map(col)
  if ([en, pos, meaning, mine].some((i) => i < 0)) throw new Error(`${file} needs the columns ${COLUMNS.join(', ')}`)
  const out: string[] = []
  for (const r of rows) {
    const cell = r[mine]?.trim()
    if (!cell) continue
    const picks = pickLiterals(cell)
    out.push(`    { word: ${JSON.stringify(r[en])}, pos: ${JSON.stringify(r[pos])}, gloss: ${glossPattern(r[meaning])}, picks: [${picks.join(', ')}] },`)
  }
  console.log(out.length ? `// Paste into languages/${lang}.ts \`picks\`, then run: npm run build:picks -- ${lang}\n${out.join('\n')}` : 'No rows have your_pick filled in.')
}

async function main() {
  const lang = process.argv[2]
  if (!lang || lang.startsWith('--')) {
    throw new Error('usage: npm run picks-sheet -- <lang> [--top N | --words file] [--out file.csv | --html page.html [--drafts file.json]] | --apply file.csv | --apply-decisions dir [--drafts file.json]')
  }
  const applyFile = arg('--apply')
  if (applyFile) return apply(lang, applyFile)
  const decisions = arg('--apply-decisions')
  if (decisions) return applyDecisions(lang, decisions)
  if (!existsSync(join(ROOT, 'packages', lang, 'data', 'meta.json'))) throw new Error(`build the data first: npm run build:data -- ${lang}`)
  await sheet(lang)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
