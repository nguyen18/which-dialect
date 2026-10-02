# which-dialect

Translate words **between languages and between dialects**, meaning by meaning: Northern Vietnamese *ngô* into Southern *bắp*, English *cool* (as in "awesome") into Southern Vietnamese *ngầu*, English "I" into the right Vietnamese pronoun for who you're talking to, US *truck* into UK *lorry*. Dictionary data comes from [Wiktionary](https://en.wiktionary.org/) (via [Kaikki.org](https://kaikki.org/)) and loads only when you need it.

**Status:** which-dialect is starting with **Vietnamese**, with English as the bridge language, and the current focus is cleaning up Vietnamese translations. **More languages are planned.** The translator and data format are language-general, so adding one is a config file plus a data package (see [Adding a language](#adding-a-language)). Spanish was supported early on and has been removed for now so the work can focus on Vietnamese.

```ts
import { createTranslator } from 'which-dialect'

const tr = createTranslator()

await tr.translate('ngô', { from: 'vi', fromRegion: 'Northern', to: 'vi', toRegion: 'Southern' }) // bắp
await tr.translate('I', { from: 'en', to: 'vi', listener: 'parent' })                           // con
await tr.translate('he', { from: 'en', to: 'vi', toRegion: 'Southern' })                        // ảnh, nó, …
await tr.translate('truck', { from: 'en', fromRegion: 'US', to: 'en', toRegion: 'UK' })         // lorry
await tr.translate('cool', { from: 'en', to: 'vi', toRegion: 'Southern', meaning: 'awesome' })  // bá cháy, chất, khét, ngầu (not mát, "cool" the temperature)
```

Each result is a list of **groups, one per meaning** of the source word, each with its part of speech, its definitions and its translations, so a word's meanings never get mixed up.

**Data:** Wiktionary data of 2026-09-25 for both languages. See [`DATA_UPDATES.md`](DATA_UPDATES.md) for each language's dates and update history.

You install one small package. Dictionary data is **not bundled**: each lookup fetches one small file (usually 5–100 kB compressed) from the language's data package on the jsDelivr CDN, and caches it.

## Languages

| Language | Code | Data package | Regions | Entries | Region-tagged senses |
|---|---|---|---|---|---|
| Vietnamese | `vi` | [`which-dialect-vi`](packages/vi) | Northern, Central, Southern | 35,394 | 1,330 of 42,419 (3.1%) |
| English | `en` | [`which-dialect-en`](packages/en) | 15 countries/areas (US, UK, Australia, India, …), plus groups: North America, British Isles, Commonwealth, … | 594,544 | 37,339 of 776,085 (4.8%) |

Vietnamese and English can be translated in both directions, and between any of their regions, including between two dialects of one language (Northern → Southern Vietnamese, US → UK English). English is also the bridge every language's definitions are written in.

More languages are planned. Each one is a config file in [`languages/`](languages) plus a data package in `packages/<code>`; see [Adding a language](#adding-a-language).

## Install

```sh
npm install which-dialect
```

Works in browsers and in Node 18+ (anywhere with `fetch`).

## Translating

### `createTranslator({ baseUrl?, load?, dictionary? })`

Loads each language's data on demand. The options are only needed to self-host the data: `baseUrl(lang)` returns where a language's data folder is served, and `load(lang)` returns a custom loader (e.g. reading from disk in Node).

### `translator.translate(word, options)`

| Option | Meaning |
|---|---|
| `from`, `to` | Language codes. They can be the same, to translate between dialects of one language. |
| `fromRegion`, `toRegion` | Region or region group, e.g. `'Southern'`, `'Northern'`, `'UK'`, `'North America'`. `fromRegion` keeps only the word's senses used there; `toRegion` ranks words tagged for it first and leaves out words tagged only for other regions. |
| `pos` | Only source senses with this part of speech, e.g. `'noun'`. |
| `meaning` | A few words describing the meaning you want, e.g. `'awesome'` for *cool*. Matching senses and words rank first. |
| `register` | `'casual'`, `'neutral'` or `'polite'`: the register you want translations in, instead of the source's own. `'casual'` favors colloquial words (Southern *tui* for "I"). |
| `listener` | Who you're talking to, as a row id of the target language's pronoun table (Vietnamese: `'parent'`, `'older-male'`, `'friend'`, …; see `dictionary.pronouns()`). For "I"/"me", "you", "we"/"us" and plural "you" that relationship's words come first: *I* to a parent → *con*; *you* → Southern *ba*, *má*; *we* → *chúng con*. Without it, the table's neutral default row leads (*I* → *tôi*, *you* → *bạn*). Ignored for languages without a pronoun table. |
| `about` | Who you're talking about, as a row id like `listener`, for "he"/"him", "she"/"her" and "they"/"them": *he* about a grandparent → *ông ấy* (Southern *ổng*); *she* about a teacher → *cô*. Without it, the default row leads (*he* → *anh ấy*, Southern *ảnh*; *they* → *họ*). |
| `speaker` | `'male'` or `'female'`, for pronouns that depend on it (*anh* vs *chị* toward someone younger). |
| `exclude` | Labels to leave out (default: vulgar, offensive, derogatory, archaic, obsolete, dated, historical, rare, abbreviation). |
| `limit` | Translations per meaning (default 5). |
| `allSenses` | Return every meaning, including ones with no translation, instead of only useful ones. For letting users pick a meaning. |
| `picks` | Use the target language's [hand-picked words](#hand-picked-words) (default `true`). `false` returns the ranking alone. |

It returns `TranslationGroup[]`, most relevant meaning first. Each group has:

- `source`: the meaning being translated: `lemma` (the base or standard word, e.g. *say* for *said*), `pos`, `glosses` (its English definitions), `regions`, `labels`, and `via` when the word led there ("simple past of say", "Southern Vietnam form of không").
- `translations`: target words, best first, each with its own `pos`, `gloss`, `regions`, `labels`, a `score`, and `bridge` (how it was found; `'picked'` for [hand-picked words](#hand-picked-words); `'pronouns'` for the listener's words, which also carry `relationship`, e.g. "Your parents").
- `pronounUses` (source words in the source language's pronoun table): the relationships the word is used in with this meaning, `{ id, label, person: 'self' | 'addressee', speaker?, regions, note?, warning? }`. Uses no definition covers get a group of their own, translated as "I" or "you": Vietnamese *em* → "I/me, when talking to: someone a bit older (man); …; your teacher" and "you, when talking to: someone younger; …"; *ba* → "you, when talking to: your parents". Pass `pos: 'pron'` to get only these.
- `relationships` (singular "I"/"you" meanings into a language with a pronoun table): the word for each relationship, `{ id, label, words, warning? }`, filtered by `toRegion`, `speaker` and `exclude`, for showing "it depends on who you're talking to".

### `translator.senses(word, { from, fromRegion?, pos? })`

The meanings of a word, following forms and variant spellings: useful for letting a user pick which meaning they mean before translating.

## How translation works

Every language's data defines its words in English, so English is the bridge between any two languages. For each **meaning** of the source word:

1. **Forms and variants go to the word they belong to:** irregular forms from the data (*said* → *say*), regular English forms by rule (*walked* → *walk*, *running* → *run*), texting spellings (*dont* → *don't*), and regional variants (*hông* → *không*, keeping its Southern region).
2. **English terms carry the meaning:** the terms in its definition ("bắp": *corn*), or for English words the word itself and its synonyms. **Place names** carry their own name: *Japan* ↔ *Nhật Bản* (defined "Japan (a country in East Asia)"), also *Nhật*; *South Korea* ↔ *Hàn Quốc*; *Kyoto* → *Kinh Đô*. A word counts only when its definition is of the place itself, not one that mentions it (a robe "worn by the emperors of China, Japan, Korea and Vietnam" isn't Japan). Places come from Wiktionary's place categories: every place name in the target language, and in English every country plus about 4,200 common cities and regions, leaving out ones that are also ordinary words (*Reading*, *Bath*, *Well*). Given names and surnames aren't translated.
3. **The target is searched with a compatible part of speech** (`compatiblePos`): a noun for a noun, but an English auxiliary verb may be a Vietnamese particle, and an adjective may be a verb in another language.
4. **Wiktionary's translation tables** give the usual translation of each English meaning in each language, often with region and register tags ("I" → Vietnamese *tôi*, *tớ* (informal), *tui* (South); *cool* "mildly low temperature" → *mát*). Listed words get a strong boost, more when tagged for the target region, less when tagged only for other regions. From another language, the English meaning whose table lists the source word is the same meaning.
5. **Within one language, synonyms are direct equivalents.** Wiktionary lists dialect words as synonyms (*ngô* → *bắp*, *lợn* → *heo*, *lift* → *elevator*), in either direction (*dạ* lists *vâng*).
6. **Ranking** favors **common words** ([word frequencies](#word-frequencies): *anh* over the niche *cô nương* for "you"), target words whose definition shares the source definition's details, whose *main* meaning is the match, that are tagged for the target region, and that keep the **register**: a polite word translates to a polite word (Northern *vâng* → Southern *dạ*), slang to slang.

**Hand-picked words** come before all of these for the meanings that have them (see below).

Meanings are ordered by `meaning` (if given), then by being tagged for `fromRegion`, then the dictionary's own order, which lists main meanings first. **Specialist and sexual meanings come last:** the English data labels later meanings `technical` (physics, chemistry, geometry… from Wiktionary's topics) or `sexual` (by definition, since Wiktionary seldom labels them), so "excited" lists *enthusiastic* and "to stir the emotions" before "in a state of higher energy", "having an erection" and "sexually aroused", for every target language. A word's first meaning is never labelled, so *gold* stays the metal and *circle* the shape (`senseLabels` in `languages/en.ts`). That order is a guess when a word has several parts of speech: English *just* is listed as an adjective ("fair") before the adverb. Pass `pos` or `meaning` when you know which one you want.

### Hand-picked words

For common words, a speaker of the target language knows the natural word even where the data ranks another first: *get* "To fetch, bring, take" ranks Vietnamese *đưa* ("to hand, to bring") above *lấy*, because *đưa*'s definition matches more of the English words and no *lấy* definition says "fetch". Each language can list **hand-picked words for English meanings** (`picks` in `languages/<code>.ts`, built into `picks.json`). In a meaning that has picks, the picked words come first (`bridge: 'picked'`), then the ranked words; other meanings are unchanged. Picks can carry a region tag, like translation tables: with `toRegion`, picks tagged for it come first and picks tagged only for other regions are left to the ranking. A pick can also mark its meaning as the one to put first when no `pos` or `meaning` is given.

Picks are keyed by English meaning, so each language needs one list however many languages there are: translating from any other language reaches them through the English meaning (as with translation tables). They're optional: a language without picks uses the ranking alone. `picks: false` shows the ranking alone, and `npm run evaluate` reports both. Vietnamese picks so far: *get* "fetch" → *lấy*, *mang*; *get* "obtain" → *lấy*.

### How accurate is it?

`npm run evaluate` runs known-correct translations across language pairs and dialect pairs (English → Vietnamese by region, including pronouns, Northern → Southern Vietnamese, US ↔ UK, Vietnamese → English). A case passes when a correct word is in the top 3 of the first meaning:

| Set | Correct word in top 3 | Correct word first |
|---|---|---|
| Tuning set (used while developing) | 49 / 49 (100%) | 49 / 49 (100%); 48 / 49 without picks |
| Held-out set (written afterwards, not tuned against) | 17 / 17 (100%) | 16 / 17 (94%) |

The cases involving Spanish were removed with it. The held-out set has since been looked at, so new held-out cases are needed before relying on it (see [`FUTURE_IMPROVEMENTS.md`](FUTURE_IMPROVEMENTS.md)).

## Checking text

### `createChecker({ baseUrl?, load?, dictionary? })` → `checker.check(text, options)`

A spellchecker for learners: it gives a correction for every word it can, with the exact place in the text and a short reason. Words written in the learner's own language (English by default) get the target-language word. Further checks (regions, pronouns, politeness) can be turned on. It runs in the browser like the rest of the library: no API calls, no cost.

```ts
import { createChecker } from 'which-dialect'

const checker = createChecker()
const { text, issues, parts } = await checker.check('Toi muon an the ice cream but it was very expensive.', {
  lang: 'vi', region: 'Southern',
})
// Toi → Tôi · muon → muốn · an → ăn          (accents)
// the → (left out: Vietnamese has no "the") · ice cream → kem · but → nhưng · it → nó
// was → là · very → rất · expensive → mắc    (English words, in Southern Vietnamese)
```

| Option | Meaning |
|---|---|
| `lang` | The text's language (the target). |
| `base` | The learner's own language, whose words get translated (default `'en'`). |
| `region` | The region's words are used for translations (*expensive* → Southern *mắc*, Northern *đắt*), and the `dialect` check, when on, flags other regions' words. |
| `register` | `'casual'` allows colloquial translations; otherwise plain ones come first. |
| `rules` | Turn checks on or off. By default only `spelling` and `foreign-word` run; e.g. `{ dialect: true, 'pronoun-relationship': true }`. |
| `listener`, `about`, `speaker` | For the pronoun and polite-ending checks: who you're talking to and about (pronoun-table row ids), and the speaker's gender. |

The result has `text` (the input in Unicode NFC form), `issues` and `parts` (the text split by language). Each issue has `rule`, `severity` (`'error'`: not a word of the language; `'warning'`: probably wrong, or wrong for the region or relationship; `'suggestion'`: often better), `start`/`end` (offsets into `text`), `text`, `message` and `suggestions` (replacements for `text`, best first; `''` means leave it out).

**On by default (the spellchecker):**

- **`spelling`**: a doubtful syllable is first tried with its neighbors: if fixing its accents makes a dictionary word with the syllables next to it, that word is suggested (*hom nay* → *hôm nay* "today", where *nay* alone would become *này* "this"; *an com* → *ăn cơm*; *Chung toi* → *Chúng tôi*), changing only the doubtful syllables. Less common words written without accents can change the same way when one dictionary word clearly wins (*mua sam* → *mua sắm* "shopping", *nha sach* → *nhà sách*), even common ones when the whole word has no accents (*nha bang* → *nhà băng* "bank"), while a common one left plain next to accented syllables is taken as meant (*tháng sau* stays), *cho con* never becomes *chó con* (not a headword) and runs that could be two words equally are left alone (*ban an*: *bản án* or *bàn ăn*). Otherwise, syllables that aren't in the language get the accented forms they could be (*khong* → *không*); rare plain-letter words next to a far more common accented form too (*toi* → *tôi*, *hom* → *hôm*), and, in a sentence typed without accents, any more common accented form (*an* → *ăn*, *di* → *đi*; not *con* → *còn*, about as common). Names (capitalized mid-sentence), the language's listed pronouns (*tui*) and plain-letter words with no accented form (*email*) are left alone. Languages written in syllables only (Vietnamese).
  **Letter typos:** a syllable that isn't in the language also gets one-letter fixes (a letter missing, extra, wrong or two swapped) with any accents: *khôg*, *khôngg* → *không*; *họk* → *học*; *tihch* → *thích*; *muốm* → *muốn*; with its neighbors, *Cảm ơm* → *Cảm ơn*. Candidates keeping the accent marks the writer typed come first (*ngừoi* → *người*, *ơm* → *ơn* rather than *ôm*), then accent-only fixes, then letters often confused (`similarLetters` in the checker settings; Vietnamese c/k/q, s/x, i/y, m/n count as half a change), then other letter changes, then the more common syllable. Plain-letter non-words are only treated as typos when a one-letter fix is a common syllable (else they're names or foreign words). Real syllables are never letter-changed, so a typo that makes another real word (*kông*, *mún*) isn't caught. Abbreviations with inner capitals (*GĐ*, *TKiều*) and other scripts (Chinese characters) are left alone.
- **`foreign-word`**: words in the learner's own language get the target-language word, in the region and register (*market* → *chợ*, *ice cream* → *kem*). Phrases the base dictionary knows are translated as one, falling back to single words. Words the language has no word for are suggested to be left out (`leaveOut` in its checker settings: Vietnamese has no *the*, *a*, *an*). Which language each word is in comes from the two dictionaries: an English word that's also Vietnamese once accents are added is weighed by how common each is (*rat* is *rất*, far more common than English *rat*; *but* stays English, far more common than *bút*), and close calls (*met*: *mệt* or English *met*) are Vietnamese only among Vietnamese words; Vietnamese typed without accents (*khong*) is Vietnamese; words both languages have go by how common they are in each (*em*, *di*, *tui* are Vietnamese even between English words; *the* is English), and close calls (*an*, *to*) follow their neighbors, leaning to the target language.

**Opt-in (`rules`):**

- **`dialect`**: words whose main meaning is tagged for another region (*lợn* in Southern text → *heo*; *muỗng* in Northern → *thìa*; in English, US *apartment* in UK text → *flat*). Without `region`, words that don't fit the rest of the text's region are pointed out. Words with an untagged main meaning are never flagged (*má* is "cheek" everywhere).
- **`pronoun-relationship`**: pronouns that don't fit the listener (*tôi* to a parent → *con*; to a teacher → *em*).
- **`pronoun-pair`**: "I" and "you" pronouns that never go together (*tao* goes with *mày*, not *bạn*), when no listener is given.
- **`pronoun-consistency`**: switching words for the same person within one text (*tôi* in one sentence, *tui* in the next): keep the first.
- **`polite-ending`**: a suggestion to end sentences with *ạ* when talking to parents, elders and teachers (not for exclamations).

Corrections are word by word: they don't fix word order or grammar, so English translated word by word reads like English in Vietnamese words (*it was very expensive* → *nó là rất mắc*). Whole English sentences or clauses that follow a [sentence frame](#sentence-frames) get the frame's natural wording instead in the [journal review](#reviewing-journal-entries). The checker only speaks up when it's confident, so **no issues means none of the checks found anything, not that the text is correct**.

**Every language uses the same checks.** They read only the language's data and its `checker` settings in `languages/<code>.ts` (how text splits into words, which pronouns are reliable, polite endings, words with no equivalent), so a check whose data a language doesn't have is skipped. A language without checker settings is read as space-separated words: English words in it are still translated, and the `dialect` check works.

## Sentence frames

Common sentences with slots, filled for a region, a listener and a register: *Where is {place}?* is *{place} ở **đâu**?*, and in Central Vietnamese *{place} ở **mô**?*; *Have you eaten yet?* to a parent in the South is *Ba ăn cơm chưa ạ?*, to a friend *Bạn ăn cơm chưa?*.

```ts
import { createPhrasebook } from 'which-dialect'

const pb = createPhrasebook()
await pb.frames({ lang: 'vi', region: 'Southern', topic: 'questions' })       // every frame, slots open
await pb.render('ask-where', { lang: 'vi', region: 'Central', slots: { place: 'bathroom' } })
// → { text: 'Phòng tắm ở mô?', parts: [{ text: 'Phòng tắm', kind: 'content', from: 'bathroom' }, …,
//      { text: 'mô', kind: 'word', why: 'where (Central)' }, …], complete: true }
await pb.match('Do you want coffee?', { lang: 'vi' })                         // → 'Bạn có muốn cà phê không?'
await pb.matchFrames('Bạn có đi?', { lang: 'vi' })                            // → 'Bạn có đi không?' (missing "không")
```

Options: `lang`, `region`, `listener` (a pronoun-table row id; without it, the neutral default row), `speaker`, `register` (`'casual'` allows colloquial words like Southern *hông*, *tui*). Content slots take English (translated for you, in the region) or `{ text }` in the language itself. `parts` says why each word was chosen, for highlighting. `matchFrames` recognizes a frame in a sentence in the language itself (the journal review uses it to list the frames a sentence follows) and returns the changes the frame would suggest: a missing required word (*không*), a word from another region (*mô* in Southern text → *đâu*), missing accents in a frame position (*Toi* → *Tôi*), and, only when a listener is given, a pronoun that doesn't fit them.

The frames themselves are written once, in English, in [`languages/frames.ts`](languages/frames.ts) (34 so far: journal sentences, feelings, questions, requests, greetings). Each language says how it expresses them (`frames` in `languages/<code>.ts`), with pronoun slots (`{I}`, `{YOU}`, `{WE_INCL}`, …, filled from the pronoun table) and **frame words** for what changes by region (`frameWords`: Vietnamese `{WHERE}` *đâu* / Central *mô*, `{HOW}` Northern *thế nào* / *sao* / Central *răng*, `{SOFT}` Northern *nhé* / Central and Southern *nha*, `{Q_END}` *không* / Southern casual *hông*, `{POLITE}` *ạ* when speaking up). Each frame word comes from a dictionary definition, keeping its region and labels, or from an override with a note, like the pronoun table. A language without frames returns none.

## Reviewing journal entries

`createReviewer().review(entry, { lang, base?, region?, register?, checks?, listener?, speaker? })` reviews an entry written in the target language, the learner's own language (`base`, default `'en'`), or a mix of both, and returns the corrected entry, in the target language, sentence by sentence:

```ts
import { createReviewer } from 'which-dialect'

const review = await createReviewer().review(
  'Hôm nay tôi đi market với má. Tôi muốn ăn thịt lợn but it was expensive. Ngày mai tui đi lại khong?',
  { lang: 'vi', region: 'Southern' },
)
review.corrected
// 'Hôm nay tôi đi chợ với má. Tôi muốn ăn thịt lợn nhưng mắc quá. Ngày mai tui đi lại không?'
review.sentences[1].changes
// [{ from: 'but it was expensive', to: 'nhưng mắc quá', kind: 'frame', why: 'Sentence frame “but it was {quality}”' }]

// With the regional and consistency checks on:
await createReviewer().review(entry, { lang: 'vi', region: 'Southern', checks: { dialect: true, 'pronoun-consistency': true } })
// 'Hôm nay tôi đi chợ với má. Tôi muốn ăn thịt heo nhưng mắc quá. Ngày mai tôi đi lại không?'
```

For each sentence:

1. **Each word is marked as the target or the base language** (`parts`), as in the checker's `foreign-word` check.
2. **A whole base-language sentence or clause that follows a sentence frame is filled in** with the frame's wording (*but it was expensive* → *nhưng mắc quá*; *Where is the bathroom?* → *Phòng tắm ở đâu?*).
3. **The checker runs on the whole entry**: by default the spellchecker, so every remaining English word gets its translation and every misspelled word its accents; `checks` turns on more (regions, pronouns, consistency across sentences, polite endings). Its errors and warnings are applied (`changes`); its suggestions, like ending with *ạ*, are returned as `hints`.
4. **The frames the corrected sentence follows are listed** (`frames`), for suggesting patterns to reuse. Frames don't change the sentence.

Each sentence has `original`, `parts`, `corrected`, `changes` (`{ from, to, why, kind }`; `to` is `''` when a word is left out), `hints`, `frames` (`{ id, en, text }`, the frame's English and its pattern) and `unchecked` (English words with no translation, left as written). For a journal, leave `listener` out: people written about (*má*, *thầy*) aren't treated as the listener. Corrections are word by word except for frames: word order and grammar aren't fixed (*I am very happy* → *Tôi là rất mừng*).

## Looking words up

### `createDictionary({ lang, baseUrl?, load? })`

One language's dictionary. `baseUrl` defaults to `https://cdn.jsdelivr.net/npm/which-dialect-<lang>@0.1/data`.

- `dictionary.lookup(word)`: all entries for a word, with every sense's definitions, regions, labels, synonyms and variant links (`altOf`).
- `dictionary.searchEnglish(term, { region?, pos?, exclude?, limit?, allSenses? })`: words for an English term in this language, one per word, best first (no meaning handling: use the translator for that). `allSenses: true` returns every matching sense of those words instead.
- `dictionary.frames()`: the language's sentence frames and frame words, unfilled (`{ frames, words }`; empty without frames).
- `dictionary.segment(text)`: the text split into the language's words, longest dictionary match first (up to the checker's `maxWordUnits`, 3 for Vietnamese): `Hôm nay tôi ăn cơm.` → *Hôm nay* · *tôi* · *ăn cơm*, each `{ text, start, end, entries }` (offsets into the NFC text; `entries` empty for words the dictionary doesn't have). Use it to treat a word of several syllables as one, e.g. to show its meaning.
- `dictionary.variants(word, { limit? })`: other words with the same letters but other accents that the dictionary has, most common first, each `{ word, entries, frequency? }`: *muộn* → *muốn*, *mượn*, *muôn*…; for words of several syllables every syllable varies (*hom nay* → *hôm nay*). Capitalized headwords count too, unless they're only a person's name: *nhat* → *nhất*, *Nhật* (Japan), *nhạt*…; *nhat ban* → *Nhật Bản*. For apps that let learners pick the word they meant: a real word with the wrong tone passes the spellchecker. Languages written in syllables only (`[]` otherwise).
- `dictionary.checker()` / `dictionary.syllables()`: the language's checker settings and syllable list (with frequencies), used by `createChecker` (`{}` for languages without them).
- `dictionary.picks()`: the language's [hand-picked words](#hand-picked-words), `{ word, pos, gloss, picks: [{ word, tags? }], first? }` per English meaning (empty for languages without any).
- `dictionary.meta()`: the language's name, regions, region groups, source, license, build date and counts.
- `dictionary.pronouns({ listener?, region?, speaker?, exclude? })`: how to say "I", "you", "he/she", "we", plural "you" and "they" depending on who you're talking to (or about), one row per relationship, for languages whose pronouns depend on it (so far Vietnamese; empty for others). Each row has the columns `self`, `addressee`, `third`, `selfPlural`, `addresseePlural` and `thirdPlural`. Each word says where it comes from: a dictionary definition (`source: 'gloss'`, with the `gloss`), a grammar rule for a regular compound the dictionary doesn't list (`source: 'rule'`, e.g. *các anh*, with a `note`), or a hand-written override (`source: 'override'`, with a `note`); and, when it has one, the `gender` of the person it refers to and whether a "we" is `inclusive`.

```js
const vi = createDictionary({ lang: 'vi' })
const [parents] = await vi.pronouns({ listener: 'parent', region: 'Southern' })
parents.self.map((c) => c.word)      // ['con']
parents.addressee.map((c) => c.word) // ['ba', 'má', 'mẹ']
```

Vietnamese rows: `general` (the default: neutral words), `friend`, `close-friend`, `older-male`, `older-female`, `younger`, `parent`, `parents-age`, `grandparents-age`, `teacher`, `partner`, `formal`. `speaker: 'male' | 'female'` resolves choices like *anh* vs *chị* toward someone younger.

## Parts of speech

Entries and results use Wiktionary's part-of-speech codes (`noun`, `verb`, `adj`, `adv`, `pron`, `det`, `prep`, `conj`, `intj`, `particle`, `classifier`, `num`, `phrase`, `contraction`, …).

- `POS_NAMES` / `posName(code)`: readable names and one-line explanations for learners (`posName('adj')` → "Adjective"; `particle`: "A small word that adds grammar or tone rather than meaning, e.g. Vietnamese đã (past)…").
- `compatiblePos(pos)`: the parts of speech that can translate one from any language.

## How regions work

Each language defines its regions: dialect areas for Vietnamese, countries and areas for English. Wiktionary tags some senses with a region; for example Vietnamese *lợn* "pig" is tagged Northern and *heo* Central and Southern. **Senses with no region tag are treated as used in every region**, and marked `regionTagged: false`, so you can tell a confirmed regional word from an assumed one.

- **Per sense, not per word:** Vietnamese *má* means "cheek" everywhere, but "mother" only in the South.
- **Groups:** a language can define groups of regions. Wiktionary's group tags (English "British Isles", "North America") count for every region in the group, and you can search a group as a whole.
- **Variants:** words recorded as a variant of another ("Southern Vietnam form of *không*") are found by the other word's meanings, so "not" finds *hông*, and keep their region when translated.

## Limitations

This is a suggestion tool, not a curated translation dictionary. Check results before teaching them.

- **Few region tags.** Most senses carry no region (see the table), so they're assumed to be used everywhere, including some words that are really old-fashioned or local.
- **No word frequencies.** The source doesn't say how common a word or meaning is. Without `pos`/`meaning`, the first meaning follows the dictionary's order, which isn't always the most common one.
- **English is the bridge.** Translating between two non-English languages goes through English definitions, so nuance English doesn't mark can be lost.
- **`meaning` matches words, not ideas.** It compares your words with the dictionary's definitions (and the top translation's), so "awesome" won't find a sense defined as "Fashionable; trendy; hip." Use the definition's own wording, or let users pick from `senses()`.
- **Nationality phrases aren't built yet.** *Japan* → *Nhật Bản* works, but "Japanese food" → *món Nhật* (the thing, then the country's short name) doesn't; see FUTURE_IMPROVEMENTS.md.
- **Grammar words translate poorly.** Words defined by their function ("marks the future tense" for Vietnamese *sẽ*) aren't reached from English *will*; *the*, *is* or *gonna* may give nothing useful.

## Word frequencies

Translations are ranked partly by how common each word is, using **[wordfreq](https://github.com/rspeer/wordfreq)** by Robyn Speer (Robyn Speer. (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo. https://doi.org/10.5281/zenodo.7199437), licensed CC BY-SA 4.0. Only a single frequency score is stored for each word already in these dictionaries (`frequency` on entries and results), never wordfreq's word lists.

wordfreq's data comes from, and is credited to:

- Google Books Ngrams (<http://books.google.com/ngrams>) and Google Books Syntactic Ngrams.
- The Leeds Internet Corpus, from the University of Leeds Centre for Translation Studies (<http://corpus.leeds.ac.uk/list.html>).
- Wikipedia, the free encyclopedia (<http://www.wikipedia.org>).
- ParaCrawl, a multilingual Web crawl (<https://paracrawl.eu>).
- OPUS OpenSubtitles 2018 (<http://opus.nlpl.eu/OpenSubtitles.php>), whose data originates from the OpenSubtitles project (<http://www.opensubtitles.org/>).
- SUBTLEX word lists (SUBTLEX-US, SUBTLEX-UK, SUBTLEX-CH, SUBTLEX-DE, SUBTLEX-NL) created by **Marc Brysbaert et al.**; SUBTLEX is freely available data (<http://crr.ugent.be/programs-data/subtitle-frequencies>).
- Word statistics gathered from the Twitter streaming API (no Twitter content is included).

wordfreq measures commonness **worldwide**, so a regional word can look rare even where it's the everyday word; the region bonus is kept separate from frequency for that reason.

## License and attribution

- **Code** (this repo, and the `which-dialect` package): [MIT](LICENSE).
- **Data** (the `which-dialect-<code>` packages): derived from Wiktionary via Kaikki.org's [wiktextract](https://github.com/tatuylonen/wiktextract) extraction, modified (filtered and reshaped) by this project, with word frequencies from [wordfreq](#word-frequencies), and licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

If your app **shows** this data, credit it where users can see it, for example:

> Translations from [Wiktionary](https://en.wiktionary.org/), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), via which-dialect.

If you **redistribute modified data**, it has to stay under CC BY-SA 4.0. Using the API in your app doesn't change your app's own license. This project isn't affiliated with or endorsed by Wikimedia or Kaikki.org.

## Development

Requires Node 22.6+ (TypeScript scripts run with `--experimental-strip-types`).

Generated data (`packages/<code>/data`) isn't committed, so a fresh clone needs it first. Two ways:

- **Quick start: `npm run fetch:data`.** Downloads the published data packages from npm (a few seconds), then rebuilds hand-picked words from the repo's configs. You get exactly the published data, so tests and `npm run evaluate` match the numbers in this README. Use this unless you're changing how data is built.
- **Build from Wiktionary: `npm run build:data:all`.** Downloads Kaikki's files (English 3.3 GB, Vietnamese 79 MB; cached in `.cache/`) and builds every language, **English first**: English is the bridge between languages, and other languages' hand-picked words are checked against it. Kaikki always serves its latest dump, so this can be newer than the published data; the build records the dates in [`DATA_UPDATES.md`](DATA_UPDATES.md). Building one language alone (`npm run build:data -- vi`) also works once English is built.

```sh
npm install
npm run fetch:data                   # quick start: the published data (-- --force replaces data you already have)
npm run build:data:all               # or build every language from Kaikki, English first (-- --refresh re-downloads)
npm run build:data -- vi             # build one language (after English); -- vi --refresh re-downloads first
npm test                             # unit tests, plus checks against whichever languages are built
npm run evaluate                     # translation accuracy on known-correct cases, with and without picks (-- --verbose to see every case)
npm run build:picks -- vi            # rebuild only a language's hand-picked words (after editing `picks` in languages/vi.ts)
npm run picks-sheet -- vi            # review sheet (.cache/picks-vi.csv) of the top English words' meanings; -- --words file.txt, -- --top 500
npm run picks-sheet -- vi --apply sheet.csv   # config rows for the rows whose your_pick is filled in
npm run picks-sheet -- vi --top 300 --drafts reviews/vi-top300.json --html page.html   # the same rows as a review page
npm run picks-sheet -- vi --apply-decisions <dir> --drafts reviews/vi-top300.json     # config rows from the page's decisions
npm run typecheck
npm run build                        # compile the API to packages/core/dist
```

Generated data isn't committed (it would bloat git history); it's built before publishing. Builds take seconds (English: about 25 s and 1.4 GB of memory).

### Adding a language

1. Add `languages/<code>.ts`: the Kaikki language name, the language's regions (and groups, if any), and how to read regions from Wiktionary's tags. See [`languages/vi.ts`](languages/vi.ts) (dialect areas and a pronoun table) and [`languages/en.ts`](languages/en.ts) (countries with region groups, and trimming a very large language). Spanish was built this way too (countries and region groups; `languages/es.ts` in the git history). Set `placeNames: {}` so its place names translate ("Japan" ↔ its name for Japan). Set `skipFormOf` for heavily inflected languages; for very large ones, see the trimming options in [`scripts/language-config.ts`](scripts/language-config.ts) (`dropTechnical`, `formOfPos`, `keepFormOf`, `maxSensesPerEntry`, `shardLength`, …).
2. Copy a data package (`packages/vi`) to `packages/<code>` and update its `package.json` and `README.md`.
3. Add the language's code to `translationLangs` in `languages/en.ts` (so English keeps its translation tables for it) and rebuild English.
4. `npm run build:data -- <code>`, check the results, add a few real-data tests and evaluation cases, and publish.
5. Optional: [checker](#checking-text) settings (`checker` in `languages/<code>.ts`): `units: 'syllables'` for languages written in syllables (also builds the syllable list for accent suggestions), `maxWordUnits`, the reliable `pronouns` per pronoun-table column, `ambiguousPronouns`, and `politeEndings`, `similarLetters` (groups of letters often confused, for typo suggestions). Without them, the language is read as space-separated words and gets the region check.
6. Optional: [sentence frames](#sentence-frames): `frames` (how the language says each frame in `languages/frames.ts`) and `frameWords` (the words that change by region, each from a definition or an override with a note). Frames reach other languages through the shared catalog; a new frame goes in the catalog once.
7. Optional, later: [hand-picked words](#hand-picked-words). A speaker runs `npm run picks-sheet -- <code>`, fills in `your_pick` only where the first choice is wrong, and pastes the `--apply` output into `picks`. Or as a **review page**: draft suggestions for the meanings whose first word is wrong in `reviews/<code>-top300.json` (picks, confidence, why, an example sentence), build the page with `--html`, publish it as a claude.ai Artifact (it saves each decision in its database), and once a speaker has gone through it, export the decisions and turn them into config rows with `--apply-decisions`. In Claude Code, the project skill `/word-review <language> <N>` does all of this (and `/word-review <language> <N> apply` afterwards).

Languages in non-Latin scripts (Chinese, Arabic, Russian, …) will need a script-aware version of `shardKey` first: today files are split by the first two Latin letters.

### Publishing

```sh
npm run build:data:all -- --refresh && npm test    # records the new dates in DATA_UPDATES.md: commit it
npm publish -w which-dialect-en
npm publish -w which-dialect-vi
npm publish -w which-dialect
```

The API loads data versions matching `DATA_VERSION` in `packages/core/src/index.ts` (currently `0.1`). Data-only updates can publish new 0.1.x data versions without touching the API; bump `DATA_VERSION` when the data format changes.
