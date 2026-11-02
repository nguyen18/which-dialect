// Measures how well the Vietnamese spellchecker fixes misspelled common multi-syllable words.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/evaluate-spelling.ts [--top N] [--examples N] [--verbose]
//
// Takes the N most common accented headwords of 2–3 syllables, makes four kinds of misspelling of each
// (all accents off; one syllable's accents off; a wrong tone; a wrong tone with the other syllables off),
// runs the checker on each and applies its first spelling suggestions. The correct words themselves are
// checked for false positives, and so are the dictionary's own example sentences (of its most common
// headwords: real Vietnamese, though some use old or regional spellings). Every result goes to
// .cache/spelling-eval.json.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createChecker, plain, type CheckIssue, type Entry } from '../packages/core/src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LANG = 'vi'
const DEFAULT_TOP = 300
const MAX_FAILURES_SHOWN = 40
// Example sentences checked for false positives (--examples N).
const DEFAULT_EXAMPLES = 1000
// Combining tone marks: huyền, sắc, ngã, hỏi, nặng. Tried in this order.
const TONES = ['̀', '́', '̃', '̉', '̣']

type Kind = 'plain' | 'plain-one' | 'wrong-tone' | 'wrong-tone+plain'
const KINDS: Kind[] = ['plain', 'plain-one', 'wrong-tone', 'wrong-tone+plain']
type Outcome = 'fixed' | 'wrong' | 'none'
type Case = { word: string; kind: Kind; input: string }
type CaseResult = Case & {
  corrected: string
  outcome: Outcome
  /** The correct word is among the options (spliced in at one issue), though not the first. */
  listed: boolean
  /** Each spelling issue's suggestions, in order. */
  options: string[][]
}
type WordResult = { word: string; falsePositive: boolean; issues: CheckIssue[] }

const load = (lang: string) => async (p: string) => JSON.parse(await readFile(join(ROOT, 'packages', lang, 'data', p), 'utf8'))

