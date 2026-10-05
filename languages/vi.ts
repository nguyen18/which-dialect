import type { LanguageConfig, PronounPick } from '../scripts/language-config.ts'

// Regular compounds for the pronoun table (the dictionary doesn't list them): "các" makes a plural
// ("các anh", you older men), "chúng" a plural "we" ("chúng em"), Southern "tụi" either ("tụi em"), and
// "ấy" ("that") a "he/she" ("em ấy"). Extra fields (regions, gender, speaker, inclusive) pass through.
type Extra = Partial<Pick<PronounPick, 'speaker' | 'gender' | 'inclusive'>> & { regions?: string[] }
const cac = (w: string, extra: Extra = {}): PronounPick => ({ word: `các ${w}`, rule: true, note: `các (plural) + ${w}`, ...extra })
const chung = (w: string, extra: Extra = {}): PronounPick => ({ word: `chúng ${w}`, rule: true, note: `chúng (plural "we") + ${w}`, inclusive: false, ...extra })
const tui_ = (w: string, extra: Extra = {}): PronounPick => ({ word: `tụi ${w}`, rule: true, regions: ['Southern'], note: `tụi (Southern plural) + ${w}`, ...extra })
const ay = (w: string, extra: Extra = {}): PronounPick => ({ word: `${w} ấy`, rule: true, note: `${w} + ấy ("that"): he/she`, ...extra })
const EM_NOTE = 'Wiktionary defines em only as "refers to any person described by the noun em" (younger sibling, younger person).'

