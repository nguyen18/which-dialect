# Future improvements

Possible improvements that were found but deliberately left for later. Each has what's wrong, what we
learned about it, and a suggested approach. See `ARCHITECTURE.md` for how things work now.

## Cleanup

### Capitalized words showing up as translations

**Problem:** capitalized words appear next to their lowercase forms in results, e.g. "I" → *ta* and
*Ta*; "him" → *Người*.

**What we found (2026-09-30):** Vietnamese has 541 capitalized headwords that aren't proper names, and
71 of them have a lowercase twin. **Most twins are different words, not duplicates**: *Anh* (British)
vs *anh* (older brother), *Tàu* (Chinese) vs *tàu* (ship), *Hàn* (Korean) vs *hàn* (to weld), *Tây*
(Western) vs *tây*. Some capitalized pronouns are honorifics for specific people: *Người* ("He", for Hồ
Chí Minh or God), *Ta* ("I/me, the Buddha"), *Anh* ("he/him, the young Ho Chi Minh"). Merging every
capitalized word into its lowercase twin would break these.

**Suggested approach:** only fold senses whose definition says "alternative letter-case form of X"
into X (*Chủ nhật*, *Tx.*); keep the rest. In the translator, rank capitalized honorific pronouns below
ordinary ones when the source word isn't capitalized. Check the Cheatsheet and evaluation afterwards.

### Letter names matching pronouns

**Problem:** letter names come up as translations of pronouns: *i ngắn* (the letter i) for "I"; Spanish
*i latina*, *c*/*ce* for *se*. Pronouns are allowed to match nouns (`COMPATIBLE_POS.pron` includes
`noun`), and a letter's definition ("The name of the Latin script letter I/i") contains the pronoun.

**Suggested approach:** only let a letter-name sense ("The name of the … letter …") match when the
source sense is itself a letter.

### Lowercase "i" when looking up translation tables for non-English words

**Problem:** `tableFor()` looks up English bridge terms, which are lowercase, so for "I" it finds the
letter *i*, not the pronoun *I*, and misses its translation table. Spanish *yo* → Vietnamese missed
*tôi* because of this (when Spanish was supported). `englishCandidates()` had the same bug and was
fixed (it also looks up the capitalized word and prefers the exact part of speech); `tableFor()` needs
the same fix.

## Meaning order

### Words whose own meaning competes with a form of another word ("felt", "saw")

**Problem:** without context, a word's meanings come in the dictionary's order, own entries first. So
*felt* starts with the fabric (*phớt*) before "feel" (*cảm thấy*), and *saw* with the tool (*cưa*)
before "see" (*thấy*). In everyday text the past tense is usually meant. The 2026-09-30 fix for
inflected forms (*got* → "Have/has." → *có* first, see ARCHITECTURE.md) deliberately **doesn't change
this**: it only reorders a form's own colloquial meanings, and keeps a form's own entries ahead of its
base word's, as before. Other words like this: *left* (the side / past of leave), *found* (to establish /
past of find), *lay*, *rose*, *bore*, *wound*.

**What we found (2026-09-30):** deciding needs to know which meaning is more common, and the data
doesn't say. The obvious signal, how many languages translate each meaning in Wiktionary's translation
tables, is unreliable because Kaikki often attaches tables to the wrong meaning: *dog*'s 683-language
table sits on "Someone who overeats" (the animal has none), *want*'s 169-language table on "To desire
(to experience desire)" (not "To wish for"), *get*'s on "To receive" (not "To obtain"), *see*'s on "To
understand". Ranking by table size would make many common words worse. The dictionary's order is
otherwise mostly right (dog → animal, see → with the eyes, cool → temperature, just → only).

**Suggested approach:** compare the word's own frequency with the base word's (wordfreq has *felt* and
*feel*, but counts every use of the spelling, so this alone can't separate them); or use corpus counts
per meaning (WordNet's SemCor counts, English only; mapping WordNet's meanings to Wiktionary's is
substantial and imperfect); or let callers pass `pos` (a past-tense *felt* is a verb, the fabric a
noun). Until then, apps should pass `pos` or `meaning` when they know the context.

### Translation tables attached to the wrong meaning

**Problem:** the misattached tables above also affect translation: `TABLE_BONUS` (+4) goes to words
listed for a meaning, so a table on the wrong meaning boosts the wrong words there (and gives the right
meaning none). **Suggested approach:** check a table against the sense it's on (do its English
translations' definitions overlap the sense's?) and move it to the best-matching sense of the same
entry at build time, like `attachEntryTranslations` does for entry-level tables.

### Hand-picked words: what's left

The picks layer is **implemented** (2026-09-30; see ARCHITECTURE.md "Hand-picked words" and the README).
The owner reviews the top-100 sheet (`npm run picks-sheet -- vi --words ~/dev/top_100_words.txt`) to
add rows. Left for later, from the agreed design:

- **Keys by source-language meaning**, for distinctions English loses (*gạo*/*cơm*/*lúa* are all
  "rice"; "you" collapses *anh*/*em*/*chị*/*bạn*). Rows would live in the source language's config
  ("from this meaning, prefer …") and match the source sense directly instead of through English. Only
  where English-keyed picks can't say it.
