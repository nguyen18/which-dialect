# which-dialect-vi

Vietnamese dictionary data for [which-dialect](https://github.com/nguyen18/which-dialect), with senses tagged **Northern**, **Central** and **Southern** where Wiktionary tags them. Senses without a region tag are listed under all three regions (`regionTagged: false`).

You normally don't install this package: `which-dialect` loads its files on demand from jsDelivr.

```ts
import { createDictionary } from 'which-dialect'
const vi = createDictionary({ lang: 'vi' })
await vi.searchEnglish('pig', { region: 'Southern' }) // heo, …
```

## Contents

- `data/meta.json`: regions, source, license, counts, and the list of files.
- `data/words/<xx>.json`: entries by Vietnamese headword, split by the first two letters without diacritics (`không` → `kh`).
- `data/en/<xx>.json`: English search terms → Vietnamese words.
- `data/phrases.json`: an everyday phrasebook, about 2,400 common Vietnamese phrases paired with English (*ở nhà* "at home", *ăn cơm chưa* "have you eaten?"), written for which-dialect and released under the same license.

About 35,000 entries; roughly 1,300 senses carry a region tag (Southern, Central or Northern). North Central Vietnamese counts as Central. Chinese-character (chữ Hán/chữ Nôm) entries and romanizations are left out.

## Word frequencies

Each entry's `frequency` (and each search result's) is a Zipf score from **[wordfreq](https://github.com/rspeer/wordfreq)** by Robyn Speer (https://doi.org/10.5281/zenodo.7199437), CC BY-SA 4.0. wordfreq's data comes from Google Books Ngrams (http://books.google.com/ngrams), the Leeds Internet Corpus (University of Leeds Centre for Translation Studies), Wikipedia, ParaCrawl, OPUS OpenSubtitles 2018 (data from the OpenSubtitles project, opensubtitles.org), SUBTLEX word lists by Marc Brysbaert et al. (SUBTLEX is freely available data: http://crr.ugent.be/programs-data/subtitle-frequencies), and word statistics from the Twitter streaming API. Only one score per word in this dictionary is included, not wordfreq's word lists.

## License and attribution

This data is derived from [Wiktionary](https://en.wiktionary.org/) through [Kaikki.org](https://kaikki.org/dictionary/Vietnamese/)'s wiktextract extraction, and modified (filtered and reshaped) by which-dialect, with word frequencies from wordfreq (see above). It is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [LICENSE](LICENSE).

Apps that show this data should credit it where users can see it, for example: "Translations from Wiktionary, CC BY-SA 4.0, via which-dialect". Modified versions of the data must stay under CC BY-SA 4.0. Not affiliated with or endorsed by Wikimedia or Kaikki.org.
