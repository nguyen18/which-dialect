// Measures translation quality against known-correct translations.
//
//   node --experimental-strip-types scripts/evaluate.ts [--verbose]
//
// Uses the built data in packages/<lang>/data (build en, es and vi first). A case passes when one of
// its expected words is in the top 3 of the first (most relevant) translation group. Each set is run
// with hand-picked words (the default) and without them (the ranking alone), and broken down by
// target language.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTranslator, type TranslateOptions } from '../packages/core/src/index.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

type Case = { word: string; expect: string[] } & TranslateOptions

// [from, fromRegion, to, toRegion] shorthand -> options.
const pair = (from: string, fromRegion: string | undefined, to: string, toRegion: string | undefined) => ({
  from, to, ...(fromRegion ? { fromRegion } : {}), ...(toRegion ? { toRegion } : {}),
})
const c = (p: ReturnType<typeof pair>, word: string, expect: string[], extra: Partial<TranslateOptions> = {}): Case => ({
  ...p, word, expect, ...extra,
})

const enViS = pair('en', undefined, 'vi', 'Southern')
const enViN = pair('en', undefined, 'vi', 'Northern')
const enEsSpain = pair('en', undefined, 'es', 'Spain')
const enEsMexico = pair('en', undefined, 'es', 'Mexico')

