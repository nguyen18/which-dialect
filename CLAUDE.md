# which-dialect

Read `ARCHITECTURE.md` first (the project's deep-dive doc; keep it updated after major changes). It covers
the design, and its "Working conventions" include the owner's rules: design every feature to scale to
more languages, and no LLM features. Known gaps and ideas go in `FUTURE_IMPROVEMENTS.md`, not fixed unasked.

## Another session may be working here

The owner sometimes runs several Claude sessions on this repo. Check `git log`, `git branch --show-current`
and `git status` before changing anything, and use a worktree off `origin/main` when the checkout is busy.

## Scale to more languages

Vietnamese and English are the first of many languages behind one import (English is the bridge). Before
building: does a language without the feature still work (graceful fallback)? Is per-language work in
`languages/<lang>.ts` and that language's data package, not the API or pair-specific code? Does the work
grow with the number of languages, not pairs? Is it measured per language? Say how a proposal scales when
presenting it. Rules that only hold for one language's data go in its config or behind a language check,
with a comment.

Also: keep repo and package descriptions language-general ("starting with Vietnamese"), and senses
without a region tag count as every region (`regionTagged: false`).

## Publish after every merge to main

Every merge to `main` is followed by publishing the npm packages, without waiting to be asked (this repo
only), so npm and jsDelivr always match `main`.

- npm won't republish a version, so **bump versions in the same branch as the change**: `which-dialect`
  when `packages/core` changed; a data package (`which-dialect-vi`, `which-dialect-en`) when its built
  data changed (rebuilds, build-script or config changes), with a patch bump (0.1.x) so it stays within
  the API's `DATA_VERSION` (`'0.1'`). If the data format changes, bump `DATA_VERSION` and the data minor
  version together. Don't publish a package whose contents didn't change, and only packages that exist
  in the repo (Spanish was removed).
- Before publishing: rebuild changed languages (English first; Vietnamese uses it), then `npm test`,
  `npm run typecheck` and `npm run evaluate` on the built data. Data packages first, then the API.
- The npm account (nguyen18) has **2FA**: don't publish from Claude Code's shell or the `!` prompt
  (instant `EOTP`; `--otp` codes expire before the upload). Give the owner the exact commands
  (`cd ~/dev/which-dialect && npm publish -w <pkg> --access public`) to run in their own terminal. If
  `npm whoami` fails, ask them to run `npm login` there.
- Afterwards, check the versions on npm and that jsDelivr serves the data, and update "Publishing" in
  `ARCHITECTURE.md`.

## Reviewing a language's words

Use the project skill `/word-review <language> [N] [apply]` (`.claude/skills/word-review/SKILL.md`): it
drafts better first-choice words for the top N English words and publishes a spreadsheet-style review
page (a claude.ai Artifact) where the owner keeps, accepts, edits, reorders or removes words; `apply`
turns the saved decisions into picks. The Vietnamese top-300 review is
https://claude.ai/artifact/FyCtuaGTW73qtZKcETKx75. The page's must-haves (labelled Current/Suggested lines,
Keep current then Use suggestion, an example sentence per suggestion, definitions on hover or tap, the
draggable Order line, the Apply button) are listed in the skill.
