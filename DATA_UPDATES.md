# Data updates

When each language's dictionary data was last updated from Wiktionary. The data is built from
[Kaikki.org](https://kaikki.org/)'s extraction of English Wiktionary; "Wiktionary data of" is the date
Kaikki last updated that language's file, "Downloaded" when we fetched it. Updated automatically by
`npm run build:data` (don't edit the table by hand). Published data packages carry the same dates in
`data/meta.json` (`source.lastModified`, `source.retrieved`). History is newest first; the build adds a
line when a language is added or its Wiktionary data changes, and other notes (like publishing) can be
added by hand.

<!-- rows:start -->
| Language | Code | Wiktionary data of | Downloaded | Entries |
|---|---|---|---|---|
| English | `en` | 2026-09-25 | 2026-09-27 | 599,081 |
| Spanish | `es` | 2026-09-25 | 2026-09-27 | 123,995 |
| Vietnamese | `vi` | 2026-09-28 | 2026-10-02 | 35,394 |
<!-- rows:end -->

## History

<!-- history -->
- 2026-10-29: Spanish added back (removed 2026-09-30), Wiktionary data of 2026-09-25, 123,995 entries. English rebuilt with Spanish translation tables (same dump; 142.8 MB).
- 2026-10-02: English rebuilt with place names (countries, and common cities and regions): 599,081 entries (was 594,544). Vietnamese place names are indexed for English search.
- 2026-10-02: Vietnamese updated to Wiktionary data of 2026-09-28 (was 2026-09-25), 35,394 entries.
- 2026-09-30: English and Vietnamese data published to npm as 0.1.0 (built from these dumps).
- 2026-09-27: Vietnamese added, Wiktionary data of 2026-09-25, 35,394 entries.
- 2026-09-27: English added, Wiktionary data of 2026-09-25, 594,544 entries.