- **Coverage report:** the sheet counts picked meanings; a coverage line per language in the build
  (share of the top-N English meanings with a pick or reviewed as already right) needs a way to record
  "reviewed, ranking is right" (e.g. a `reviewed` list, or `your_pick` = `ok`).
- **Size at scale:** `picks.json` is one file per language, loaded whole. Fine for thousands of rows;
  shard it like `words/` if a language grows past ~10k rows.
- **Upstream:** picks use Wiktionary's table format; good ones can be added to Wiktionary's translation
  tables so every tool benefits on the next data refresh.
- **Into English:** picks aren't applied when translating into English (they're keyed by English
  meaning); English-target preferences would need source-language keys (above).

### The English word itself as weak evidence for words with many meanings ("fix 2")

**Problem:** the English word itself is always a main search term, so for *get* (33 meanings) every
meaning picks up words that only match "get" in some sense (*bắt* "catch" under "have" and "become";
*hóng*, *ra khỏi*). **What we found (2026-09-30, prototype):** dropping the main-term bonus for the
English word when it has ≥ 10 meanings of that part of speech cleaned up most of *get*'s meanings (have
→ có, phải, dùng; become → ra, thành, trở thành) but added other noise (*bỏ* for fetch, *mắc phải* 4th
for obtain) and affects every common English word (*run*, *take*, *make*, *go*, *set*…).
**Suggested approach:** revisit with the top-100 comparison, alone and after picks exist. Related noise:
English bridge words with two meanings (*do* "To perform; to execute" → *tử hình*, execute = put to death).

## Place names and nationality phrases

Place names translate both ways since 2026-10-02 (*Japan* ↔ *Nhật Bản*). Next:

- **Nationality phrases:** Vietnamese puts the thing first and the country's short name after it: *món
  Nhật* (Japanese food), *tiếng Nhật* (Japanese, the language), *người Nhật* (a Japanese person). English
  "Japanese" already gives *Nhật* (an adjective in the data); a phrase rule (English adjective + noun →
  Vietnamese noun + short name, with the usual head word per thing: *món* for food, *tiếng* for
  language, *người* for people) would build them both ways. Keep it per-language, like frames.
- **Places that are also surnames** (*Hughes*) are read as English places in Vietnamese text; the
  checker could leave capitalized words with no translation alone.
- **Loose matches** still listed for some countries: *gà trống Gô-loa* (the Gallic rooster) for France,
  *nga ngố* (a Russian, slang) for Russia; they come from Wiktionary's translation tables.

## Grammar checker

