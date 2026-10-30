import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPhrasebook, createReviewer, type LanguageMeta, type StoredFramesData, type StoredPronounRow } from '../src/index.ts'

// A tiny fake language with two regions, to test how frames pick words without the real data.
const frames: StoredFramesData = {
  frames: [
    { id: 'ask-where', topic: 'questions', en: ['Where is {place}?'], slots: { place: 'noun' }, text: '{place} ở {WHERE}?' },
    { id: 'ask-yes-no', topic: 'questions', en: ['Do you {action}?'], slots: { action: 'verb' }, text: '{YOU} có {action} {Q_END} {POLITE}?' },
    { id: 'dont-know', topic: 'journal', en: ["I don't know."], slots: {}, text: '{I} {NOT} biết.' },
  ],
  words: {
    WHERE: { meaning: 'where', choices: [{ word: 'đâu', source: 'gloss' }, { word: 'mô', source: 'gloss', regions: ['Central'] }] },
    Q_END: { meaning: 'question ending', choices: [{ word: 'không', source: 'gloss' }] },
    NOT: { meaning: 'not', choices: [{ word: 'không', source: 'gloss' }, { word: 'hông', source: 'override', regions: ['Southern'], labels: ['colloquial'], note: 'casual' }] },
    POLITE: { meaning: 'polite ending', optional: true, choices: [{ word: 'ạ', source: 'gloss', when: 'respect' }] },
  },
}
const rows: StoredPronounRow[] = [
  { id: 'general', label: 'Anyone', default: true, self: [{ word: 'tôi', source: 'gloss' }], addressee: [{ word: 'bạn', source: 'gloss' }] },
  { id: 'parent', label: 'Your parents', respect: true, self: [{ word: 'con', source: 'gloss' }], addressee: [{ word: 'mẹ', source: 'gloss' }] },
]
const meta = { name: 'Test', regions: ['Central', 'Southern'], shards: { words: [], en: [] }, pronouns: true, frames: true } as unknown as LanguageMeta
const files: Record<string, unknown> = { 'meta.json': meta, 'frames.json': frames, 'pronouns.json': rows }

describe('sentence frames (fake data)', () => {
  const pb = createPhrasebook({ load: () => async (p) => files[p] })
  const o = { lang: 'test' }

  it('picks the region’s words, and casual ones only for a casual register', async () => {
    assert.equal((await pb.render('ask-where', { ...o, slots: { place: { text: 'chợ' } } })).text, 'Chợ ở đâu?')
    assert.equal((await pb.render('ask-where', { ...o, region: 'Central', slots: { place: { text: 'chợ' } } })).text, 'Chợ ở mô?')
    assert.equal((await pb.render('dont-know', { ...o, region: 'Southern' })).text, 'Tôi không biết.')
    assert.equal((await pb.render('dont-know', { ...o, region: 'Southern', register: 'casual' })).text, 'Tôi hông biết.')
  })

  it('fills pronouns for the listener, with the polite ending only when speaking up', async () => {
    assert.equal((await pb.render('ask-yes-no', { ...o, slots: { action: { text: 'đi' } } })).text, 'Bạn có đi không?')
    const toParent = await pb.render('ask-yes-no', { ...o, listener: 'parent', slots: { action: { text: 'đi' } } })
    assert.equal(toParent.text, 'Mẹ có đi không ạ?')
    assert.match(toParent.parts.find((p) => p.slot === 'YOU')!.why!, /talking to your parents/)
  })

  it('lists frames with open slots, and explains each word', async () => {
    const list = await pb.frames({ ...o, topic: 'questions' })
    assert.deepEqual(list.map((f) => f.text), ['{place} ở đâu?', 'Bạn có {action} không?'])
    assert.equal(list[0].complete, false)
    assert.deepEqual(list[0].slots, [{ name: 'place', pos: 'noun' }])
  })

  it('checks a sentence against frames: missing words, other regions, accents, the listener', async () => {
    const [missing] = await pb.matchFrames('Bạn có đi?', o)
    assert.equal(missing.text, 'Bạn có đi không?')
    assert.deepEqual(missing.changes.map((c) => [c.from, c.to]), [['', 'không']])
    assert.equal((await pb.matchFrames('Chợ ở mô?', { ...o, region: 'Southern' }))[0].text, 'Chợ ở đâu?')
    assert.equal((await pb.matchFrames('Toi không biết.', o))[0].text, 'Tôi không biết.')
    // Pronouns change only for a chosen listener: in a journal, "mẹ" may be who you write about.
    assert.deepEqual((await pb.matchFrames('Mẹ có đi không?', o))[0].changes, [])
    assert.equal((await pb.matchFrames('Bạn có đi không?', { ...o, listener: 'parent' }))[0].text, 'Mẹ có đi không?')
  })

  it('rejects unknown frames, and is empty for languages without frames', async () => {
    await assert.rejects(pb.render('nope', o), /unknown frame "nope".*ask-where, ask-yes-no, dont-know/)
    const none = createPhrasebook({ load: () => async (p) => (p === 'meta.json' ? { ...meta, frames: false, pronouns: false } : files[p]) })
    assert.deepEqual(await none.frames(o), [])
    assert.deepEqual(await none.matchFrames('Bạn có đi?', o), [])
  })
})

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const built = ['en', 'vi'].every((l) => existsSync(join(root, l, 'data')))
const load = (lang: string) => async (p: string) => JSON.parse(await readFile(join(root, lang, 'data', p), 'utf8'))

