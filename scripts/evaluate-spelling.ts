// Measures how well the Vietnamese spellchecker fixes misspelled common multi-syllable words.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/evaluate-spelling.ts [--top N] [--examples N] [--kinds a,b] [--verbose]
//
// Takes the N most common accented headwords of 2–3 syllables, makes four kinds of misspelling of each
// (all accents off; one syllable's accents off; a wrong tone; a wrong tone with the other syllables off),
// runs the checker on each and applies its first spelling suggestions. A fifth kind, sentence-plain, puts
// the word (accents off) inside up to three of the dictionary's example sentences that contain it, and
// applies only the fixes that overlap the word, so the neighbours have to support the right choice. The
// correct words themselves are checked for false positives, and so are the dictionary's own example
// sentences (of its most common headwords: real Vietnamese, though some use old or regional spellings).
// Every result goes to .cache/spelling-eval.json. --kinds limits the run to some kinds (default all),
// e.g. --kinds sentence-plain.

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
// sentence-plain: example sentences per word, and the length range of the sentences used.
const SENTENCES_PER_WORD = 3
const MIN_SENTENCE = 8
const MAX_SENTENCE = 200
// Combining tone marks: huyền, sắc, ngã, hỏi, nặng. Tried in this order.
const TONES = ['̀', '́', '̃', '̉', '̣']

type Kind = 'plain' | 'plain-one' | 'wrong-tone' | 'wrong-tone+plain' | 'sentence-plain'
const KINDS: Kind[] = ['plain', 'plain-one', 'wrong-tone', 'wrong-tone+plain', 'sentence-plain']
type Outcome = 'fixed' | 'wrong' | 'none'
/** sentence-plain only: the original sentence, and the word's start offset in it. */
type Case = { word: string; kind: Kind; input: string; sentence?: string; at?: number }
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

/** The kinds named by --kinds a,b (all of them by default). */
function parseKinds(): Kind[] {
  const i = process.argv.indexOf('--kinds')
  if (i < 0) return KINDS
  const names = (process.argv[i + 1] ?? '').split(',').map((s) => s.trim())
  if (names.some((n) => !KINDS.includes(n as Kind))) throw new Error(`--kinds takes names from ${KINDS.join(', ')}, got "${process.argv[i + 1] ?? ''}"`)
  return KINDS.filter((k) => names.includes(k))
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

/** Every example sentence of every headword, most common headwords first, each once. */
function exampleSentences(headwords: Map<string, Entry[]>): string[] {
  return [...new Set(
    [...headwords.values()]
      .sort((a, b) => Math.max(-1, ...b.map((e) => e.frequency ?? -1)) - Math.max(-1, ...a.map((e) => e.frequency ?? -1)))
      .flatMap((entries) => entries.flatMap((e) => e.senses.flatMap((s) => (s.examples ?? []).map((x) => x.text.normalize('NFC')))))
      .filter((t) => t.length >= MIN_SENTENCE && t.length <= MAX_SENTENCE),
  )]
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The word, misspelled with plain() inside the first SENTENCES_PER_WORD example sentences that contain it as
 * a whole word. Case-sensitive, so a sentence where the word only appears capitalised does not count.
 */
function sentenceCases(word: string, sentences: string[]): Case[] {
  const fixed = plain(word)
  // Same length, so the word keeps its offset in the sentence.
  if (fixed === word || fixed.length !== word.length) return []
  const re = new RegExp(`(?<![\\p{L}\\p{M}])${escapeRegExp(word)}(?![\\p{L}\\p{M}])`, 'u')
  const out: Case[] = []
  for (const sentence of sentences) {
    if (out.length === SENTENCES_PER_WORD) break
    const m = re.exec(sentence)
    if (!m) continue
    const at = m.index
    out.push({ word, kind: 'sentence-plain', input: sentence.slice(0, at) + fixed + sentence.slice(at + word.length), sentence, at })
  }
  return out
}

/**
 * The checker's spelling fixes applied to the input, and whether the word is among the options. For a
 * sentence case only the fixes that overlap the misspelled word count; the rest of the sentence is left alone.
 */
async function evaluate(checker: ReturnType<typeof createChecker>, c: Case): Promise<CaseResult> {
  const result = await checker.check(c.input, { lang: LANG })
  const spelling = result.issues.filter((i) => i.rule === 'spelling')
  const at = c.at
  const overlaps = (i: CheckIssue) => at === undefined || (i.start < at + c.word.length && i.end > at)
  const applied = spelling
    .filter((i) => i.severity !== 'suggestion' && i.suggestions.length > 0 && overlaps(i))
    .sort((a, b) => b.start - a.start)
  const target = c.sentence ?? c.word
  let corrected = result.text
  for (const issue of applied) corrected = corrected.slice(0, issue.start) + issue.suggestions[0] + corrected.slice(issue.end)
  const listed = applied.some((issue) =>
    issue.suggestions.some((s) => result.text.slice(0, issue.start) + s + result.text.slice(issue.end) === target),
  )
  const outcome: Outcome = applied.length === 0 ? 'none' : corrected === target ? 'fixed' : 'wrong'
  return { ...c, corrected, outcome, listed, options: spelling.filter(overlaps).map((i) => i.suggestions) }
}

const pct = (n: number, d: number) => `${n} (${d ? Math.round((100 * n) / d) : 0}%)`

function printSummary(results: CaseResult[], words: WordResult[], kinds: Kind[]) {
  const rows = [...kinds, 'all' as const].map((kind) => {
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
  const kinds = parseKinds()
  const checker = createChecker({ load })
  const syllables = (await load(LANG)('syllables.json')) as Record<string, number>
  const headwords = await loadHeadwords()
  const picked = pickWords(headwords, syllables, top)
  if (picked.length < top) console.log(`Only ${picked.length} headwords qualify (asked for ${top}).`)

  // Most common headwords first: sentence-plain takes its sentences from this list, in this order.
  const sentences = exampleSentences(headwords)
  const words: WordResult[] = []
  const results: CaseResult[] = []
  for (const { key } of picked) {
    const check = await checker.check(key, { lang: LANG })
    const issues = check.issues.filter((i) => i.rule === 'spelling' && i.severity !== 'suggestion')
    words.push({ word: key, falsePositive: issues.length > 0, issues })
    const cases = [
      ...misspellings(key, syllables),
      ...(kinds.includes('sentence-plain') ? sentenceCases(key, sentences) : []),
    ].filter((c) => kinds.includes(c.kind))
    for (const c of cases) results.push(await evaluate(checker, c))
  }

  const rows = printSummary(results, words, kinds)

  // The most common headwords' example sentences: any spelling error or warning on them is a false
  // positive (or an old or regional spelling).
  const examples = sentences.slice(0, parseCount('--examples', DEFAULT_EXAMPLES))
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