// Vietnamese: three dialect regions. The source tags senses with "Northern", "Central" and "Southern";
// "Central" + "North" together means North Central Vietnam, which counts as Central here.
const config: LanguageConfig = {
  lang: 'vi',
  name: 'Vietnamese',
  kaikkiName: 'Vietnamese',
  regions: ['Northern', 'Central', 'Southern'],
  regionsFromTags(tags, rawTags) {
    const found = new Set<string>()
    if (tags.includes('Southern')) found.add('Southern')
    if (tags.includes('Central')) found.add('Central')
    if (tags.includes('Northern') || (tags.includes('North') && !tags.includes('Central'))) found.add('Northern')
    // A few senses spell the region out in free text instead, e.g. "in Central Vietnam and Southern Vietnam".
    for (const raw of rawTags) {
      if (!/vietnam|dialect/i.test(raw)) continue
      if (/south/i.test(raw)) found.add('Southern')
      if (/central/i.test(raw)) found.add('Central')
      if (/north(ern)? vietnam|northern dialect/i.test(raw) && !/north central/i.test(raw)) found.add('Northern')
    }
    return [...found]
  },
  // Chinese characters (chữ Hán/chữ Nôm) and romanizations aren't words a learner looks up.
  skipPos: ['character', 'romanization'],
  // Place names are indexed for English search ("Japan" → "Nhật Bản"); given names aren't.
  placeNames: {},
  keepWord: (word) => /[a-zA-ZÀ-ỹđĐ]/.test(word),
  // wordfreq only has a "small" Vietnamese list (the most common ~25k tokens, which are syllables).
  wordfreq: 'small',
  // Sentence frames (the shared catalog is languages/frames.ts). Placeholders: the frame's content slots
  // (lowercase), pronoun slots ({I}, {YOU}, {WE_INCL}: from the pronoun table for the listener) and frame
  // word slots (uppercase, below), which carry the regional differences.
  frames: [
    { frame: 'today', text: 'Hôm nay {I} {action}.' },
    { frame: 'yesterday', text: 'Hôm qua {I} {action}.' },
    { frame: 'tomorrow', text: 'Ngày mai {I} sẽ {action}.' },
    { frame: 'want-to', text: '{I} muốn {action}.' },
    { frame: 'want', text: '{I} muốn {thing}.' },
    { frame: 'like-to', text: '{I} thích {action}.' },
    { frame: 'like', text: '{I} thích {thing}.' },
    { frame: 'went-to', text: '{I} đã đi {place}.' },
    { frame: 'have-to', text: '{I} phải {action}.' },
    { frame: 'can', text: '{I} có thể {action}.' },
    { frame: 'cannot', text: '{I} {NOT} thể {action}.' },
    { frame: 'dont-know', text: '{I} {NOT} biết.' },
    { frame: 'dont-understand', text: '{I} {NOT} hiểu.' },
    { frame: 'feel', text: '{I} cảm thấy {quality}.' },
    { frame: 'am', text: '{I} {quality}.' },
    { frame: 'it-was', text: '{quality} quá.' },
    { frame: 'but-it-was', text: 'nhưng {quality} quá' },
    { frame: 'ask-where', text: '{place} ở {WHERE}?' },
    { frame: 'ask-what', text: '{thing} là {WHAT}?' },
    { frame: 'ask-how', text: '{thing} {HOW}?' },
    { frame: 'ask-when', text: '{WHEN} {YOU} {action}?' },
    { frame: 'ask-how-much', text: '{thing} bao nhiêu tiền?' },
    { frame: 'ask-eaten', text: '{YOU} ăn cơm chưa {POLITE}?' },
    { frame: 'ask-done', text: '{YOU} đã {action} chưa {POLITE}?' },
    { frame: 'ask-want', text: '{YOU} có muốn {thing} {Q_END} {POLITE}?' },
    { frame: 'ask-yes-no', text: '{YOU} có {action} {Q_END} {POLITE}?' },
    { frame: 'help-me', text: '{YOU} giúp {I} được {Q_END} {POLITE}?' },
    { frame: 'give-me', text: 'Cho {I} {thing} {POLITE}.' },
    { frame: 'lets', text: '{WE_INCL} {action} {SOFT}.' },
    { frame: 'hello', text: 'Chào {YOU} {POLITE}.' },
    { frame: 'thanks', text: 'Cảm ơn {YOU} {POLITE}.' },
    { frame: 'sorry', text: '{I} xin lỗi {YOU} {POLITE}.' },
    { frame: 'goodbye', text: 'Hẹn gặp lại {YOU} {POLITE}.' },
    { frame: 'good-night', text: 'Chúc {YOU} ngủ ngon {POLITE}.' },
  ],
  // The words that change by region or politeness. Choices for the user's region come first; casual ones
  // (colloquial, informal) only with register: 'casual'.
  frameWords: {
    WHERE: { meaning: 'where', words: [
      { word: 'đâu', gloss: /^where$/ },
      { word: 'mô', gloss: /^where$/ },
    ] },
    WHAT: { meaning: 'what', words: [
      { word: 'gì', gloss: /^what; whatever$/ },
      { word: 'chi', gloss: /^what; whatever$/ },
    ] },
    HOW: { meaning: 'how', words: [
      { word: 'thế nào', gloss: /^how; what; in what manner/ },
      { word: 'sao', gloss: /^how$/ },
      { word: 'răng', gloss: /^why; how; what$/ },
    ] },
    WHEN: { meaning: 'when', words: [
      { word: 'khi nào', gloss: /^when$/ },
      { word: 'chừng nào', regions: ['Southern'], labels: ['colloquial'], note: 'Southern casual "when"; Wiktionary labels it colloquial but gives no region.' },
    ] },
    NOT: { meaning: 'not', words: [
      { word: 'không', gloss: /^Negates the meaning/ },
      { word: 'hông', regions: ['Southern'], labels: ['colloquial'], note: 'Southern casual "không"; Wiktionary has it as a variant of không.' },
    ] },
    Q_END: { meaning: 'yes/no question ending', words: [
      { word: 'không', gloss: /^Used to form polar questions/ },
      { word: 'hông', regions: ['Southern'], labels: ['colloquial'], note: 'Southern casual "không"; Wiktionary has it as a variant of không.' },
    ] },
    SOFT: { meaning: 'friendly ending (okay?)', optional: true, words: [
      { word: 'nhé', gloss: /^alright\?; okay\?; will you\?$/ },
      { word: 'nha', gloss: /^alright\?; okay\?; will you\?$/ },
    ] },
    POLITE: { meaning: 'polite ending', optional: true, words: [
      { word: 'ạ', gloss: /^Used at the end of the sentence to express formality or politeness/, when: 'respect' },
    ] },
  },
  // The grammar checker (see CheckerConfig). Vietnamese is written in syllables that group into words
  // ("thịt heo", "kết quả"); the longest common words are about 4 syllables.
  checker: {
    units: 'syllables',
    maxWordUnits: 4,
    // Only pronouns that are reliably pronouns. Left out on purpose: kinship words (con is also "child"
    // and a classifier: con chó), mình (also "body, self"), nó (also "it"), họ (also "surname").
    pronouns: {
      self: ['tôi', 'tui', 'tớ', 'tao'],
      selfPlural: ['chúng tôi', 'chúng ta', 'chúng mình', 'chúng tao', 'tụi tui', 'tụi tao', 'tụi mình'],
      addressee: ['mày', 'bạn'],
      addresseePlural: ['các bạn', 'chúng mày', 'tụi mày', 'quý vị'],
    },
    // bạn is also "friend" (bạn của tôi: my friend), so it's only ever a suggestion.
    ambiguousPronouns: ['bạn'],
    // Expected at the end of sentences said to parents, elders and teachers (rows marked respect).
    politeEndings: ['ạ'],
    // English words Vietnamese has no word for: no articles, so they're left out, not translated.
    leaveOut: ['the', 'a', 'an'],
    // Letters often confused: c/k/q and s/x sound alike, i/y are interchangeable in many words, m/n are
    // next to each other and both end syllables ("ơm" for "ơn").
    similarLetters: ['ckq', 'sx', 'iy', 'mn'],
  },
  // How to say "I", "you", "he/she", "we", plural "you" and "they" depending on who you're talking to
  // (or about). Picks with a `gloss` are pronoun definitions from the data ("you, my father"); rules are
  // regular compounds the dictionary doesn't list ("các" + "anh"); the few others are overrides for what
  // Wiktionary's definitions don't say, each with a note.
  pronouns: [
    {
      id: 'general',
      label: 'Anyone / not sure (neutral)',
      default: true,
      self: [
        { word: 'tôi', gloss: /^I\/me \(used in formal contexts/ },
        { word: 'mình', gloss: /^I\/me$/ },
        { word: 'tui', gloss: /^alternative form of tôi$/ },
      ],
      addressee: [
        { word: 'bạn', gloss: /^you, an unspecified person viewing a work/ },
        { word: 'anh', gloss: /^you, a young adult man$/, gender: 'male' },
        { word: 'chị', gloss: /^you, a young-adult woman$/, gender: 'female' },
      ],
      third: [
        { word: 'anh ấy', gloss: /^he \(man of equal or slightly greater social status\)$/, gender: 'male' },
        { word: 'chị ấy', gloss: /^she \(who is somewhat older than the speaker\)$/, gender: 'female' },
        { word: 'ảnh', gloss: /^he; him \(man of equal or slightly greater social status\)$/, gender: 'male' },
        { word: 'chỉ', gloss: /^she; her$/, gender: 'female' },
        { word: 'nó', gloss: /^he; him; she; her$/ },
      ],
      selfPlural: [
        { word: 'chúng tôi', gloss: /^we\/us \(exclusive\)/, inclusive: false },
        { word: 'chúng ta', gloss: /^we\/us \(inclusive\)/, inclusive: true },
        { word: 'chúng mình', gloss: /^we\/us \(inclusive\)$/, inclusive: true },
        { word: 'tụi tui', gloss: /^we\/us \(exclusive\)$/, inclusive: false },
      ],
      addresseePlural: [
        cac('bạn'),
        { word: 'mọi người', gloss: /you guys/ },
      ],
      thirdPlural: [
        { word: 'họ', gloss: /^they\/them \(used in formal situations/ },
        { word: 'chúng nó', gloss: /^they\/them$/ },
        { word: 'tụi nó', gloss: /^they\/them$/ },
      ],
    },
    {
      id: 'friend',
      label: 'A friend your age',
      self: [
        { word: 'mình', gloss: /^I\/me$/ },
        { word: 'tớ', gloss: /^I; me$/ },
        { word: 'tui', gloss: /^alternative form of tôi$/ },
        { word: 'tôi', gloss: /^I\/me \(used when talking to one's friends\)$/ },
      ],
      addressee: [
        { word: 'bạn', gloss: /^you, a peer of the speaker$/ },
        { word: 'cậu', gloss: /^you, my peer who I know is as old as me$/ },
      ],
      third: [ay('bạn'), ay('cậu')],
      selfPlural: [
        { word: 'chúng mình', gloss: /^we\/us \(inclusive\)$/, inclusive: true },
        tui_('mình', { inclusive: true }),
        chung('tớ', { regions: ['Northern'] }),
        { word: 'tụi tui', gloss: /^we\/us \(exclusive\)$/, inclusive: false },
      ],
      addresseePlural: [cac('bạn'), cac('cậu')],
      thirdPlural: [
        { word: 'chúng nó', gloss: /^they\/them$/ },
        { word: 'tụi nó', gloss: /^they\/them$/ },
      ],
    },
    {
      id: 'close-friend',
      label: 'A close friend (very casual)',
      self: [{ word: 'tao', gloss: /^I\/me$/ }],
      addressee: [{ word: 'mày', gloss: /^you$/ }],
      third: [{ word: 'nó', gloss: /^he; him; she; her$/ }],
      selfPlural: [
        { word: 'chúng tao', gloss: /^we; us \(exclusive\)$/, inclusive: false },
        tui_('tao'),
      ],
      addresseePlural: [
        { word: 'chúng mày', gloss: /^you \(second-person plural\)$/ },
        tui_('mày'),
        { word: 'bây', gloss: /^you \(second-person plural\)$/ },
      ],
      thirdPlural: [
        { word: 'chúng nó', gloss: /^they\/them$/ },
        { word: 'tụi nó', gloss: /^they\/them$/ },
      ],
      // The definitions only label these "familiar".
      warning: 'Rude with anyone but close friends.',
    },
    {
      id: 'older-male',
      label: 'Someone a bit older (man)',
      self: [{ word: 'em', note: EM_NOTE }],
      addressee: [{ word: 'anh', gloss: /^you, a male who's \(presumably\) slightly older than me$/ }],
      third: [
        { word: 'anh ấy', gloss: /^he \(man of equal or slightly greater social status\)$/, gender: 'male' },
        { word: 'ảnh', gloss: /^he; him \(man of equal or slightly greater social status\)$/, gender: 'male' },
      ],
      selfPlural: [chung('em'), tui_('em')],
      addresseePlural: [cac('anh')],
      thirdPlural: [cac('anh ấy')],
    },
    {
      id: 'older-female',
      label: 'Someone a bit older (woman)',
      self: [{ word: 'em', note: EM_NOTE }],
      addressee: [{ word: 'chị', gloss: /^you, a female who's \(presumably\) slightly older than me$/ }],
      third: [
        { word: 'chị ấy', gloss: /^she \(who is somewhat older than the speaker\)$/, gender: 'female' },
        { word: 'chỉ', gloss: /^she; her$/, gender: 'female' },
      ],
      selfPlural: [chung('em'), tui_('em')],
      addresseePlural: [cac('chị')],
      thirdPlural: [cac('chị ấy')],
    },
    {
      id: 'younger',
      label: 'Someone younger',
      self: [
        { word: 'anh', gloss: /^I\/me, a male who's \(presumably\) slightly older than you/, speaker: 'male' },
        { word: 'chị', gloss: /^I\/me, a female who's \(presumably\) slightly older than you$/, speaker: 'female' },
      ],
      addressee: [
        { word: 'em', gloss: /^pronoun used to refer to younger person of the same generation$/ },
        { word: 'cậu', gloss: /^you, a male younger than me$/ },
        { word: 'cô', gloss: /^you, a female who's \(presumably\) slightly younger than me$/ },
      ],
      third: [ay('em'), { word: 'nó', gloss: /^he; him; she; her$/ }],
      selfPlural: [chung('anh', { speaker: 'male' }), chung('chị', { speaker: 'female' })],
      addresseePlural: [cac('em')],
      thirdPlural: [
        { word: 'chúng nó', gloss: /^they\/them$/ },
        { word: 'tụi nó', gloss: /^they\/them$/ },
      ],
    },
    {
      id: 'parent',
      respect: true,
      label: 'Your parents',
      self: [{ word: 'con', gloss: /^I\/me \(used by children when talking to their parents\)$/ }],
      addressee: [
        { word: 'ba', regions: ['Southern'], note: 'Southern "dad"; Wiktionary has no pronoun sense for it.' },
        { word: 'má', regions: ['Southern'], note: 'Southern "mom"; Wiktionary has no pronoun sense for it.' },
        { word: 'bố', gloss: /^you, my father$/ },
        { word: 'mẹ', gloss: /^you, my mother$/ },
        { word: 'thầy', gloss: /^you, my father$/ },
      ],
      third: [
        { word: 'ba', regions: ['Southern'], gender: 'male', note: 'Southern "dad", also for "he" about your father; no pronoun sense in Wiktionary.' },
        { word: 'má', regions: ['Southern'], gender: 'female', note: 'Southern "mom", also for "she" about your mother; no pronoun sense in Wiktionary.' },
        { word: 'bố', gloss: /^he\/him, your\/my father$/, gender: 'male' },
        { word: 'mẹ', gender: 'female', note: 'Also "she" about your mother; Wiktionary only defines it as "I" and "you".' },
      ],
      selfPlural: [chung('con'), tui_('con')],
    },
    {
      id: 'parents-age',
      respect: true,
      label: "An older adult (your parents' age)",
      self: [
        { word: 'cháu', gloss: /^I\/me, someone who's not your child and who's a lot younger than you$/ },
        { word: 'con', gloss: /^I\/me \(used when talking to someone significantly older than the speaker\)$/ },
      ],
      addressee: [
        { word: 'bác', gloss: /^you, someone who's presumably slightly older than one of my parents$/ },
        { word: 'chú', gloss: /^you, a man who's presumably slightly younger than my parents$/ },
        { word: 'cô', gloss: /^you, a woman who's \(presumably\) slightly younger than either of my parents$/ },
      ],
      third: [
        { word: 'bác', gloss: /^he\/him\/she\/her, someone who's presumably slightly older than one of my parents$/ },
        ay('chú', { gender: 'male' }),
        { word: 'cô ấy', gender: 'female', note: 'Wiktionary defines cô ấy only for a young woman; about a woman your parents\' age it\'s cô + ấy ("that").' },
      ],
      selfPlural: [chung('cháu', { regions: ['Northern'] }), chung('con', { regions: ['Central', 'Southern'] })],
      addresseePlural: [cac('bác'), cac('chú'), cac('cô')],
    },
    {
      id: 'grandparents-age',
      respect: true,
      label: "Someone your grandparents' age",
      self: [
        { word: 'cháu', gloss: /^I\/me, your nephew, niece or grandchild$/ },
        { word: 'con', gloss: /^I\/me \(used when talking to someone significantly older than the speaker\)$/ },
      ],
      addressee: [
        { word: 'ông', gloss: /^you, my grandfather$/ },
        { word: 'bà', gloss: /^you, my grandmother$/ },
      ],
      third: [
        { word: 'ông ấy', gloss: /^he \(older or respected man\)$/, gender: 'male' },
        { word: 'bà ấy', gloss: /^she \(woman of higher social status, e\.g\., older\)$/, gender: 'female' },
        { word: 'ổng', gloss: /^he; him \(older or respected man\)$/, gender: 'male' },
        { word: 'bả', gloss: /^she; her \(woman of higher social status\)$/, gender: 'female' },
      ],
      selfPlural: [chung('cháu', { regions: ['Northern'] }), chung('con', { regions: ['Central', 'Southern'] })],
      addresseePlural: [cac('ông'), cac('bà')],
    },
    {
      id: 'teacher',
      respect: true,
      label: 'Your teacher',
      self: [{ word: 'em', note: 'What students say; Wiktionary defines em as "you" for a child or student, but not as "I".' }],
      addressee: [
        { word: 'thầy', gloss: /^you, my male teacher$/ },
        { word: 'cô', gloss: /^you, my older female teacher$/ },
      ],
      third: [
        { word: 'thầy', gloss: /^he\/him, that male teacher we're talking about$/, gender: 'male' },
        { word: 'cô', gloss: /^she\/her, my\/your\/our female teacher$/, gender: 'female' },
      ],
      selfPlural: [chung('em')],
      addresseePlural: [cac('thầy'), cac('cô')],
    },
    {
      id: 'partner',
      label: 'Your partner',
      self: [
        { word: 'anh', gloss: /^I\/me, your boyfriend older than you$/, speaker: 'male' },
        { word: 'em', speaker: 'female', note: 'Wiktionary defines em as "you" for the woman in a relationship, but not as "I".' },
      ],
      addressee: [
        { word: 'em', gloss: /^pronoun used to refer to the girl or woman in a romantic relationship$/, speaker: 'male' },
        { word: 'anh', gloss: /^you, my boyfriend$/, speaker: 'female' },
        { word: 'mình', gloss: /^you \(used for one's spouse\)$/ },
      ],
      third: [
        { word: 'anh ấy', gloss: /^he \(man of equal or slightly greater social status\)$/, gender: 'male' },
        { word: 'cô ấy', gloss: /^she \(towards a young girl or woman\)$/, gender: 'female' },
        { word: 'hắn', gloss: /^he\/him, my boyfriend$/, gender: 'male' },
      ],
      selfPlural: [
        { word: 'chúng mình', gloss: /^we\/us \(inclusive\)$/, inclusive: true },
        { word: 'mình', gloss: /^we\/us$/, inclusive: true },
      ],
    },
    {
      id: 'formal',
      label: 'A stranger, formal, work',
      self: [{ word: 'tôi', gloss: /^I\/me \(used in formal contexts/ }],
      addressee: [
        { word: 'anh', gloss: /^you, a young adult man$/, gender: 'male' },
        { word: 'chị', gloss: /^you, a young-adult woman$/, gender: 'female' },
        { word: 'ông', gloss: /^you, a man about 40 or older$/, gender: 'male' },
        { word: 'bà', gloss: /^you, a woman about 40 or older$/, gender: 'female' },
      ],
      third: [
        { word: 'ông ấy', gloss: /^he \(older or respected man\)$/, gender: 'male' },
        { word: 'bà ấy', gloss: /^she \(woman of higher social status, e\.g\., older\)$/, gender: 'female' },
        { word: 'anh ấy', gloss: /^he \(man of equal or slightly greater social status\)$/, gender: 'male' },
        { word: 'chị ấy', gloss: /^she \(who is somewhat older than the speaker\)$/, gender: 'female' },
      ],
      selfPlural: [
        { word: 'chúng tôi', gloss: /^we\/us \(exclusive\)/, inclusive: false },
        { word: 'chúng ta', gloss: /^we\/us \(inclusive\)/, inclusive: true },
      ],
      addresseePlural: [{ word: 'quý vị', gloss: /^you$/ }, cac('anh chị')],
      thirdPlural: [{ word: 'họ', gloss: /^they\/them \(used in formal situations/ }],
    },
  ],
  // Hand-picked first choices for English meanings (see scripts/picks.ts), reviewed by the owner. Only
  // where a native speaker knows the natural word and the ranking puts another first.
  picks: [
    {
      word: 'get', pos: 'verb', gloss: /^To fetch, bring, take/, picks: ['lấy', 'mang'],
      note: 'The ranking gives "đưa" (to hand, to bring): its definition matches more of the English words, and no "lấy" sense says "fetch".',
    },
    {
      word: 'get', pos: 'verb', gloss: /^To obtain; to acquire/, picks: ['lấy'],
      note: '"được" is common mostly as a helper verb ("được đi"); "lấy" is the everyday word.',
    },
    // Small grammar words, for translating English words one by one (the checker's foreign-word check):
    // without a pick, "but" is "song" (literary) from its first-listed meaning "except".
    {
      word: 'but', pos: 'conj', gloss: /^However, although, nevertheless/, picks: ['nhưng'], first: true,
      note: 'The everyday "but"; Wiktionary\'s table for this meaning also says nhưng.',
    },
    {
      word: 'be', pos: 'verb', gloss: /^Used to declare the subject and object identical or equivalent/, picks: ['là'], first: true,
      note: '"is" on its own: "là" (X là Y), not the passive "bị" from its first-listed meaning.',
    },
    {
      word: 'very', pos: 'adv', gloss: /^To a great extent or degree/, picks: ['rất'], first: true,
      note: 'The neutral "very"; "quá" is closer to "so, too".',
    },
    {
      word: 'excited', pos: 'adj', gloss: /^Having great enthusiasm, passion and energy/, picks: ['hào hứng', 'háo hức', 'phấn khích', 'hứng khởi'],
      note: 'hào hứng is the everyday "excited about" (most common of these); háo hức is looking forward to something, phấn khích thrilled in the moment. The ranking put tích cực (active, proactive) first: its definition shares "great energy, enthusiasm".',
    },
    {
      word: 'of', pos: 'prep', gloss: /^Belonging to, existing in, or taking place in/, picks: ['của'], first: true,
      note: 'Possession ("the book of my friend": sách của bạn tôi); the first-listed meanings are distance and separation.',
    },
    // From the owner's review of the top 300 English words (reviews/vi-top300.json, review page in
    // ARCHITECTURE.md), applied 2026-10-05: 54 meanings.
    {
      word: "about", pos: "prep", gloss: /^Indicates that something will happen/, picks: ["sắp"],
      note: "\"about to\" = sắp",
    },
    {
      word: "can", pos: "verb", gloss: /^To know how to\./, picks: ["biết"],
      note: "\"can (know how to)\" = biết: \"tôi biết bơi\"",
    },
    {
      word: "can", pos: "verb", gloss: /^To be able to\./, picks: ["có thể", "được"],
      note: "\"be able to\" = có thể / được; biết is \"know how\"",
    },
    {
      word: "down", pos: "adv", gloss: /^To or towards what is considered the/, picks: ["xuống"],
      note: "\"down\" = xuống; xịu is \"sag (of a face)\"",
    },
    {
      word: "first", pos: "adv", gloss: /^For the first time\./, picks: ["lần đầu tiên", "lần đầu"],
    },
    {
      word: "first", pos: "adj", gloss: /^Preceding all others of a series or/, picks: ["đầu tiên", "thứ nhất"],
      note: "\"first\" = đầu tiên (everyday), thứ nhất (in a list)",
    },
    {
      word: "go", pos: "verb", gloss: /^To start; to begin \(an action or/, picks: ["bắt đầu"],
      note: "\"go (start)\" = bắt đầu; khởi is literary",
    },
    {
      word: "good", pos: "adj", gloss: /^Of a person or an animal:/, picks: ["tốt"],
      note: "\"a good person\" = người tốt; hay is \"interesting/good at\"",
    },
    {
      word: "here", pos: "noun", gloss: /^This place; this location\./, picks: ["ở đây", "chỗ này", { word: "ni", tags: ["Central"] }, "nơi này"],
    },
    {
      word: "how", pos: "adv", gloss: /^In what manner/, picks: ["như thế nào", { word: "thế nào", tags: ["Northern"] }, { word: "làm sao", tags: ["Southern"] }, { word: "sao", tags: ["Southern"] }, { word: "làm răng", tags: ["Central"] }],
      note: "\"how (in what way)\" = như thế nào. Northern speech says thế nào, Southern (làm) sao, Central làm răng.",
    },
    {
      word: "how", pos: "adv", gloss: /^To what degree or extent\./, picks: ["bao nhiêu", { word: "nhiêu", tags: ["Southern"] }, "mấy"],
    },
    {
      word: "just", pos: "adj", gloss: /^Morally right; upright, righteous,/, picks: ["công bằng"],
      note: "chính alone means \"main/proper\"; \"fair, just\" is công bằng",
    },
    {
      word: "know", pos: "verb", gloss: /^To be acquainted or familiar with; to/, picks: ["quen", "quen biết"],
      note: "\"know (someone)\" = quen / quen biết",
    },
    {
      word: "life", pos: "noun", gloss: /^The state of organisms preceding their/, picks: ["sự sống", "cuộc sống", "cuộc đời"],
    },
    {
      word: "life", pos: "noun", gloss: /^A living being; the fact of a/, picks: ["mạng", "mạng sống", "sinh mạng"],
    },
    {
      word: "life", pos: "noun", gloss: /^A biography\./, picks: ["cuộc đời"],
      note: "\"his life (story)\" = cuộc đời",
    },
    {
      word: "life", pos: "noun", gloss: /^Animation; spirit; vivacity\./, picks: ["sức sống"],
      note: "\"full of life\" = đầy sức sống",
    },
    {
      word: "like", pos: "verb", gloss: /^To prefer and maintain \(an action\) as a/, picks: ["thích"],
      note: "\"like doing\" (a habit) is thích; như means \"as/like (similar)\"",
    },
    {
      word: "like", pos: "verb", gloss: /^To want, desire\. See also would like\./, picks: ["muốn"],
      note: "\"would like\" = muốn; như is the comparison \"like\"",
    },
    {
      word: "long", pos: "adj", gloss: /^Not short; tall\./, picks: ["cao", "cao lớn"],
    },
    {
      word: "long", pos: "adj", gloss: /^Having great duration\./, picks: ["lâu", "dài"],
      note: "\"a long time\" = lâu",
    },
    {
      word: "more", pos: "pron", gloss: /^A greater number or quantity \(of/, picks: ["thêm", "nhiều hơn"],
      note: "\"more\" as a quantity: thêm, nhiều hơn; lượng means \"amount\"",
    },
    {
      word: "most", pos: "adv", gloss: /^To a great extent or degree; highly;/, picks: ["rất", "nhất"],
    },
    {
      word: "most", pos: "pron", gloss: /^The greater part of a group, especially/, picks: ["phần lớn", "hầu hết", "đa số"],
      note: "\"most (of them)\" = phần lớn / hầu hết",
    },
    {
      word: "much", pos: "adv", gloss: /^To a great extent\./, picks: ["nhiều", "lắm"],
      note: "\"much\" = nhiều / lắm; nhiều nhặn is negative-only",
    },
    {
      word: "never", pos: "adv", gloss: /^Not at any other time; not on any other/, picks: ["chưa bao giờ", "chưa từng"],
      note: "\"never (before)\" = chưa bao giờ",
    },
    {
      word: "new", pos: "adj", gloss: /^Current or later, as opposed to former\./, picks: ["mới"],
      note: "\"the new (current) one\" is still mới; tân is Sino-Vietnamese, formal",
    },
    {
      word: "new", pos: "adj", gloss: /^Newborn\./, picks: ["em bé sơ sinh", "sơ sinh"],
    },
    {
      word: "off", pos: "adj", gloss: /^Inoperative, disabled\./, picks: ["tắt"],
      note: "\"off (switched off)\" = tắt; the ranking gave tàn tật (\"disabled\")",
    },
    {
      word: "one", pos: "pron", gloss: /^Any person \(applying to people in/, picks: ["một người", "người ta", "ta"],
    },
    {
      word: "only", pos: "adv", gloss: /^Without others or anything further;/, picks: ["chỉ"],
      note: "\"only (just)\" = chỉ; the ranking gave không (\"not\")",
    },
    {
      word: "only", pos: "adj", gloss: /^Alone in a category\./, picks: ["duy nhất"],
      note: "\"the only one\" = duy nhất",
    },
    {
      word: "out", pos: "adv", gloss: /^Away from the inside or centre\./, picks: ["ra", "ra ngoài"],
      note: "\"out (away from inside)\" = ra / ra ngoài",
    },
    {
      word: "over", pos: "adj", gloss: /^Finished; ended; concluded\./, picks: ["xong", "hết"],
      note: "\"it's over\" = xong rồi / hết rồi; đủ means \"enough\"",
    },
    {
      word: "people", pos: "noun", gloss: /^A person's ancestors, relatives or/, picks: ["gia đình", "người nhà"],
      note: "\"my people\" (family) = gia đình / người nhà",
    },
    {
      word: "really", pos: "adv", gloss: /^In a way or manner that is real, not/, picks: ["thật sự", "thật sự là", "thực sự", "thực sự là", { word: "thiệt", tags: ["Southern"] }, { word: "thiệt là", tags: ["Southern"] }, "dữ"],
    },
    {
      word: "really", pos: "adv", gloss: /^Actually; in fact; in reality\./, picks: ["thật ra", "thực ra", { word: "thiệt ra", tags: ["Southern"] }],
      note: "\"really (in fact)\" = thật ra. Southern speech says thiệt ra.",
    },
    {
      word: "really", pos: "adv", gloss: /^Very \(modifying an adjective\); very/, picks: ["thật", "rất", "quá", { word: "thiệt", tags: ["Southern"] }],
      note: "\"really (very)\" good = thật / rất. Southern speech says thiệt (\"ngon thiệt\").",
    },
    {
      word: "see", pos: "verb", gloss: /^To perceive or detect someone or/, picks: ["thấy", "nhìn thấy"],
      note: "\"see\" = thấy; xem is \"watch/look at\"",
    },
    {
      word: "see", pos: "verb", gloss: /^To form a mental picture of, to/, picks: ["hình dung", "thấy", "tưởng tượng"],
    },
    {
      word: "some", pos: "pron", gloss: /^An indefinite quantity\./, picks: ["một ít", "một chút", "vài"],
    },
    {
      word: "still", pos: "adj", gloss: /^Uttering no sound; silent\./, picks: ["im lặng", "im"],
      note: "\"still (silent)\" = im lặng",
    },
    {
      word: "still", pos: "adj", gloss: /^Not moving; calm\./, picks: ["yên", "đứng yên"],
      note: "\"still (not moving)\" = yên / đứng yên",
    },
    {
      word: "there", pos: "noun", gloss: /^That place \(previously mentioned or/, picks: ["chỗ đó", "đó"],
      note: "\"there (that place)\" = chỗ đó",
    },
    {
      word: "think", pos: "verb", gloss: /^To conceive of something or someone/, picks: ["nghĩ", "thấy"],
      note: "\"I think (it's good)\" = tôi nghĩ / tôi thấy",
    },
    {
      word: "think", pos: "verb", gloss: /^To communicate to oneself in one's/, picks: ["suy nghĩ", "nghĩ"],
      note: "\"think (a problem through)\" = suy nghĩ",
    },
    {
      word: "think", pos: "verb", gloss: /^To have \(some statement\) in one's mind;/, picks: ["nghĩ"],
      note: "\"think (to oneself)\" = nghĩ",
    },
    {
      word: "think", pos: "verb", gloss: /^To ponder, to go over in one's mind\./, picks: ["suy nghĩ", "nghĩ", "liệu"],
    },
    {
      word: "time", pos: "noun", gloss: /^A duration of time\./, picks: ["thời gian", "khoảng thời gian"],
      note: "\"a duration of time\" is thời gian",
    },
    {
      word: "too", pos: "adv", gloss: /^To a high degree, very\./, picks: ["quá"],
      note: "\"too (much)\" = quá; quá thể is an intensified form",
    },
    {
      word: "way", pos: "noun", gloss: /^To do with a place or places\./, picks: ["đường"],
      note: "\"the way (route)\" = đường; ngả is a fork in the road",
    },
    {
      word: "well", pos: "adj", gloss: /^In good health\./, picks: ["khỏe", "mạnh khỏe"], exclude: ["mát mặt"],
    },
    {
      word: "why", pos: "adv", gloss: /^For what cause, reason, or purpose\./, picks: ["tại sao", "vì sao", "sao", { word: "răng", tags: ["Central"] }],
      note: "\"why\" = tại sao / vì sao. Central speech says răng (\"răng rứa?\").",
    },
    {
      word: "why", pos: "noun", gloss: /^Reason\./, picks: ["lý do", "lý lẽ"],
    },
  ],
}

export default config