describe('sentence frames (real Vietnamese data)', { skip: !built && 'build en and vi data first' }, () => {
  const pb = createPhrasebook({ load })

  it('fills frames by region and listener', async () => {
    assert.equal((await pb.render('ask-where', { lang: 'vi', region: 'Central', slots: { place: { text: 'nhà vệ sinh' } } })).text, 'Nhà vệ sinh ở mô?')
    assert.equal((await pb.render('ask-eaten', { lang: 'vi', region: 'Southern', listener: 'parent' })).text, 'Ba ăn cơm chưa ạ?')
    assert.equal((await pb.render('lets', { lang: 'vi', region: 'Northern', slots: { action: 'eat' } })).text, 'Chúng ta ăn nhé.')
    assert.equal((await pb.render('lets', { lang: 'vi', region: 'Southern', slots: { action: 'eat' } })).text, 'Chúng ta ăn nha.')
  })

  it('matches English sentences and clauses to frames', async () => {
    assert.equal((await pb.match('Do you want coffee?', { lang: 'vi' }))?.text, 'Bạn có muốn cà phê không?')
    assert.equal((await pb.match('but it was expensive', { lang: 'vi', region: 'Southern' }))?.text, 'nhưng mắc quá')
    assert.equal(await pb.match('The weather is nice today.', { lang: 'vi' }), null)
  })
})

