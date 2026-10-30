import type { LanguageConfig } from '../scripts/language-config.ts'

// Spanish: regions are the countries (and the US) where Wiktionary tags Spanish usage. Group tags such
// as "Latin-America" or "Rioplatense" expand to their countries, and areas inside Spain (Andalusia,
// Canary Islands, …) count as Spain.

const CENTRAL_AMERICA = ['Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama']
const CARIBBEAN = ['Cuba', 'Dominican Republic', 'Puerto Rico']
const SOUTH_AMERICA = ['Colombia', 'Venezuela', 'Ecuador', 'Peru', 'Bolivia', 'Chile', 'Argentina', 'Uruguay', 'Paraguay']
const LATIN_AMERICA = ['Mexico', ...CENTRAL_AMERICA, ...CARIBBEAN, ...SOUTH_AMERICA]
const RIO_DE_LA_PLATA = ['Argentina', 'Uruguay']

const regionGroups: Record<string, string[]> = {
  'Latin America': LATIN_AMERICA,
  'Central America': CENTRAL_AMERICA,
  Caribbean: CARIBBEAN,
  'South America': SOUTH_AMERICA,
  'Río de la Plata': RIO_DE_LA_PLATA,
}

const SPAIN_AREAS = [
  'Andalusia', 'Canary-Islands', 'Aragon', 'Asturias', 'Galicia', 'Catalonia', 'Basque-Country',
  'Murcia', 'Extremadura', 'Navarre', 'Castile', 'Leon', 'Cantabria', 'La-Rioja', 'Balearic-Islands',
]

// Wiktionary tag (hyphenated) -> regions.
const TAG_REGIONS: Record<string, string[]> = {
  Spain: ['Spain'],
  ...Object.fromEntries(SPAIN_AREAS.map((t) => [t, ['Spain']])),
  Mexico: ['Mexico'],
  US: ['United States'],
  Louisiana: ['United States'],
  Philippines: ['Philippines'],
  'Equatorial-Guinea': ['Equatorial Guinea'],
  ...Object.fromEntries(LATIN_AMERICA.map((c) => [c.replace(/ /g, '-'), [c]])),
  'Latin-America': LATIN_AMERICA,
  'Central-America': CENTRAL_AMERICA,
  Caribbean: CARIBBEAN,
  'South-America': SOUTH_AMERICA,
  Rioplatense: RIO_DE_LA_PLATA,
  // Buenos Aires/Montevideo slang.
  Lunfardo: RIO_DE_LA_PLATA,
}

// Free-text raw tags like "in Spain" or "in Latin America", matched by name.
const NAME_REGIONS: [RegExp, string[]][] = Object.entries(TAG_REGIONS).map(([tag, regions]) => [
  new RegExp(`\\b${tag.replace(/-/g, ' ')}\\b`, 'i'),
  regions,
])

const config: LanguageConfig = {
  lang: 'es',
  name: 'Spanish',
  kaikkiName: 'Spanish',
  regions: ['Spain', ...LATIN_AMERICA, 'United States', 'Philippines', 'Equatorial Guinea'],
  regionGroups,
  regionsFromTags(tags, rawTags) {
    const found = new Set<string>()
    for (const tag of tags) for (const r of TAG_REGIONS[tag] ?? []) found.add(r)
    for (const raw of rawTags) {
      if (!/^in /i.test(raw)) continue
      for (const [pattern, regions] of NAME_REGIONS) if (pattern.test(raw)) regions.forEach((r) => found.add(r))
    }
    return [...found]
  },
  // Conjugations and plurals ("first-person plural of hablar") are ~80% of the source (~670k forms), so
  // they go in the compact forms index rather than the entries: "hablo" → hablar, and accent fixes on forms
  // ("hable" vs "hablé"). Verbs with attached pronouns ("dámelo", "tápalo", ~120k) are left out to keep the
  // data small. (Before 2026-10-29: skipFormOf, every form left out.)
  formsIndex: { keep: (tags) => !tags.some((t) => t.startsWith('object-')) },
  // Spaces separate words; the checker fixes accents from the words and forms ("cancion" → "canción").
  checker: { units: 'words' },
  // Country and city names translate ("Japan" ↔ "Japón").
  placeNames: {},
  wordfreq: 'large',
}

export default config
