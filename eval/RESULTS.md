# Tuning log — Orientation · Lecture

The advisor's question was "how will you know when it's good?" This is the
answer: the same posting, the same task, three runs per version, scored the
same way each time.

**Fixed conditions.** Posting: the retail project-manager fixture. Task:
"Build a RAID log for a project that has just been approved, working through
risks, assumptions, issues and dependencies in turn." Settings: Orientation ·
Lecture. Three runs per version, since the model is not deterministic and one
sample proves nothing.

Reproduce any row with `npm run eval -- --label <name> --n 3 --judge`.

## Results

| | baseline | v2 | v3 |
|---|---|---|---|
| reading grade (ceiling 10) | 12.3 | 11.4 | **9.9** |
| unglossed acronyms per run | 4.7 | 4.0 | **1.3** |
| marked terms (band 10–16) | 5.7 | 9.3 | **8.3** |
| long sentences per run | 8.7 | 7.0 | **5.7** |
| used-before-defined per run | 1.0 | 2.0 | 1.0 |
| novice-reader blockers | 54 | 52 | **29** |

Reading grade fell from second-year-college to ninth grade. Unglossed
acronyms fell by roughly three quarters. Blockers found by a model reading as
a genuine novice roughly halved.

## What each change did

**baseline.** The prompt asked for no background to be assumed, and the model
agreed in principle while writing "pull the PO number from the PMO's RAID log
template." One run of three marked zero terms at all.

**v2 — naming the conflict.** The core prompt tells the persona to stay
concrete: real quantities, real artifacts, real shorthand. The Orientation
block tells it to unpack jargon. Nothing said which wins, and concreteness won
every time. v2 added an explicit precedence rule, a register anchor (a good
newspaper explainer, roughly ninth-grade), a hard acronym rule, and a sentence
length target.

Marking improved sharply (5.7 → 9.3). Acronyms barely moved (4.7 → 4.0).

**v3 — closing the two escape hatches.** Reading the v2 failures showed why
the acronym rule failed: the model treated *marking* a term as satisfying it,
and quietly skipped acronyms it judged too minor to mark. So v3 removed the
option: every acronym must be marked and defined, written out in plain words,
or not used — "the project office" rather than PMO, "the warehouse" rather
than DC.

The second fix came from the novice reader's blocker list, which kept flagging
*planogram*, *fixture*, *endcap* — never the certifications. The model was
unpacking the impressive vocabulary and skipping the mundane vocabulary, which
is exactly backwards: a general reader has heard of a certification and has
never heard of a planogram. v3 tells it to reverse that instinct explicitly.

## What is still wrong

- **Marked terms sit at 8.3 against a band of 10–16.** Two runs of three fall
  short. The instruction states the number; the model doesn't hold itself to
  it.
- **No run passes every check.** The gate is strict on purpose — one late
  definition fails a run.
- **Used-before-defined hasn't moved.** A term gets introduced casually in one
  step and marked in the next.
- **Domain nouns still slip through.** *Planogram* and *charter* were still
  flagged in v3, less often.
- Only one posting and one task have been tuned against. Whether these gains
  transfer to the clinical and trade postings is untested — `--fixture
  icu-nurse` and `--fixture electrician` will say.

## A caveat about the two kinds of measurement

The deterministic metrics are reproducible: the same session scores the same
every time, so a change that moves them moved them. They can only see
register and internal consistency — never whether the content is true or the
persona convincing.

The novice-reader judge is a second model read, and it varies between runs.
Treat its blocker list as a reading that tells you *where* to look, not a
measurement. It earns its place because it catches what no regular expression
can: "this sentence assumes I know how procurement works."