describe('journal review (real data)', { skip: !built && 'build en and vi data first' }, () => {
  const reviewer = createReviewer({ load })

  it('corrects a mixed English and Vietnamese entry', async () => {
    const entry = 'Hôm nay tôi đi market với má. Tôi muốn ăn thịt lợn but it was expensive. Ngày mai tui đi lại khong?'
    // By default, the spellchecker: English words and accents; regional words and "tui" stay.
    const review = await reviewer.review(entry, { lang: 'vi', region: 'Southern' })
    assert.equal(review.corrected, 'Hôm nay tôi đi chợ với má. Tôi muốn ăn thịt lợn nhưng mắc quá. Ngày mai tui đi lại không?')
    const [first, second] = review.sentences
    assert.deepEqual(first.parts.map((p) => p.lang), ['vi', 'en', 'vi'])
    assert.deepEqual(first.changes.map((c) => [c.from, c.to, c.kind]), [['market', 'chợ', 'foreign-word']])
    assert.deepEqual(second.changes.map((c) => c.kind), ['frame'])
    assert.ok(first.frames.some((f) => f.id === 'today'))
    // With the regional and consistency checks on.
    const more = await reviewer.review(entry, { lang: 'vi', region: 'Southern', checks: { dialect: true, 'pronoun-consistency': true } })
    assert.equal(more.corrected, 'Hôm nay tôi đi chợ với má. Tôi muốn ăn thịt heo nhưng mắc quá. Ngày mai tôi đi lại không?')
  })

  it('uses a clause frame inside an English part, and corrects the rest word by word', async () => {
    // The example in Language Helper's JOURNAL_PLAN.md.
    const review = await reviewer.review('Hôm nay tôi đi market với má. Toi muon an the ice cream but it was expensive. Ngày mai tui đi lại khong?', { lang: 'vi', region: 'Southern' })
    assert.equal(review.corrected, 'Hôm nay tôi đi chợ với má. Tôi muốn ăn kem nhưng mắc quá. Ngày mai tui đi lại không?')
    assert.ok(review.sentences[1].changes.some((c) => c.kind === 'frame' && c.from === 'but it was expensive'))
    // A clause that doesn't fit a frame stays word by word, not cut short ("but it was very" + "expensive").
    const very = await reviewer.review('Tôi muốn ăn kem but it was very expensive.', { lang: 'vi', region: 'Southern' })
    assert.equal(very.corrected, 'Tôi muốn ăn kem nhưng nó là rất mắc.')
  })

  it('corrects every word, leaves out "the", and lists frames without changing the sentence', async () => {
    const review = await reviewer.review('Toi muon an the ice cream. Bạn có đi chợ? The weather is nice today.', { lang: 'vi' })
    assert.equal(review.sentences[0].corrected, 'Tôi muốn ăn kem.')
    assert.ok(review.sentences[0].changes.some((c) => c.from === 'the' && c.to === ''))
    // Frames are listed, not applied: the sentence keeps its own wording.
    assert.equal(review.sentences[1].corrected, 'Bạn có đi chợ?')
    assert.ok(review.sentences[1].frames.some((f) => f.id === 'ask-yes-no'))
    // A whole English sentence with no frame is translated word by word.
    assert.deepEqual(review.sentences[2].unchecked, [])
    assert.match(review.sentences[2].corrected, /^Thời tiết .* hôm nay\.$/)
  })

  // A correct entry must come back unchanged.
  it('leaves a correct entry alone', async () => {
    for (const [entry, region] of [
      ['Hôm nay tôi đi chợ với mẹ. Tôi muốn ăn phở.', 'Northern'],
      ['Hôm qua tui đi chợ với má. Tui thích ăn bắp.', 'Southern'],
      ['Bạn có muốn đi xem phim không? Chúng ta đi nhé.', 'Northern'],
    ]) {
      const review = await reviewer.review(entry, { lang: 'vi', region })
      assert.equal(review.corrected, entry, entry)
      assert.deepEqual(review.sentences.flatMap((s) => s.changes), [], entry)
    }
  })
})

const builtEs = ['en', 'es'].every((l) => existsSync(join(root, l, 'data')))

describe('sentence frames (real Spanish data)', { skip: !builtEs && 'build en and es data first' }, () => {
  const pb = createPhrasebook({ load })

  it('uses vos forms and Spain\'s perfect by region, capitalized after "¿"', async () => {
    assert.equal((await pb.render('ask-want', { lang: 'es', region: 'Mexico', slots: { thing: { text: 'café' } } })).text, '¿Quieres café?')
    assert.equal((await pb.render('ask-want', { lang: 'es', region: 'Argentina', slots: { thing: { text: 'café' } } })).text, '¿Querés café?')
    assert.equal((await pb.render('ask-eaten', { lang: 'es', region: 'Spain' })).text, '¿Ya has comido?')
    assert.equal((await pb.render('ask-eaten', { lang: 'es', region: 'Colombia' })).text, '¿Ya comiste?')
  })

  it('matches English to frames that take an infinitive, only in the tenses they say', async () => {
    assert.equal((await pb.match('I want to sleep.', { lang: 'es' }))?.text, 'Quiero dormir.')
    assert.equal((await pb.match('Can you help me?', { lang: 'es', region: 'Argentina' }))?.text, '¿Me podés ayudar?')
    assert.equal((await pb.match('I feel tired.', { lang: 'es' }))?.text, 'Me siento cansado.')
    // "Me siento" is present: "I felt" isn't one of its English ways, and "Today I…" isn't a Spanish frame.
    assert.equal(await pb.match('I felt tired.', { lang: 'es' }), null)
    assert.equal(await pb.match('Today I cooked.', { lang: 'es' }), null)
  })
})