export const CASES: Case[] = [
  // English -> Vietnamese
  c(enViS, 'pig', ['heo']),
  c(enViN, 'pig', ['lợn']),
  c(enViS, 'mother', ['má', 'mẹ']),
  c(enViS, 'car', ['xe hơi', 'ô tô', 'ôtô', 'xe']),
  c(enViS, 'not', ['hông', 'không']),
  c(enViS, 'wait', ['chờ', 'đợi']),
  c(enViS, 'cool', ['ngầu', 'chất'], { meaning: 'awesome great' }),
  c(enViS, 'dog', ['chó']),
  c(enViS, 'speak', ['nói']),
  // Everyday "muốn", not "mắc" (Southern, but only "want to (go to the bathroom, laugh, etc.)").
  c(pair('en', undefined, 'vi', undefined), 'want', ['muốn']),
  c(enViS, 'want', ['muốn']),
  c(enViN, 'want', ['muốn']),
  // A form's own colloquial meanings ("got": "Have/has.", "Must; have/has (to).") before its base word's.
  c(pair('en', undefined, 'vi', undefined), 'got', ['có']),
  c(pair('en', undefined, 'vi', undefined), 'got', ['phải'], { meaning: 'must' }),
  // "lấy", not "được" ("to obtain, to get (passively)"; common mostly as a helper verb).
  c(pair('en', undefined, 'vi', undefined), 'get', ['lấy']),
  // A hand-picked word (languages/vi.ts picks): the ranking alone gives "đưa" first.
  c(pair('en', undefined, 'vi', undefined), 'get', ['lấy'], { meaning: 'fetch' }),
  c(enViS, 'said', ['nói']),
  c(enViS, 'computer', ['máy tính', 'máy vi tính']),
  c(enViS, 'corn', ['bắp']),
  c(enViN, 'corn', ['ngô']),
  c(enViS, 'pineapple', ['thơm', 'khóm']),
  c(enViN, 'pineapple', ['dứa']),
  c(enViS, 'father', ['ba', 'tía']),
  c(enViN, 'father', ['bố']),
  // "I" without a relationship: the general pronouns, not kinship words (con, anh, ông), which need
  // the pronoun table's listener. From Wiktionary's table for "I" (tôi, tớ, ta, tui (South), tao, mình).
  c(pair('en', undefined, 'vi', undefined), 'I', ['tôi', 'mình']),
  c(enViS, 'I', ['tui']),
  c(pair('en', undefined, 'vi', undefined), 'I', ['tớ', 'tao', 'ta', 'tui'], { register: 'casual' }),
  // Other persons, from the pronoun table's default row (anh ấy/chị ấy are Northern-tagged; ảnh/chỉ Southern).
  c(pair('en', undefined, 'vi', undefined), 'you', ['bạn']),
  c(pair('en', undefined, 'vi', undefined), 'he', ['anh ấy']),
  c(enViS, 'she', ['chỉ', 'chị ấy']),
  c(pair('en', undefined, 'vi', undefined), 'we', ['chúng tôi', 'chúng ta']),
  c(pair('en', undefined, 'vi', undefined), 'they', ['họ']),
  // English -> Spanish
  c(enEsSpain, 'car', ['coche']),
  c(enEsMexico, 'car', ['carro', 'auto']),
  c(enEsSpain, 'computer', ['ordenador']),
  c(pair('en', undefined, 'es', 'Latin America'), 'computer', ['computadora', 'computador']),
  c(enEsSpain, 'juice', ['zumo']),
  c(enEsMexico, 'juice', ['jugo']),
  c(enEsMexico, 'bus', ['camión']),
  c(pair('en', undefined, 'es', 'Cuba'), 'bus', ['guagua']),
  // `meaning` is matched by shared words: English Wiktionary defines this sense as "Fashionable; trendy;
  // hip." and Spanish defines guay/molón only as "cool", so "awesome great" can't find it (it passed by
  // luck before register matching). Use the definition's wording, as apps that show definitions do.
  c(enEsSpain, 'cool', ['guay', 'molón'], { meaning: 'fashionable' }),
  c(enEsMexico, 'cool', ['chido', 'padre'], { meaning: 'awesome great' }),
  c(pair('en', undefined, 'es', 'Argentina'), 'popcorn', ['pochoclo', 'pororó']),
  c(enEsMexico, 'popcorn', ['palomitas', 'palomita']),
  c(pair('en', undefined, 'es', 'Argentina'), 'car', ['auto']),
  c(pair('en', undefined, 'es', 'Argentina'), 'you', ['vos']),
  c(enEsSpain, 'peach', ['melocotón']),
  c(enEsMexico, 'peach', ['durazno']),
  c(enEsMexico, 'straw', ['popote'], { meaning: 'drinking tube' }),
  // Spanish -> Vietnamese (dialect to dialect)
  c(pair('es', undefined, 'vi', 'Southern'), 'coche', ['xe hơi', 'ô tô', 'ôtô', 'xe']),
  c(pair('es', undefined, 'vi', 'Southern'), 'perro', ['chó']),
  c(pair('es', undefined, 'vi', 'Southern'), 'hablar', ['nói']),
  c(pair('es', 'Spain', 'vi', 'Southern'), 'zumo', ['nước ép', 'nước trái cây']),
  c(pair('es', 'Mexico', 'vi', 'Southern'), 'chido', ['ngầu', 'chất']),
  c(pair('es', 'Caribbean', 'vi', 'Southern'), 'guagua', ['xe buýt', 'xe bus', 'buýt']),
  c(pair('es', undefined, 'vi', 'Southern'), 'cerdo', ['heo']),
  c(pair('es', undefined, 'vi', 'Northern'), 'cerdo', ['lợn']),
  c(pair('es', 'Mexico', 'vi', 'Southern'), 'elote', ['bắp']),
  // Vietnamese -> Spanish
  c(pair('vi', 'Southern', 'es', 'Mexico'), 'heo', ['cerdo', 'puerco', 'cochino', 'chancho', 'marrano', 'cocho']),
  c(pair('vi', undefined, 'es', undefined), 'chờ', ['esperar']),
  c(pair('vi', 'Southern', 'es', undefined), 'má', ['madre', 'mamá']),
  c(pair('vi', undefined, 'es', 'Mexico'), 'ngầu', ['chido', 'padre'], { meaning: 'cool awesome' }),
  c(pair('vi', 'Southern', 'es', 'Mexico'), 'bắp', ['maíz', 'elote']),
  // Vietnamese, Northern -> Southern
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'lợn', ['heo']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'ngô', ['bắp']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'bố', ['ba', 'tía']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'dứa', ['thơm', 'khóm']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'mẹ', ['má']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'vâng', ['dạ']),
  // Spanish, Spain <-> Mexico
  c(pair('es', 'Spain', 'es', 'Mexico'), 'coche', ['carro', 'auto']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'ordenador', ['computadora']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'zumo', ['jugo']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'autobús', ['camión']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'melocotón', ['durazno']),
  c(pair('es', 'Mexico', 'es', 'Spain'), 'carro', ['coche']),
  c(pair('es', 'Mexico', 'es', 'Spain'), 'computadora', ['ordenador']),
  c(pair('es', 'Mexico', 'es', 'Spain'), 'jugo', ['zumo']),
  // English, US <-> UK
  c(pair('en', 'US', 'en', 'UK'), 'truck', ['lorry']),
  c(pair('en', 'US', 'en', 'UK'), 'apartment', ['flat']),
  c(pair('en', 'US', 'en', 'UK'), 'elevator', ['lift']),
  c(pair('en', 'US', 'en', 'UK'), 'cookie', ['biscuit']),
  c(pair('en', 'US', 'en', 'UK'), 'gasoline', ['petrol']),
  c(pair('en', 'US', 'en', 'UK'), 'sidewalk', ['pavement']),
  c(pair('en', 'UK', 'en', 'US'), 'lorry', ['truck']),
  c(pair('en', 'UK', 'en', 'US'), 'petrol', ['gasoline', 'gas']),
  // Into English
  c(pair('vi', undefined, 'en', undefined), 'heo', ['pig', 'hog', 'swine']),
  c(pair('vi', undefined, 'en', undefined), 'chờ', ['wait', 'await']),
  c(pair('vi', undefined, 'en', undefined), 'ngầu', ['cool'], { meaning: 'awesome' }),
  c(pair('es', undefined, 'en', undefined), 'coche', ['car', 'automobile']),
  c(pair('es', 'Spain', 'en', 'UK'), 'zumo', ['juice']),
  // With the intended part of speech: "cerdo" is listed as an adjective ("dirty") first.
  c(pair('es', undefined, 'vi', 'Southern'), 'cerdo', ['heo'], { pos: 'noun' }),
]

