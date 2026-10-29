# which-dialect-es

Spanish dictionary data for [which-dialect](https://github.com/nguyen18/which-dialect), with senses tagged by **country** where Wiktionary tags them (Spain, Mexico, Argentina, Cuba, …). Senses without a region tag are listed under every country (`regionTagged: false`).

You normally don't install this package: `which-dialect` loads its files on demand from jsDelivr.

```ts
import { createDictionary } from 'which-dialect'
const es = createDictionary({ lang: 'es' })
await es.searchEnglish('car', { region: 'Spain' })          // coche, …
await es.searchEnglish('car', { region: 'Mexico' })         // carro, auto, …
await es.searchEnglish('computer', { region: 'Latin America' }) // computadora, computador, …
```

## Regions

Spain, Mexico, Guatemala, Honduras, El Salvador, Nicaragua, Costa Rica, Panama, Cuba, Dominican Republic, Puerto Rico, Colombia, Venezuela, Ecuador, Peru, Bolivia, Chile, Argentina, Uruguay, Paraguay, United States, Philippines, Equatorial Guinea.

**Groups** (search them like a region): Latin America, Central America, Caribbean, South America, Río de la Plata (Argentina and Uruguay). Wiktionary tags like "Latin America" or "Rioplatense" count for every country in the group, and areas inside Spain (Andalusia, Canary Islands, …) count as Spain.

## Contents

- `data/meta.json`: regions, groups, source, license, counts, and the list of files.
- `data/words/<xx>.json`: entries by Spanish headword, split by the first two letters without accents (`ñame` → `na`).
- `data/en/<xx>.json`: English search terms → Spanish words.

About 124,000 entries; roughly 12,000 senses carry a region tag. Inflected forms (conjugations and plurals, about 80% of Wiktionary's Spanish entries) are left out; base words and spelling/regional variants are kept.

## Word frequencies

Each entry's `frequency` (and each search result's) is a Zipf score from **[wordfreq](https://github.com/rspeer/wordfreq)** by Robyn Speer (https://doi.org/10.5281/zenodo.7199437), CC BY-SA 4.0. wordfreq's data comes from Google Books Ngrams (http://books.google.com/ngrams), the Leeds Internet Corpus (University of Leeds Centre for Translation Studies), Wikipedia, ParaCrawl, OPUS OpenSubtitles 2018 (data from the OpenSubtitles project, opensubtitles.org), SUBTLEX word lists by Marc Brysbaert et al. (SUBTLEX is freely available data: http://crr.ugent.be/programs-data/subtitle-frequencies), and word statistics from the Twitter streaming API. Only one score per word in this dictionary is included, not wordfreq's word lists.

## License and attribution

This data is derived from [Wiktionary](https://en.wiktionary.org/) through [Kaikki.org](https://kaikki.org/dictionary/Spanish/)'s wiktextract extraction, and modified (filtered and reshaped) by which-dialect, with word frequencies from wordfreq (see above). It is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [LICENSE](LICENSE).

Apps that show this data should credit it where users can see it, for example: "Translations from Wiktionary, CC BY-SA 4.0, via which-dialect". Modified versions of the data must stay under CC BY-SA 4.0. Not affiliated with or endorsed by Wikimedia or Kaikki.org.
