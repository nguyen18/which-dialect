import type { LanguageConfig } from '../scripts/language-config.ts'

// Spanish: regions are the countries (and the US) where Wiktionary tags Spanish usage. Group tags such
// as "Latin-America" or "Rioplatense" expand to their countries, and areas inside Spain (Andalusia,
// Canary Islands, …) count as Spain.

const CENTRAL_AMERICA = ['Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama']
const CARIBBEAN = ['Cuba', 'Dominican Republic', 'Puerto Rico']
const SOUTH_AMERICA = ['Colombia', 'Venezuela', 'Ecuador', 'Peru', 'Bolivia', 'Chile', 'Argentina', 'Uruguay', 'Paraguay']
const LATIN_AMERICA = ['Mexico', ...CENTRAL_AMERICA, ...CARIBBEAN, ...SOUTH_AMERICA]
const RIO_DE_LA_PLATA = ['Argentina', 'Uruguay']
// Where vos is the everyday "you" (sentence frames).
const VOSEO = [...RIO_DE_LA_PLATA, 'Paraguay']

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
  // Three-letter shards (words, English index and forms), as English: two-letter ones reached 2 MB
  // (forms/de.json), too much to parse per word in a serverless function (Mai's journal check ran out of CPU).
  shardLength: 3,
  // Spaces separate words; the checker fixes accents from the words and forms ("cancion" → "canción").
  checker: {
    units: 'words',
    // Letters Spanish learners mix up by sound: b/v, c/s/z (seseo), g/j, y/ll; and the silent h.
    similarLetters: ['bv', 'csz', 'gj', 'iy'],
    silentLetters: ['h'],
    // Words before a noun, for accent fixes on real words: "el trafico" (I traffic) → "el tráfico".
    posCues: [{ before: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'del', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra', 'este', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas'], pos: ['noun'] }],
    // English speakers' classic false friends: a hint wherever the word appears.
    falseFriends: [
      { word: 'embarazada', means: 'pregnant', say: ['avergonzada', 'apenada'], for: 'embarrassed' },
      { word: 'embarazado', means: 'pregnant (or obstructed)', say: ['avergonzado', 'apenado'], for: 'embarrassed' },
      { word: 'excitado', means: 'sexually aroused', say: ['emocionado'], for: 'excited' },
      { word: 'excitada', means: 'sexually aroused', say: ['emocionada'], for: 'excited' },
      { word: 'constipado', means: 'having a cold (Spain)', say: ['estreñido'], for: 'constipated' },
      { word: 'constipada', means: 'having a cold (Spain)', say: ['estreñida'], for: 'constipated' },
    ],
  },
  // Country and city names translate ("Japan" ↔ "Japón").
  placeNames: {},
  wordfreq: 'large',
  // Hand-picked first choices for English meanings (see scripts/picks.ts), drafted by Claude on 2026-11-02 from
  // a practice journal written in English (language-powerup), where word-by-word translation gave
  // "chulisnais" for nice, "por cuanto" for for, "lo" for the, "Francia" for dancing. To be reviewed by a
  // speaker (/word-review es). `first` puts the meaning first for a bare word, as the checker translates one.
  picks: [
    { word: 'nice', pos: 'adj', gloss: /^Pleasant, satisfactory, complimentary\./, picks: ['agradable', 'bonito', { word: 'lindo', tags: ['Latin America'] }, 'bueno'], first: true },
    { word: 'nice', pos: 'adj', gloss: /^Of a person: friendly, attractive\./, picks: ['simpático', 'amable', { word: 'majo', tags: ['Spain'] }] },
    { word: 'on', pos: 'prep', gloss: /^Positioned at the upper surface of/, picks: ['en', 'sobre'], first: true },
    { word: 'to', pos: 'prep', gloss: /^Indicating destination or final position/, picks: ['a', 'hacia'], first: true },
    { word: 'the', pos: 'article', gloss: /because it has already been mentioned/, picks: ['el', 'la', 'los', 'las'] },
    { word: 'a', pos: 'article', gloss: /^An unspecified example of/, picks: ['un', 'una'], first: true },
    { word: 'for', pos: 'prep', gloss: /^Directed at; intended to belong to\./, picks: ['para'], first: true },
    { word: 'for', pos: 'prep', gloss: /^Towards; in the direction of\./, picks: ['para', 'hacia'] },
    { word: 'but', pos: 'conj', gloss: /^However, although, nevertheless/, picks: ['pero'], first: true },
    { word: 'people', pos: 'noun', gloss: /^People in general/, picks: ['gente', 'personas'], first: true },
    { word: 'start', pos: 'verb', gloss: /^To begin\./, picks: ['empezar', 'comenzar'], first: true },
    { word: 'great', pos: 'adj', gloss: /^Very good; excellent; wonderful/, picks: ['genial', 'muy bueno', 'excelente'], first: true },
    { word: 'picture', pos: 'noun', gloss: /^A photograph\./, picks: ['foto', 'fotografía'], first: true },
    { word: 'plan', pos: 'noun', gloss: /^A set of intended actions/, picks: ['plan'], first: true },
    { word: 'tell', pos: 'verb', gloss: /^To convey by speech; to say\./, picks: ['decir'], first: true },
    { word: 'tell', pos: 'verb', gloss: /^To narrate, to recount\./, picks: ['contar'] },
    { word: 'smile', pos: 'verb', gloss: /^To have \(a smile\) on one's face\./, picks: ['sonreír'] },
    { word: 'answer', pos: 'verb', gloss: /^To make a reply or response to\./, picks: ['responder', 'contestar'] },
    { word: 'miss', pos: 'verb', gloss: /^To become aware of the loss or absence of/, picks: ['extrañar', { word: 'echar de menos', tags: ['Spain'] }], first: true },
    { word: 'dancing', pos: 'noun', gloss: /^The activity of taking part in a dance\./, picks: ['baile'], first: true },
    { word: 'home', pos: 'noun', gloss: /^One’s own dwelling place/, picks: ['casa', 'hogar'], first: true },
    { word: 'home', pos: 'adv', gloss: /^To one's place of residence/, picks: ['a casa'] },
    { word: 'home', pos: 'adv', gloss: /^At or in one's place of residence/, picks: ['en casa'] },
    { word: 'want', pos: 'verb', gloss: /^To wish for or desire \(something\)/, picks: ['querer', 'desear'], first: true },
    { word: 'need', pos: 'verb', gloss: /^To have an absolute requirement for\./, picks: ['necesitar'], first: true },
    { word: 'watch', pos: 'verb', gloss: /^To look at, see, or view for a period of time\./, picks: ['ver', 'mirar'], first: true },
    { word: 'make', pos: 'verb', gloss: /^To build, construct, produce, or originate\./, picks: ['hacer'] },
    { word: 'with', pos: 'prep', gloss: /^In the company of; alongside/, picks: ['con'], first: true },
    { word: 'about', pos: 'prep', gloss: /^Concerning; with regard to/, picks: ['sobre', 'de', 'acerca de'], first: true },
    { word: 'sorry', pos: 'intj', gloss: /^Expresses regret, remorse, or sorrow\./, picks: ['lo siento', 'perdón'], first: true },
    { word: 'please', pos: 'adv', gloss: /^Used to make a polite request\./, picks: ['por favor'], first: true },
    { word: 'evening', pos: 'noun', gloss: /^The time of day between afternoon and night\./, picks: ['noche', 'tarde'] },
  ],
  // Sentence frames (the shared catalog is languages/frames.ts), in tú, with vos where it's the everyday
  // "you" (querés, podés). Spanish verbs change with the person and tense, so frames whose verb slot would
  // need conjugating ("Today I {action}", "Do you {action}?") are left out: the others take an infinitive
  // (Quiero {action}), which is what a translated verb is. A noun slot gets the bare word: "Where is the
  // bathroom?" → "¿Dónde está baño?", missing its article until the data has noun genders (still far
  // closer than word by word). `en` keeps a frame to the English ways it says ("I was" isn't "Estoy").
  frames: [
    { frame: 'tomorrow', text: 'Mañana voy a {action}.' },
    { frame: 'want-to', text: 'Quiero {action}.' },
    { frame: 'want', text: 'Quiero {thing}.' },
    { frame: 'like-to', text: 'Me gusta {action}.' },
    { frame: 'like', text: 'Me gusta {thing}.' },
    { frame: 'went-to', text: 'Fui a {place}.' },
    { frame: 'have-to', text: 'Tengo que {action}.' },
    { frame: 'can', text: 'Puedo {action}.' },
    { frame: 'cannot', text: 'No puedo {action}.' },
    { frame: 'dont-know', text: 'No sé.' },
    { frame: 'dont-understand', text: 'No entiendo.' },
    { frame: 'feel', text: 'Me siento {quality}.', en: ['I feel {quality}.'] },
    // Estar, for how someone is ("Estoy cansado", the feelings topic); "I am tall" would be ser.
    { frame: 'am', text: 'Estoy {quality}.', en: ['I am {quality}.', "I'm {quality}."] },
    { frame: 'it-was', text: 'Fue {quality}.', en: ['It was {quality}.'] },
    { frame: 'but-it-was', text: 'pero fue {quality}', en: ['but it was {quality}'] },
    { frame: 'ask-where', text: '¿Dónde está {place}?' },
    { frame: 'ask-what', text: '¿Qué es {thing}?' },
    { frame: 'ask-how', text: '¿Cómo está {thing}?' },
    { frame: 'ask-when', text: '¿Cuándo vas a {action}?' },
    { frame: 'ask-how-much', text: '¿Cuánto cuesta {thing}?' },
    { frame: 'ask-eaten', text: '¿Ya {ATE}?' },
    { frame: 'ask-want', text: '¿{YOU_WANT} {thing}?' },
    { frame: 'help-me', text: '¿Me {YOU_CAN} ayudar?' },
    { frame: 'give-me', text: 'Me da {thing}, por favor.' },
    { frame: 'lets', text: 'Vamos a {action}.' },
    { frame: 'hello', text: 'Hola.' },
    { frame: 'thanks', text: 'Gracias.' },
    { frame: 'sorry', text: 'Lo siento.' },
    { frame: 'goodbye', text: 'Hasta luego.' },
    { frame: 'good-night', text: 'Buenas noches.' },
  ],
  // The words that change by region: vos forms where vos is the everyday "you", and Spain's perfect tense.
  frameWords: {
    YOU_WANT: { meaning: 'do you want', words: [
      { word: 'quieres', note: 'Tú form of querer.' },
      { word: 'querés', regions: VOSEO, note: 'Vos form of querer, the everyday "you" in the Río de la Plata and Paraguay.' },
    ] },
    YOU_CAN: { meaning: 'can you', words: [
      { word: 'puedes', note: 'Tú form of poder.' },
      { word: 'podés', regions: VOSEO, note: 'Vos form of poder, the everyday "you" in the Río de la Plata and Paraguay.' },
    ] },
    ATE: { meaning: 'have you eaten', words: [
      { word: 'comiste', note: 'Preterite, the usual "have you eaten yet" in Latin America.' },
      { word: 'has comido', regions: ['Spain'], note: 'Spain uses the perfect for something just done.' },
    ] },
  },
}

export default config