// Held-out cases, written after the tuning above and not tuned against: a check on how well the
// translator generalizes. Report them separately.
export const HOLDOUT: Case[] = [
  c(enViS, 'water', ['nước']),
  c(enViS, 'house', ['nhà']),
  c(enViS, 'eat', ['ăn']),
  c(enViS, 'beautiful', ['đẹp']),
  c(enViS, 'hot', ['nóng']),
  c(enViS, 'book', ['sách']),
  c(enViS, 'cat', ['mèo']),
  c(enViS, 'money', ['tiền']),
  c(enViS, 'run', ['chạy']),
  c(enViS, 'sleep', ['ngủ']),
  c(enEsMexico, 'water', ['agua']),
  c(enEsMexico, 'house', ['casa']),
  c(enEsMexico, 'eat', ['comer']),
  c(enEsMexico, 'friend', ['amigo', 'cuate', 'compa']),
  c(enEsMexico, 'cat', ['gato']),
  c(pair('es', undefined, 'vi', 'Southern'), 'agua', ['nước']),
  c(pair('es', undefined, 'vi', 'Southern'), 'casa', ['nhà']),
  c(pair('es', undefined, 'vi', 'Southern'), 'comer', ['ăn']),
  c(pair('vi', undefined, 'es', undefined), 'nước', ['agua']),
  c(pair('vi', undefined, 'es', undefined), 'mèo', ['gato']),
  c(pair('en', 'US', 'en', 'UK'), 'vacation', ['holiday', 'holidays']),
  c(pair('en', 'US', 'en', 'UK'), 'trash', ['rubbish']),
  c(pair('en', 'US', 'en', 'UK'), 'diaper', ['nappy']),
  c(pair('en', 'US', 'en', 'UK'), 'subway', ['underground', 'tube']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'patata', ['papa']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'conducir', ['manejar']),
  c(pair('es', 'Spain', 'es', 'Mexico'), 'gafas', ['lentes', 'anteojos']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'bát', ['chén']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'thìa', ['muỗng']),
  c(pair('vi', 'Northern', 'vi', 'Southern'), 'quả', ['trái']),
]