The first version (2026-10-01) checks spelling and accents, words from another region, pronouns against
the listener, I/you pronoun pairs and polite endings. Since the same day it's a **spellchecker by
default** (spelling, and English words translated); the other checks are opt-in. Next, roughly in order:

- **Texting shorthand** (*ko* → không, *dc*/*đc* → được, *j* → gì, *bít* → biết, *mún* → muốn, *hok*):
  a per-language list in the checker settings, suggested with a note ("texting form of không") rather
  than corrected, since some write that way on purpose ("option 2", 2026-10-02).
- **Typos that make another real syllable** (*kông*, *mún*): letter fixes only apply to non-syllables;
  catching these needs context (the words around it) or the shorthand list.
- **Rare and literary syllables** missing from the syllable list are flagged (*ngổ*, *hiếc*, *trợt* in the
  dictionary's own examples); adding syllables from example sentences would cut these false alarms.
- **Word-by-word translation reads like English:** "it was very expensive" → *nó là rất mắc* (natural:
  *mắc quá*). More clause frames ("it was {quality}" with intensifiers, "because …", "and then …") and
  slot values translated word by word inside frames ("very happy") would cover common cases.
- **Ambiguous accent-less words:** *ma*, *me*, *da* stay when the gap to *mà*, *mẹ*, *đã* is under 1.5
  Zipf in accented text; context could decide. Neighbors decide since 2026-10-01 when the run is a
  dictionary word (*hom nay* → *hôm nay*); phrases that aren't headwords (*đi chợ*, *với má*) would need
  bigram frequencies or frames.

- **Question forms:** *có … không?* for yes/no questions, *đã … chưa?* for "have you … yet". Needs a few
  patterns over the segmented words; every pattern needs correct sentences in the no-false-alarm test.
- **Polite starts:** *dạ*, *vâng* at the start of a reply also count as polite (today only the ending *ạ*).
- **Word order:** noun before adjective (*xe đỏ*, not *đỏ xe*). Needs each word's part of speech in
  context, and Vietnamese words often have several; only flag clear cases.
- **Classifiers:** *con chó*, *cái bàn*, *chiếc xe*. Needs a noun → classifier list; check whether
  Kaikki's Vietnamese data has classifiers before hand-writing one.
- **Languages without spaces** (Chinese, Japanese, Thai): a `units: 'characters'` mode, longest match over
  characters, plus a script-aware `shardKey` (see "More languages").
- **Checker settings for English:** today English gets only the region check. Spelling would need English's
  inflected forms (`regularBaseForms`), not a syllable list.
- **Dictation text:** speech recognizers write standard spellings (*hông* → *không*), so don't treat
  missing Southern words in dictated text as the learner's mistake.
- **"Does this sound natural?":** rules can't judge this. The owner doesn't plan to use an LLM, so the
  review stays rule-based: say plainly what wasn't checked and point to frames instead.

## Sentence frames and journal review

The first version (2026-10-01): 34 frames in `languages/frames.ts`, Vietnamese versions and frame words,
`createPhrasebook` and `createReviewer`. Next, roughly in order:

- **More frames, reviewed by a speaker:** draft candidates from the data (424 Vietnamese phrase entries,
  ~9,800 example sentences with translations), like the picks sheet, and grow by how often learners need
  them. Central forms (*mô*, *răng*, *chi*) especially need a speaker's check.
- **Better content words in frames:** slots take the translator's first word, which is sometimes not the
  everyday one (*bathroom* → *phòng tắm*, where people ask for *nhà vệ sinh*); hand-picked words would fix
  the common ones.
- **Possessives in slots:** "my mother" in a slot isn't translated (*mẹ tôi*); handle "my/your + noun".
- **Longer English parts:** anything over 3 words that no frame covers is listed as unchecked. More frames
  (and clause frames like "because …", "and then …") are the rule-based way to cover more.
- **Ambiguous accent-less words:** *toi*, *di*, *cho* are real words without accents, so they're only fixed
  when a frame shows what they should be; frames covering more journal sentences help here too.
- **Talking to someone in a journal:** an entry that addresses someone ("Mẹ ơi, …") could set the listener
  for that sentence.

## Phrase lookup

Wiktionary lists words, not everyday phrases, so many natural picks aren't headwords: *bữa tối*, *tốt
nhất*, *ít hơn*, *thật sự là*. The review page shows them as "Not a dictionary entry (a phrase)" with no
definition (2026-10-05). Ideas:

- **Build a phrase's meaning from its parts:** split it into known words (`dictionary.segment`) and show
  each part's definition (*thật sự là* = thật sự "really" + là "is"; *bữa tối* = bữa "meal" + tối
  "evening").
- **A phrase list per language:** everyday phrases with a definition and a note, like the pronoun
  table's overrides, so picks, the translator and the review page can all use them. Reviewed picks that
  are phrases are a natural starting list.
- **Phrases from example sentences:** Wiktionary's examples and their translations contain many of
  them; frequent word pairs there could be suggested for the list.
- **Lookup without accents and case** for phrases too (*thiet la* → *thiệt là*), as `variants` does for
  words.

## Pronouns

- **Possessives:** plain "her" leads with its possessive sense ("belonging to her"), Wiktionary's first,
  which the pronoun table doesn't cover. Vietnamese possessives are *của* + pronoun (*của cô ấy*); a
  possessive column (or deriving it from the pronoun) would fix "her", "my", "your", "his", "their".
- **Region tags on *anh ấy* etc.:** Wiktionary tags *anh ấy*, *chị ấy*, *ông ấy*, *bà ấy*, *cô ấy* as
  Northern only, so a Southern filter drops them for *ảnh*, *chỉ*, *ổng*, *bả*. They're also standard in
  the South. Following the data is the owner's rule, so any change would be an override with a note.
- **Fresh held-out evaluation cases:** the held-out set has been looked at; write new held-out pronoun
  cases (I/you/he/we, with and without `listener`/`about`) before relying on it again.

## More languages

which-dialect is starting with Vietnamese (English is the bridge), and the current focus is cleaning up
Vietnamese. More languages are planned; the code is language-general (region groups, `skipFormOf`,
`translationLangs`, the pronoun table), so adding one is a config file plus a data package (README:
"Adding a language").

### Spanish (removed 2026-09-30, to add back later)

Spanish was supported from 2026-09-27 and removed to focus on Vietnamese. To bring it back: restore
`languages/es.ts` and `packages/es/` from git history (last in commit `e0136ed`), add `'es'` back to
`translationLangs` in `languages/en.ts`, rebuild es and en, and restore the Spanish test suite and
evaluation cases (also in that commit). Known problems to fix when it comes back:

- "you" leads with object forms (*le*, *os*) and mostly misses *tú*: Wiktionary lists the plural and
  object senses of "you" first, and their tables are object clitics.
- "we" includes *escritor*/*pluma*, from the editorial-we sense.
- *tú* → Vietnamese gives dialectal *mầy*/*bay*/*bây*, far stronger than *tú*.
- *ellos* → Vietnamese gives nothing.
- *yo* → Vietnamese misses *tôi* (the lowercase "i" bug in `tableFor`, above).
- *cerdo* without `pos` fails: its adjective sense ("dirty") is listed first.
- A pronoun table for Spanish could cover *tú* / *usted* / *vos* by relationship and region.
- The Spanish data needs a rebuild to pick up the subpage-title fix ("i/languages M to Z" → *i*).

Removing Spanish also shrank the English data from 140.2 to 136.2 MB (it stored Spanish translation
tables), leaving more room under jsDelivr's ~150 MB package limit. Adding languages back will grow it
again; check the size each time.

## Publishing and apps

- Not yet published to npm (needs `npm login`); see "Publishing" in `ARCHITECTURE.md`.
- Language Helper could use `listener`, `about` and `pronounUses` for its Cheatsheet.
