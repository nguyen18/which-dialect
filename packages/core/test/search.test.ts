import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  compatiblePos,
  createDictionary,
  createTranslator,
  normalizeEnglish,
  posName,
  regularBaseForms,
  shardKey,
  type LanguageMeta,
  type StoredPronounRow,
  type StoredHit,
} from '../src/index.ts'

describe('shardKey', () => {
  it('uses the first two letters without diacritics', () => {
    assert.equal(shardKey('không'), 'kh')
    assert.equal(shardKey('Đợi'), 'do')
    assert.equal(shardKey('ở'), 'o_')
    assert.equal(shardKey('3D'), '_d')
    assert.equal(shardKey('ñame'), 'na')
  })

  it('can use more letters for large languages', () => {
    assert.equal(shardKey('running', 3), 'run')
    assert.equal(shardKey('im', 3), 'im_')
  })
})

describe('normalizeEnglish', () => {
  it('lowercases and drops a leading article or "to"', () => {
    assert.equal(normalizeEnglish('  To  Wait '), 'wait')
    assert.equal(normalizeEnglish('the door'), 'door')
    assert.equal(normalizeEnglish('I'), 'i')
  })
})

// A tiny fake language to test ranking without the real data.
describe('searchEnglish ranking (fake data)', () => {
  const meta = {
    name: 'Test',
    regions: ['North', 'South', 'Island'],
    regionGroups: { Mainland: ['North', 'South'] },
    shards: { words: [], en: ['no'] },
  } as unknown as LanguageMeta
  // Stored form: untagged hits have no `regions`.
  const hit = (word: string, extra: Partial<StoredHit>): StoredHit => ({
    word, pos: 'adv', gloss: 'not', senseIndex: 0, senses: 1, primary: true, ...extra,
  })
  const files: Record<string, unknown> = {
    'meta.json': meta,
    'en/no.json': {
      not: [
        hit('plain', { senses: 5 }),
        hit('southern', { regions: ['South'] }),
        hit('northern', { regions: ['North'] }),
        hit('island', { regions: ['Island'] }),
        hit('rude', { labels: ['vulgar'] }),
        hit('slangy', { labels: ['slang'], senses: 9 }),
        hit('secondary', { primary: false, senses: 20 }),
        hit('plain', { senses: 5, senseIndex: 1, labels: ['formal'] }),
      ],
    },
  }
  const dict = createDictionary({ lang: 'test', load: async (p) => files[p] })

  it('ranks region-tagged words first and leaves out other regions', async () => {
    const words = (await dict.searchEnglish('not', { region: 'South' })).map((h) => h.word)
    assert.deepEqual(words, ['southern', 'plain', 'slangy', 'secondary'])
  })

  it('excludes vulgar words by default, and includes them with exclude: []', async () => {
    assert.ok(!(await dict.searchEnglish('not')).some((h) => h.word === 'rude'))
    assert.ok((await dict.searchEnglish('not', { exclude: [] })).some((h) => h.word === 'rude'))
  })

  it('returns one sense per word, or every sense with allSenses', async () => {
    assert.equal((await dict.searchEnglish('not')).filter((h) => h.word === 'plain').length, 1)
    const all = await dict.searchEnglish('not', { allSenses: true })
    assert.deepEqual(all.filter((h) => h.word === 'plain').map((h) => h.senseIndex), [0, 1])
  })

  it('treats untagged hits as every region', async () => {
    const plain = (await dict.searchEnglish('not')).find((h) => h.word === 'plain')
    assert.deepEqual(plain?.regions, ['North', 'South', 'Island'])
    assert.equal(plain?.regionTagged, false)
  })

  it('searches a region group as all of its regions', async () => {
    const words = (await dict.searchEnglish('not', { region: 'Mainland' })).map((h) => h.word)
    assert.deepEqual(words.slice(0, 2).sort(), ['northern', 'southern'])
    assert.ok(!words.includes('island'))
  })

  it('rejects unknown regions and lists the groups', async () => {
    await assert.rejects(dict.searchEnglish('not', { region: 'East' }), /isn't a Test region or group.*groups: Mainland/)
  })

  it('returns nothing for terms in shards that do not exist', async () => {
    assert.deepEqual(await dict.searchEnglish('zebra'), [])
  })
})

describe('pronoun table (fake data)', () => {
  const meta = { name: 'Test', regions: ['North', 'South'], shards: { words: [], en: [] }, pronouns: true } as unknown as LanguageMeta
  // Stored form: untagged choices have no `regions`.
  const rows: StoredPronounRow[] = [
    {
      id: 'parent',
      label: 'Your parents',
      self: [{ word: 'kid', source: 'gloss', gloss: 'I (to a parent)' }],
      addressee: [
        { word: 'pa', source: 'override', regions: ['South'], note: 'no definition' },
        { word: 'father', source: 'gloss', gloss: 'you, my father', regions: ['North'] },
        { word: 'sire', source: 'gloss', gloss: 'you, my father', labels: ['dated'] },
      ],
    },
    {
      id: 'younger',
      label: 'Someone younger',
      self: [{ word: 'bro', source: 'gloss', speaker: 'male' }, { word: 'sis', source: 'gloss', speaker: 'female' }],
      addressee: [{ word: 'kiddo', source: 'gloss' }],
    },
  ]
  const files: Record<string, unknown> = { 'meta.json': meta, 'pronouns.json': rows }
  const dict = createDictionary({ lang: 'test', load: async (p) => files[p] })
  const words = (cs: { word: string }[]) => cs.map((c) => c.word)

  it('returns every row, with untagged choices counting as every region', async () => {
    const all = await dict.pronouns()
    assert.deepEqual(all.map((r) => r.id), ['parent', 'younger'])
    assert.deepEqual(all[0].self[0].regions, ['North', 'South'])
    assert.equal(all[0].self[0].regionTagged, false)
  })

  it('filters by region, speaker and labels', async () => {
    const [parent, younger] = await dict.pronouns({ region: 'South', speaker: 'female' })
    assert.deepEqual(words(parent.addressee), ['pa'])
    assert.deepEqual(words(younger.self), ['sis'])
    assert.ok(words((await dict.pronouns({ exclude: [] }))[0].addressee).includes('sire'))
  })

  it('returns one relationship by id and rejects unknown ones', async () => {
    assert.deepEqual((await dict.pronouns({ listener: 'younger' })).map((r) => r.id), ['younger'])
    await assert.rejects(dict.pronouns({ listener: 'boss' }), /unknown listener "boss".*parent, younger/)
  })

  it('is empty for languages without a table', async () => {
    const none = createDictionary({ lang: 'none', load: async () => ({ ...meta, pronouns: undefined }) })
    assert.deepEqual(await none.pronouns(), [])
  })
})

// Checks against the real Vietnamese build. Run `npm run build:data -- vi` first; skipped otherwise.
const viData = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vi', 'data')
describe('Vietnamese data', { skip: !existsSync(viData) && 'run `npm run build:data -- vi` first' }, () => {
  const dict = createDictionary({ lang: 'vi', load: async (p) => JSON.parse(await readFile(join(viData, p), 'utf8')) })
  const words = async (term: string, region?: string) => (await dict.searchEnglish(term, { region })).map((h) => h.word)

  it('finds Southern variants that point at a standard word', async () => {
    assert.equal((await words('not', 'Southern'))[0], 'hông')
  })

  it('separates regional words', async () => {
    assert.ok((await words('pig', 'Northern')).includes('lợn'))
    assert.ok((await words('pig', 'Southern')).includes('heo'))
    assert.ok(!(await words('pig', 'Southern')).includes('lợn'))
    assert.ok((await words('now', 'Central')).includes('chừ'))
  })

  it('keeps regions per sense', async () => {
    const senses = (await dict.lookup('má')).flatMap((e) => e.senses)
    const mother = senses.find((s) => s.glosses[0].startsWith('mother'))
    assert.deepEqual(mother?.regions, ['Southern'])
    assert.equal(senses.find((s) => s.glosses[0] === 'cheek')?.regionTagged, false)
  })

  it('leaves vulgar words out by default', async () => {
    assert.ok(!(await words('not')).includes('đéo'))
  })

  it('has a pronoun table built from pronoun definitions', async () => {
    const [parent] = await dict.pronouns({ listener: 'parent', region: 'Southern' })
    assert.deepEqual(parent.self.map((c) => c.word), ['con'])
    assert.equal(parent.self[0].source, 'gloss')
    assert.deepEqual(parent.addressee.map((c) => c.word), ['ba', 'má', 'mẹ'])
    const [younger] = await dict.pronouns({ listener: 'younger', speaker: 'female' })
    assert.deepEqual(younger.self.map((c) => c.word), ['chị'])
    const [formal] = await dict.pronouns({ listener: 'formal' })
    assert.deepEqual(formal.self.map((c) => c.word), ['tôi'])
  })
})

describe('hand-picked words (fake data)', () => {
  // English "fetch" has one meaning, whose translation table lists source-language (yy) "holen". The
  // target language (xx) ranks "wrong" first for "fetch" and has picks for that meaning.
  const en = {
    'meta.json': { name: 'English', regions: ['US'], shards: { words: ['fe'], en: [] } },
    'words/fe.json': { fetch: [{ word: 'fetch', pos: 'verb', senses: [{ glosses: ['To go and bring back.'], translations: { yy: [{ word: 'holen' }] } }] }] },
  }
  const entry = (word: string, extra: object = {}) => [{ word, pos: 'verb', senses: [{ glosses: ['to fetch'], ...extra }] }]
  const xx = {
    'meta.json': { name: 'Target', regions: ['North', 'South'], shards: { words: ['wr', 'gr', 'ca', 'sn'], en: ['fe'] }, picks: true },
    'en/fe.json': { fetch: [{ word: 'wrong', pos: 'verb', gloss: 'to fetch', senseIndex: 0, senses: 9, primary: true }] },
    'words/wr.json': { wrong: entry('wrong') },
    'words/gr.json': { grab: entry('grab') },
    'words/ca.json': { carry: entry('carry') },
    'words/sn.json': { snatch: entry('snatch', { regions: ['North'] }) },
    'picks.json': [{ word: 'fetch', pos: 'verb', gloss: 'To go and bring back.', picks: [{ word: 'grab' }, { word: 'carry', tags: ['South'] }, { word: 'snatch', tags: ['North'] }] }],
  }
  const yy = {
    'meta.json': { name: 'Source', regions: ['Here'], shards: { words: ['ho'], en: [] } },
    'words/ho.json': { holen: [{ word: 'holen', pos: 'verb', senses: [{ glosses: ['to fetch'] }] }] },
  }
  const files: Record<string, Record<string, unknown>> = { en, xx, yy }
  const tr = createTranslator({ load: (lang) => async (p) => files[lang][p] })
  const words = (groups: { translations: { word: string; bridge: string }[] }[]) =>
    groups[0].translations.map((t) => (t.bridge === 'picked' ? `${t.word}*` : t.word))

  it('puts picks first, in order, then the ranked words', async () => {
    assert.deepEqual(words(await tr.translate('fetch', { from: 'en', to: 'xx' })), ['grab*', 'carry*', 'snatch*', 'wrong'])
  })

  it('returns the ranking alone with picks: false', async () => {
    assert.deepEqual(words(await tr.translate('fetch', { from: 'en', to: 'xx', picks: false })), ['wrong'])
  })

  it('puts picks tagged for the target region first and leaves out other regions\' picks', async () => {
    assert.deepEqual(words(await tr.translate('fetch', { from: 'en', to: 'xx', toRegion: 'South' })), ['carry*', 'grab*', 'wrong'])
  })

  it('reaches picks from another language through the English meaning', async () => {
    assert.deepEqual(words(await tr.translate('holen', { from: 'yy', to: 'xx' })), ['grab*', 'carry*', 'snatch*', 'wrong'])
  })

  // "old" has nested senses under one heading: a pick keyed by one's own definition is that sense's alone.
  // Its picks are a phrase the dictionary doesn't list, and it excludes the ranking's word.
  const nested = (() => {
    const heading = 'Having existed a long time.'
    const en2 = {
      'meta.json': { name: 'English', regions: ['US'], shards: { words: ['ol'], en: [] } },
      'words/ol.json': { old: [{ word: 'old', pos: 'adj', senses: [
        { glosses: [heading, 'Of an object, worn.'] },
        { glosses: [heading, 'Of a living being, aged.'] },
      ] }] },
    }
    const xx2 = {
      'meta.json': { name: 'Target', regions: ['North', 'South'], shards: { words: ['wo', 'gr'], en: ['ag', 'wo'] }, picks: true },
      'en/ag.json': { aged: [{ word: 'grey', pos: 'adj', gloss: 'aged', senseIndex: 0, senses: 3, primary: true }] },
      'en/wo.json': { worn: [{ word: 'worn', pos: 'adj', gloss: 'worn', senseIndex: 0, senses: 3, primary: true }] },
      'words/wo.json': { worn: [{ word: 'worn', pos: 'adj', senses: [{ glosses: ['worn'] }] }] },
      'words/gr.json': { grey: [{ word: 'grey', pos: 'adj', senses: [{ glosses: ['aged'] }] }] },
      'picks.json': [{ word: 'old', pos: 'adj', gloss: 'Of a living being, aged.', picks: [{ word: 'many years' }, { word: 'up there', tags: ['South'] }], exclude: ['grey'] }],
    }
    const f: Record<string, Record<string, unknown>> = { en: en2, xx: xx2 }
    return createTranslator({ load: (lang) => async (p) => f[lang][p] })
  })()
  const byGloss = async (opts: object = {}) =>
    Object.fromEntries((await nested.translate('old', { from: 'en', to: 'xx', ...opts })).map((g) => [g.source.glosses.at(-1), g.translations.map((t) => `${t.word}${t.phrase ? '+' : ''}`)]))

  it('keys picks by a nested sense\'s own definition, takes phrases, and drops excluded words', async () => {
    assert.deepEqual(await byGloss(), { 'Of an object, worn.': ['worn'], 'Of a living being, aged.': ['many years+', 'up there+'] })
    assert.deepEqual((await byGloss({ toRegion: 'North' }))['Of a living being, aged.'], ['many years+'])
  })
})

describe('parts of speech', () => {
  it('names codes and maps English parts of speech to compatible ones', () => {
    assert.equal(posName('adj'), 'Adjective')
    assert.equal(posName('unknown-code'), 'unknown-code')
    assert.ok(compatiblePos('verb').includes('particle'))
  })
})

describe('regularBaseForms', () => {
  it('undoes regular English endings', () => {
    assert.ok(regularBaseForms('walked').includes('walk'))
    assert.ok(regularBaseForms('cities').includes('city'))
    assert.ok(regularBaseForms('making').includes('make'))
    assert.ok(regularBaseForms('running').includes('run'))
    assert.deepEqual(regularBaseForms('go'), [])
  })
})

// Translator checks against the real English and Vietnamese builds; skipped unless both are built.
// The fuller quality check is `npm run evaluate` (scripts/evaluate.ts).
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const built = ['en', 'vi'].every((l) => existsSync(join(root, l, 'data')))
describe('translator (real data)', { skip: !built && 'build en and vi data first' }, () => {
  const tr = createTranslator({
    load: (lang) => async (p) => JSON.parse(await readFile(join(root, lang, 'data', p), 'utf8')),
  })
  const top = async (word: string, options: Parameters<typeof tr.translate>[1]) =>
    (await tr.translate(word, options))[0]?.translations.map((t) => t.word) ?? []

  it('follows irregular and regular English forms to the base word', async () => {
    const [said] = await tr.translate('said', { from: 'en', to: 'vi', toRegion: 'Southern' })
    assert.equal(said.source.lemma, 'say')
    assert.equal(said.translations[0].word, 'nói')
    assert.equal((await tr.senses('walked', { from: 'en' }))[0].lemma, 'walk')
    assert.equal((await tr.senses('running', { from: 'en', pos: 'verb' }))[0].lemma, 'run')
    assert.equal((await tr.senses('dont', { from: 'en' }))[0].lemma, "don't")
  })

  it('follows regional variants and keeps their region', async () => {
    const [hong] = await tr.senses('hông', { from: 'vi', fromRegion: 'Southern', pos: 'adv' })
    assert.equal(hong.lemma, 'không')
    assert.deepEqual(hong.regions, ['Southern'])
  })

  it('translates between languages, into a dialect', async () => {
    assert.equal((await top('corn', { from: 'en', to: 'vi', toRegion: 'Southern' }))[0], 'bắp')
    assert.ok((await top('heo', { from: 'vi', fromRegion: 'Southern', to: 'en' })).includes('pig'))
  })

  it('lists specialist and sexual meanings after everyday ones, and uses picks for "excited"', async () => {
    const groups = await tr.translate('excited', { from: 'en', to: 'vi', allSenses: true })
    assert.match(groups[0].source.glosses[0], /^Having great enthusiasm/)
    assert.deepEqual(groups[0].translations.slice(0, 3).map((t) => t.word), ['hào hứng', 'háo hức', 'phấn khích'])
    const labelled = groups.findIndex((g) => g.source.labels.some((l) => l === 'technical' || l === 'sexual'))
    assert.ok(labelled > 0 && groups.slice(labelled).every((g) => g.source.labels.some((l) => l === 'technical' || l === 'sexual')))
    // A word's main meaning stays first even when it's technical, and everyday tech meanings aren't moved.
    assert.match((await tr.translate('gold', { from: 'en', to: 'vi', allSenses: true }))[0].source.glosses[0], /metal/)
    assert.match((await tr.translate('release', { from: 'en', to: 'vi', allSenses: true }))[0].source.glosses[0], /software/)
  })

  it('translates country names both ways', async () => {
    for (const [en, vi] of [['Japan', 'Nhật Bản'], ['France', 'Pháp'], ['Germany', 'Đức'], ['Thailand', 'Thái Lan'], ['India', 'Ấn Độ'], ['Vietnam', 'Việt Nam']]) {
      assert.equal((await top(en, { from: 'en', to: 'vi' }))[0], vi, en)
      assert.equal((await top(vi, { from: 'vi', to: 'en' }))[0], en, vi)
    }
    // The short name too, and nothing that only mentions the country in its definition.
    const japan = await top('Japan', { from: 'en', to: 'vi' })
    assert.ok(japan.includes('Nhật'))
    assert.ok(!japan.includes('hoàng bào'))
    assert.ok(!(await top('Vietnam', { from: 'en', to: 'vi' })).includes('Vinh'))
    // Names of several words: "South Korea", not "South korea".
    assert.ok((await tr.translate('Hàn Quốc', { from: 'vi', to: 'en' })).some((g) => g.translations[0]?.word === 'South Korea'))
  })

  it('translates between dialects of one language', async () => {
    assert.equal((await top('ngô', { from: 'vi', fromRegion: 'Northern', to: 'vi', toRegion: 'Southern' }))[0], 'bắp')
    assert.ok((await top('truck', { from: 'en', fromRegion: 'US', to: 'en', toRegion: 'UK' })).includes('lorry'))
  })

  it('uses the part of speech and meaning', async () => {
    assert.ok(!(await top('can', { from: 'en', to: 'vi', pos: 'verb' })).includes('ngũ tạng'))
    // "chất" and "ngầu" are both Southern slang for cool; the temperature word "mát" must not lead.
    const cool = await top('cool', { from: 'en', to: 'vi', toRegion: 'Southern', meaning: 'awesome great' })
    assert.ok(cool.slice(0, 3).includes('ngầu'))
    assert.notEqual(cool[0], 'mát')
  })

  it('keeps register: polite stays polite', async () => {
    assert.ok((await top('vâng', { from: 'vi', fromRegion: 'Northern', to: 'vi', toRegion: 'Southern' })).includes('dạ'))
  })

  it('puts the listener\'s pronouns first for "I" and "you"', async () => {
    assert.equal((await top('I', { from: 'en', to: 'vi', listener: 'parent' }))[0], 'con')
    assert.deepEqual((await top('you', { from: 'en', to: 'vi', listener: 'parent', toRegion: 'Southern' })).slice(0, 2), ['ba', 'má'])
    assert.equal((await top('I', { from: 'en', to: 'vi', listener: 'younger', speaker: 'female' }))[0], 'chị')
    assert.equal((await top('me', { from: 'en', to: 'vi', listener: 'teacher' }))[0], 'em')
    // Without a pronoun table the listener is ignored; an unknown one throws.
    assert.equal((await top('tôi', { from: 'vi', to: 'en', pos: 'pron', listener: 'parent' }))[0], 'I')
    await assert.rejects(top('I', { from: 'en', to: 'vi', listener: 'boss' }), /unknown listener "boss"/)
  })

  it('translates he, she, we and they with the pronoun table', async () => {
    const first = async (word: string, o: Partial<Parameters<typeof tr.translate>[1]> = {}) =>
      (await top(word, { from: 'en', to: 'vi', ...o }))[0]
    assert.equal(await first('he'), 'anh ấy')
    assert.equal(await first('she'), 'chị ấy')
    assert.equal(await first('he', { toRegion: 'Southern' }), 'ảnh')
    assert.equal(await first('he', { about: 'grandparents-age', toRegion: 'Southern' }), 'ổng')
    assert.equal(await first('she', { about: 'teacher' }), 'cô')
    // "we" is exclusive first in Wiktionary: chúng tôi; to parents, chúng con.
    assert.equal(await first('we'), 'chúng tôi')
    assert.equal(await first('we', { listener: 'parent' }), 'chúng con')
    assert.equal(await first('they'), 'họ')
    assert.equal(await first("y'all", { listener: 'younger' }), 'các em')
    // Plain "you": the default row's neutral word.
    assert.equal(await first('you'), 'bạn')
    await assert.rejects(top('he', { from: 'en', to: 'vi', about: 'boss' }), /unknown listener "boss"/)
  })

  it('says when a source pronoun is used (reverse direction)', async () => {
    // "em" is never defined as "I": its uses come from the pronoun table, in groups of their own.
    const em = await tr.translate('em', { from: 'vi', to: 'en', pos: 'pron' })
    const self = em.find((g) => g.pronounUses?.some((u) => u.person === 'self'))
    assert.deepEqual(self?.translations.map((t) => t.word).slice(0, 2), ['I', 'me'])
    assert.ok(self?.pronounUses?.some((u) => u.id === 'teacher'))
    const you = em.find((g) => g.pronounUses?.some((u) => u.person === 'addressee'))
    assert.equal(you?.translations[0]?.word, 'you')
    assert.ok(you?.pronounUses?.some((u) => u.id === 'younger'))
    // "con" has its own definition for talking to parents; the use goes on that group.
    const con = await tr.translate('con', { from: 'vi', to: 'en', pos: 'pron' })
    const toParents = con.find((g) => g.source.glosses[0].includes('talking to their parents'))
    assert.deepEqual(toParents?.pronounUses?.map((u) => u.id), ['parent'])
    // Within Vietnamese, with a listener: em as "I" becomes the listener's word (con, to a parent).
    const vi = await tr.translate('em', { from: 'vi', to: 'vi', pos: 'pron', listener: 'parent' })
    assert.equal(vi.find((g) => g.pronounUses?.some((u) => u.person === 'self'))?.translations[0]?.word, 'con')
  })

  it('lists the relationships for "I" senses', async () => {
    const [group] = await tr.translate('I', { from: 'en', to: 'vi', toRegion: 'Southern' })
    const parent = group.relationships?.find((r) => r.id === 'parent')
    assert.deepEqual(parent?.words.map((c) => c.word), ['con'])
    assert.ok(group.relationships?.find((r) => r.id === 'close-friend')?.warning)
  })
})