async function run(cases: Case[], title: string, verbose: boolean, tr: ReturnType<typeof createTranslator>, picks = true) {
  let pass = 0
  let first = 0
  // Per target language, so each language's quality is visible as languages are added.
  const byLang = new Map<string, { n: number; pass: number; first: number }>()
  console.log(`\n${title}`)
  for (const kase of cases) {
    const { word, expect, ...options } = kase
    const groups = await tr.translate(word, { ...options, picks })
    const top = groups[0]?.translations.slice(0, 3).map((t) => t.word) ?? []
    const ok = top.some((w) => expect.includes(w))
    const isFirst = expect.includes(top[0])
    if (ok) pass++
    if (isFirst) first++
    const lang = byLang.get(options.to) ?? { n: 0, pass: 0, first: 0 }
    byLang.set(options.to, { n: lang.n + 1, pass: lang.pass + Number(ok), first: lang.first + Number(isFirst) })
    const label = `${options.from}${options.fromRegion ? `(${options.fromRegion})` : ''} → ${options.to}${options.toRegion ? `(${options.toRegion})` : ''}  ${word}${options.meaning ? ` [${options.meaning}]` : ''}${options.pos ? ` <${options.pos}>` : ''}`
    if (verbose || !ok) console.log(`${ok ? '✓' : '✗'} ${label.padEnd(58)} ${top.join(', ') || '(nothing)'}${ok ? '' : `   expected: ${expect.join(' / ')}`}`)
  }
  console.log(
    `${pass}/${cases.length} passed (${Math.round((100 * pass) / cases.length)}%); ` +
      `correct word first: ${first}/${cases.length} (${Math.round((100 * first) / cases.length)}%)`,
  )
  if (byLang.size > 1) {
    console.log('  by target language: ' + [...byLang].map(([l, r]) => `${l} ${r.pass}/${r.n} (${r.first} first)`).join(', '))
  }
  return pass
}

async function main() {
  const verbose = process.argv.includes('--verbose')
  const tr = createTranslator({
    load: (lang) => async (p) => JSON.parse(await readFile(join(ROOT, 'packages', lang, 'data', p), 'utf8')),
  })
  // Cases touching a language whose data isn't built are skipped, with one note, rather than crashing.
  const built = (lang: string) => existsSync(join(ROOT, 'packages', lang, 'data'))
  const all = [...CASES, ...HOLDOUT]
  const notBuilt = [...new Set(all.flatMap((k) => [k.from, k.to]).filter((l) => !built(l)))]
  const skipped = all.filter((k) => !built(k.from) || !built(k.to)).length
  if (skipped) console.log(`skipped ${skipped} cases: ${notBuilt.join(', ')} not built`)
  const usable = (cases: Case[]) => cases.filter((k) => built(k.from) && built(k.to))
  await run(usable(CASES), 'Tuning set', verbose, tr)
  await run(usable(HOLDOUT), 'Held-out set (not tuned against)', verbose, tr)
  // Without hand-picked words: what the ranking does on its own (picks must not hide ranking problems).
  await run(usable(CASES), 'Tuning set, ranking only (picks off)', verbose, tr, false)
  await run(usable(HOLDOUT), 'Held-out set, ranking only (picks off)', verbose, tr, false)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