function parseCount(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i < 0) return fallback
  const n = Number(process.argv[i + 1])
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer, got "${process.argv[i + 1] ?? ''}"`)
  return n
}

/** Every headword from the word shards, merged by key. */
async function loadHeadwords(): Promise<Map<string, Entry[]>> {
  const files = (await readdir(join(ROOT, 'packages', LANG, 'data', 'words'))).filter((f) => f.endsWith('.json')).sort()
  const headwords = new Map<string, Entry[]>()
  for (const f of files) {
    const shard = (await load(LANG)(`words/${f}`)) as Record<string, Entry[]>
    for (const [key, entries] of Object.entries(shard)) headwords.set(key.normalize('NFC'), [...(headwords.get(key.normalize('NFC')) ?? []), ...entries])
  }
  return headwords
}

/** Common multi-syllable words: the top `top`, most frequent first. */
function pickWords(headwords: Map<string, Entry[]>, syllables: Record<string, number>, top: number): { key: string; freq: number }[] {
  const picked: { key: string; freq: number }[] = []
  for (const [key, entries] of headwords) {
    const syls = key.split(' ')
    const spaces = syls.length - 1
    if (spaces < 1 || spaces > 2) continue
    if (key !== key.toLowerCase()) continue
    if (!syls.every((s) => Object.hasOwn(syllables, s))) continue
    if (!entries.some((e) => e.pos !== 'name' && !e.senses.every((s) => s.altOf !== undefined))) continue
    if (plain(key) === key) continue
    picked.push({ key, freq: Math.max(-1, ...entries.map((e) => e.frequency ?? -1)) })
  }
  picked.sort((a, b) => b.freq - a.freq || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return picked.slice(0, top)
}

// Vowel marks (circumflex, breve, horn): a tone goes on the vowel carrying one.
const VOWEL_MARK = /[\u0302\u0306\u031b]/u

/**
 * The syllable with its tone replaced, or added on its main vowel (one with a vowel mark, else the first
 * vowel after a "qu"/"gi" onset), NFC; null when it has no vowel.
 */
function withTone(syllable: string, tone: string): string | null {
  const d = syllable.normalize('NFD')
  const current = TONES.find((t) => d.includes(t))
  if (current) return d.replace(current, tone).normalize('NFC')
  const marked = d.search(VOWEL_MARK)
  let i = marked - 1
  if (marked < 0) {
    const onset = /^(qu|gi)(?=[aeiouy])/i.exec(d)?.[0].length ?? 0
    const at = d.slice(onset).search(/[aeiouy]/i)
    if (at < 0) return null
    i = onset + at
  }
  // After the vowel and its vowel marks.
  let end = i + 1
  while (end < d.length && VOWEL_MARK.test(d[end])) end++
  return (d.slice(0, end) + tone + d.slice(end)).normalize('NFC')
}

/** The misspellings of one word, with duplicates (and the word itself) dropped. */
function misspellings(word: string, syllables: Record<string, number>): Case[] {
  const syls = word.split(' ')
  const seen = new Set<string>([word])
  const out: Case[] = []
  const add = (kind: Kind, parts: string[]) => {
    const input = parts.join(' ')
    if (seen.has(input)) return
    seen.add(input)
    out.push({ word, kind, input })
  }
  const isAccented = (s: string) => plain(s) !== s

  add('plain', syls.map(plain))
  syls.forEach((s, i) => {
    if (isAccented(s)) add('plain-one', syls.map((x, j) => (j === i ? plain(x) : x)))
  })
  for (const withOthersPlain of [false, true]) {
    syls.forEach((s, i) => {
      // The first tone that gives a non-syllable.
      for (const tone of TONES) {
        const variant = withTone(s, tone)
        if (variant === null || Object.hasOwn(syllables, variant)) continue
        const kind: Kind = withOthersPlain ? 'wrong-tone+plain' : 'wrong-tone'
        add(kind, syls.map((x, j) => (j === i ? variant : withOthersPlain ? plain(x) : x)))
        break
      }
    })
  }
  return out
}

/** The checker's spelling fixes applied to the input, and whether the word is among the options. */
async function evaluate(checker: ReturnType<typeof createChecker>, c: Case): Promise<CaseResult> {
  const result = await checker.check(c.input, { lang: LANG })
  const spelling = result.issues.filter((i) => i.rule === 'spelling')
  const applied = spelling.filter((i) => i.severity !== 'suggestion' && i.suggestions.length > 0).sort((a, b) => b.start - a.start)
  let corrected = result.text
  for (const issue of applied) corrected = corrected.slice(0, issue.start) + issue.suggestions[0] + corrected.slice(issue.end)
  const listed = applied.some((issue) =>
    issue.suggestions.some((s) => result.text.slice(0, issue.start) + s + result.text.slice(issue.end) === c.word),
  )
  const outcome: Outcome = applied.length === 0 ? 'none' : corrected === c.word ? 'fixed' : 'wrong'
  return { ...c, corrected, outcome, listed, options: spelling.map((i) => i.suggestions) }
}

const pct = (n: number, d: number) => `${n} (${d ? Math.round((100 * n) / d) : 0}%)`

function printSummary(results: CaseResult[], words: WordResult[]) {
  const rows = [...KINDS, 'all' as const].map((kind) => {
    const rs = kind === 'all' ? results : results.filter((r) => r.kind === kind)
    return {
      kind,
      count: rs.length,
      fixed: rs.filter((r) => r.outcome === 'fixed').length,
      listedNotFirst: rs.filter((r) => r.outcome !== 'fixed' && r.listed).length,
      wrong: rs.filter((r) => r.outcome === 'wrong').length,
      none: rs.filter((r) => r.outcome === 'none').length,
    }
  })
  const header = ['kind', 'count', 'fixed', 'listed, not first', 'wrong', 'none']
  const cells = rows.map((r) => [
    r.kind,
    String(r.count),
    pct(r.fixed, r.count),
    pct(r.listedNotFirst, r.count),
    pct(r.wrong, r.count),
    pct(r.none, r.count),
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((row) => row[i].length)))
  const line = (row: string[]) => row.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
  console.log(line(header))
  for (const row of cells) console.log(line(row))
  const fp = words.filter((w) => w.falsePositive).length
  console.log(`\nFalse positives on correct words: ${pct(fp, words.length)} of ${words.length} words`)
  return rows
}

async function main() {
  const started = performance.now()
  const top = parseCount('--top', DEFAULT_TOP)
  const verbose = process.argv.includes('--verbose')
  const checker = createChecker({ load })
  const syllables = (await load(LANG)('syllables.json')) as Record<string, number>
  const headwords = await loadHeadwords()
  const picked = pickWords(headwords, syllables, top)
  if (picked.length < top) console.log(`Only ${picked.length} headwords qualify (asked for ${top}).`)

  const words: WordResult[] = []
  const results: CaseResult[] = []
  for (const { key } of picked) {
    const check = await checker.check(key, { lang: LANG })
    const issues = check.issues.filter((i) => i.rule === 'spelling' && i.severity !== 'suggestion')
    words.push({ word: key, falsePositive: issues.length > 0, issues })
    for (const c of misspellings(key, syllables)) results.push(await evaluate(checker, c))
  }

  const rows = printSummary(results, words)

  // The most common headwords' example sentences: any spelling error or warning on them is a false
  // positive (or an old or regional spelling).
  const examples = [...new Set(
    [...headwords.values()]
      .sort((a, b) => Math.max(-1, ...b.map((e) => e.frequency ?? -1)) - Math.max(-1, ...a.map((e) => e.frequency ?? -1)))
      .flatMap((entries) => entries.flatMap((e) => e.senses.flatMap((s) => (s.examples ?? []).map((x) => x.text.normalize('NFC')))))
      .filter((t) => t.length >= 8 && t.length <= 200),
  )].slice(0, parseCount('--examples', DEFAULT_EXAMPLES))
  const flagged: { text: string; issues: string[] }[] = []
  for (const text of examples) {
    const { issues } = await checker.check(text, { lang: LANG })
    const spelling = issues.filter((i) => i.rule === 'spelling' && i.severity !== 'suggestion')
    if (spelling.length) flagged.push({ text, issues: spelling.map((i) => `${i.text}→${i.suggestions[0] ?? '?'}`) })
  }
  console.log(`Example sentences flagged: ${pct(flagged.length, examples.length)} of ${examples.length}`)
  for (const f of verbose ? flagged : flagged.slice(0, 15)) console.log(`  ${f.text}   [${f.issues.join('; ')}]`)

  const failures = results.filter((r) => r.outcome !== 'fixed')
  const shown = verbose ? failures : failures.slice(0, MAX_FAILURES_SHOWN)
  console.log(`\nFailures (wrong or none): showing ${shown.length} of ${failures.length}${verbose ? '' : ' (--verbose for all)'}`)
  for (const f of shown) {
    const options = f.options.map((o) => o.join(', ')).join(' | ')
    console.log(`${f.kind.padEnd(18)}${f.input} → ${f.corrected}   (${f.word})  options: [${options}]`)
  }

  const runtimeMs = Math.round(performance.now() - started)
  await mkdir(join(ROOT, '.cache'), { recursive: true })
  await writeFile(
    join(ROOT, '.cache', 'spelling-eval.json'),
    JSON.stringify({ top, runtimeMs, summary: rows, words, examples: flagged, cases: results }, null, 2) + '\n',
  )
  console.log(`\nRuntime: ${(runtimeMs / 1000).toFixed(1)}s. Full results: ${join(ROOT, '.cache', 'spelling-eval.json')}`)
}

main()
