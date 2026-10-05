// Per-language settings for the build. Each language adds one file in languages/.

import type { CheckerConfig } from '../packages/core/src/types.ts'

export type LanguageConfig = {
  /** ISO 639 code; also the data package suffix (which-dialect-<lang>). */
  lang: string
  /** English name. */
  name: string
  /** The language name in Kaikki's URLs, e.g. "Vietnamese" in kaikki.org/dictionary/Vietnamese/. */
  kaikkiName: string
  /** Every region of the language. Untagged senses are listed under all of them. */
  regions: string[]
  /** Named groups of regions, searchable as one (e.g. English "North America"). Every member must be in `regions`. */
  regionGroups?: Record<string, string[]>
  /** Maps a sense's source tags to regions. Return [] when the sense has no region. */
  regionsFromTags: (tags: string[], rawTags: string[]) => string[]
  /** Parts of speech to leave out entirely. */
  skipPos?: string[]
  /**
   * Place names (Wiktionary's place categories: "Countries in Asia", "Cities in Japan") to keep, and to
   * index for English search, so "Japan" ↔ "Nhật Bản" translate. Other proper-name senses (given names,
   * surnames) are never indexed. When 'name' is in skipPos, only place senses of names are kept, and
   * places that aren't countries only when at least `minZipf` common (with wordfreq), so a large language
   * doesn't fill with villages and rivers.
   */
  placeNames?: { minZipf?: number }
  /**
   * Leave out inflected-form senses (Wiktionary "form-of", e.g. "plural of dog", "simple past of walk").
   * They're most of a heavily inflected language's entries and aren't how learners look words up.
   */
  skipFormOf?: boolean
  /** Return false to leave a headword out. */
  keepWord?: (word: string) => boolean
  /**
   * With skipFormOf off, keep inflected-form senses only for these parts of speech (e.g. English irregular
   * verbs "said" -> "say", but not regular noun plurals). Default: all.
   */
  formOfPos?: string[]
  /**
   * Labels to add to senses by Wiktionary topic or by definition, e.g. 'technical' for physics meanings and
   * 'sexual' for sexual ones, which Wiktionary often leaves unlabelled. The translator lists senses with
   * these labels after everyday ones (see LATER_LABELS in translate.ts). On English, the bridge, this
   * orders meanings for every target language ("excited": enthusiastic first, then the rest). Never added
   * to an entry's first sense, its main meaning ("gold" the metal, "circle" the shape).
   */
  senseLabels?: { label: string; topics?: string[]; gloss?: RegExp }[]
  /** Leave out senses with any of these labels (e.g. obsolete, archaic) to keep a large language small. */
  dropLabels?: string[]
  /** Leave out entries whose every sense is technical (has a Wiktionary topic, e.g. biology, law). */
  dropTechnical?: boolean
  /**
   * For kept inflected-form senses, return false to drop one, e.g. regular English forms ("walked" of
   * "walk") that a reader can undo by rule. Called with the form, the base word and the part of speech.
   */
  keepFormOf?: (form: string, lemma: string, pos: string) => boolean
  /** Keep at most this many senses per entry, and cut glosses longer than maxGlossLength characters. */
  maxSensesPerEntry?: number
  maxGlossLength?: number
  /**
   * Build the English search index (en/). Default true. 'regional' indexes only region-tagged senses:
   * English uses it so "truck" in the UK finds "lorry", without indexing every English word.
   */
  englishIndex?: boolean | 'regional'
  /**
   * Keep each sense's Wiktionary translation table for these language codes (English only: other
   * languages' Wiktionary entries don't have translation tables). Used to boost the usual translation
   * of each meaning.
   */
  translationLangs?: string[]
  /** wordfreq list for ranking common words first ('large' where wordfreq has it). Omit if none. */
  wordfreq?: 'small' | 'large'
  /** Example sentences kept per sense (default 2). */
  maxExamples?: number
  /** Letters per shard key (default 2). Large languages use 3 so each file stays small. */
  shardLength?: number
  /**
   * The pronoun table: how to say "I" and "you" depending on who you're talking to (see
   * scripts/pronouns.ts). For languages whose pronouns depend on the relationship, like Vietnamese.
   */
  pronouns?: PronounRowConfig[]
  /**
   * Hand-picked first choices for English meanings, in this language (see scripts/picks.ts). Optional:
   * languages without picks use the ranking alone. Only for common words where a speaker knows the
   * natural word and the ranking puts another first.
   */
  picks?: PickRowConfig[]
  /** How the grammar checker reads the language (see CheckerConfig); stored as data/checker.json. */
  checker?: CheckerConfig
  /**
   * How this language says the shared sentence frames (languages/frames.ts), by frame id. `text` has
   * {slot} placeholders: the frame's content slots, pronoun slots ({I}, {YOU}, …) and `frameWords` keys.
   */
  frames?: { frame: string; text: string; note?: string }[]
  /** The words for frame word slots ({WHERE}, {Q_END}, …), each from a definition or an override. */
  frameWords?: Record<string, { meaning: string; optional?: boolean; words: FrameWordPick[] }>
}

/**
 * One choice for a frame word slot. With `gloss`, a sense of `word` whose definition matches (region and
 * labels from that sense); otherwise an override for what no definition says, with a `note`.
 */
export type FrameWordPick =
  | { word: string; gloss: RegExp; when?: 'respect'; note?: string }
  | { word: string; gloss?: undefined; regions?: string[]; labels?: string[]; when?: 'respect'; note: string }

/**
 * One English meaning's hand-picked words. `word`, `pos` and `gloss` find the English sense (the build
 * warns when Wiktionary rewording breaks the match); `picks` are this language's words, best first, as
 * a word or { word, tags } with region tags ("Southern"). `first` puts the meaning first when the
 * caller gives no pos or meaning. `note` says why the pick is there.
 */
export type PickRowConfig = {
  word: string
  pos: string
  gloss: RegExp
  picks: (string | { word: string; tags?: string[] })[]
  /** Words never given for this meaning (removed on the review page). */
  exclude?: string[]
  first?: boolean
  note?: string
}

/**
 * One cell entry of the pronoun table. With `gloss`, a pronoun sense of `word` whose definition matches
 * it (region, labels and the definition come from that sense). With `rule`, a regular compound the
 * dictionary doesn't list ("các anh"); `note` names the rule. Otherwise an override for something the
 * definitions don't say; `note` then says why it's there. Rules and overrides can give regions and labels.
 */
type PronounPickExtra = { speaker?: 'male' | 'female'; gender?: 'male' | 'female'; inclusive?: boolean }
export type PronounPick = PronounPickExtra &
  (
    | { word: string; gloss: RegExp; note?: string }
    | { word: string; gloss?: undefined; rule?: boolean; regions?: string[]; labels?: string[]; note: string }
  )

export type PronounRowConfig = {
  id: string
  label: string
  /** The row to use when the relationship isn't known. At most one row. */
  default?: boolean
  /** Speaking up to this person (parents, elders, teachers): polite sentence endings are expected. */
  respect?: boolean
  warning?: string
} & Partial<Record<'self' | 'addressee' | 'third' | 'selfPlural' | 'addresseePlural' | 'thirdPlural', PronounPick[]>>
