/*
 * score.js — measure a shadowing session against what the setting promised.
 *
 * The point: "the Orientation output feels too advanced" is not something you
 * can tune against. These metrics turn that feeling into numbers you can move.
 * They are deterministic — same session in, same score out — so a prompt
 * change that improves them improved them, rather than getting a lucky sample.
 *
 * What is measured, and why each one matters at Orientation:
 *
 *   readingGrade        Flesch–Kincaid grade level of the narration. The
 *                       advisor's "write for middle school vs undergraduate"
 *                       intuition, made checkable.
 *   ungloseedAcronyms   Acronyms used without being expanded or marked. "PO
 *                       number" is the exact failure that prompted this.
 *   lateDefinitions     A term used in plain text BEFORE the sentence that
 *                       marks and defines it. Definition must precede use.
 *   markedTerms         Count against the band the setting asked for.
 *   orphanMarks         [[marked]] with no glossary entry, or entries with no
 *                       mark — the protocol's own contract.
 *   longSentences       Sentences over 35 words: a good proxy for prose that
 *                       has stopped being introductory.
 *   jargonDefLeak       Definitions that themselves contain unexplained
 *                       acronyms — explaining jargon with jargon.
 *
 * Deliberately NOT measured here: whether the content is true, or whether the
 * persona is convincing. Those need a human, or the novice-reader judge in
 * run.js. This file only measures register and internal consistency.
 */

/* Acronyms a general audience reads without help. Everything else must earn
   its place by being expanded or marked. PM stays OFF this list on purpose —
   in a project-management posting it is exactly the kind of insider shorthand
   Orientation is supposed to unpack. */
const COMMON_ACRONYMS = new Set([
  "US", "USA", "UK", "OK", "AM", "PM_TIME", "TV", "CEO", "CFO", "COO", "ID",
  "FAQ", "PDF", "URL", "USB", "GPS", "DIY", "ASAP", "AI", "IT"
]);

/* Expected marked-term band per expertise index, mirroring lib/prompts.js. */
const TERM_BANDS = [[10, 16], [8, 12], [5, 8], [3, 6], [1, 3]];
/* Reading-grade ceiling per expertise index. Orientation should read like a
   capable ninth-grader's newspaper, not a trade journal. */
const GRADE_CEILING = [10, 12, 14, 16, 99];

/* ---------------- text utilities ---------------- */

function stripMarks(text) {
  return String(text).replace(/\[\[(.+?)\]\]/g, "$1");
}

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function words(text) {
  return String(text).match(/[A-Za-z][A-Za-z'’-]*/g) || [];
}

/** Syllable estimate — the standard heuristic; good enough for grade level. */
function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch–Kincaid grade level. */
function readingGrade(text) {
  const sents = sentences(text);
  const ws = words(text);
  if (!sents.length || !ws.length) return 0;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (ws.length / sents.length) + 11.8 * (syl / ws.length) - 15.59;
}

/* ---------------- individual checks ---------------- */

/**
 * Acronyms that appear in the narration without ever being expanded or marked.
 * Counts as glossed if: it is a marked term, or it has a glossary entry, or
 * the text expands it in parentheses either way round.
 */
function unglossedAcronyms(narration, terms) {
  const plain = stripMarks(narration);
  const marked = new Set(
    (String(narration).match(/\[\[(.+?)\]\]/g) || []).map((m) =>
      m.slice(2, -2).toUpperCase()
    )
  );
  const defined = new Set((terms || []).map((t) => String(t.term).toUpperCase()));
  /* An acronym also counts as covered when it sits inside a longer marked or
     defined term — "RAID" inside "[[RAID log]]" is not an unglossed acronym. */
  const covered = [...marked, ...defined];
  const found = new Map();

  for (const m of plain.matchAll(/\b([A-Z]{2,6})\b(?!\.)/g)) {
    const a = m[1];
    if (COMMON_ACRONYMS.has(a)) continue;
    if (marked.has(a) || defined.has(a)) continue;
    if (covered.some((c) => new RegExp(`\\b${a}\\b`).test(c))) continue;
    // "Project Management Professional (PMP)" or "PMP (Project Management Professional)"
    const around = plain.slice(Math.max(0, m.index - 90), m.index + 90 + a.length);
    const expandedAfter = new RegExp(`${a}\\s*\\(([^)]{6,})\\)`).test(around);
    const expandedBefore = new RegExp(`\\(\\s*${a}\\s*\\)`).test(around);
    if (expandedAfter || expandedBefore) continue;
    found.set(a, (found.get(a) || 0) + 1);
  }
  return [...found.entries()]
    .map(([acronym, count]) => ({ acronym, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Terms whose first plain-text appearance precedes the sentence that marks
 * them. Definition should arrive with, or before, first use.
 */
function lateDefinitions(narration) {
  const text = String(narration);
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(/\[\[(.+?)\]\]/g)) {
    const term = m[1];
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const before = stripMarks(text.slice(0, m.index));
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const earlier = new RegExp(`\\b${escaped}\\b`, "i").exec(before);
    if (earlier) {
      out.push({
        term,
        firstUseAt: earlier.index,
        definedAt: m.index,
        wordsEarly: words(before.slice(earlier.index)).length
      });
    }
  }
  return out;
}

/** Marks without glossary entries, and entries without marks. */
function orphans(narration, terms) {
  const marked = new Set(
    [...String(narration).matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1].toLowerCase())
  );
  const defined = new Set((terms || []).map((t) => String(t.term).toLowerCase()));
  return {
    markedButUndefined: [...marked].filter((t) => !defined.has(t)),
    definedButUnmarked: [...defined].filter((t) => !marked.has(t))
  };
}

/** Glossary definitions that lean on unexplained acronyms. */
function jargonInDefinitions(terms) {
  const out = [];
  for (const t of terms || []) {
    const hits = [
      ...String(t.definition || "").matchAll(/\b([A-Z]{2,6})\b/g)
    ]
      .map((m) => m[1])
      .filter((a) => !COMMON_ACRONYMS.has(a))
      .filter((a) => a.toUpperCase() !== String(t.term).toUpperCase())
      .filter((a) => !new RegExp(`${a}\\s*\\(`).test(t.definition));
    if (hits.length) out.push({ term: t.term, acronyms: [...new Set(hits)] });
  }
  return out;
}

/* ---------------- the scorecard ---------------- */

/**
 * Score one session.
 * @param {{persona:object, task:string, steps:Array, terms:Array}} session
 * @param {number} expertiseIdx
 */
function scoreSession(session, expertiseIdx = 0) {
  const steps = session.steps || [];
  const narration = steps.map((s) => s.body || "").join("\n\n");
  const plain = stripMarks(narration);
  const terms = session.terms || [];

  const grade = readingGrade(plain);
  const sents = sentences(plain);
  const long = sents.filter((s) => words(s).length > 35);
  const acronyms = unglossedAcronyms(narration, terms);
  const late = lateDefinitions(narration);
  const orph = orphans(narration, terms);
  const defJargon = jargonInDefinitions(terms);

  const band = TERM_BANDS[expertiseIdx] || TERM_BANDS[0];
  const ceiling = GRADE_CEILING[expertiseIdx] ?? 10;
  const markedCount = new Set(
    [...narration.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1].toLowerCase())
  ).size;

  const failures = [];
  if (grade > ceiling) failures.push(`reading grade ${grade.toFixed(1)} over ceiling ${ceiling}`);
  if (acronyms.length) failures.push(`${acronyms.length} unglossed acronym${acronyms.length > 1 ? "s" : ""}`);
  if (late.length) failures.push(`${late.length} term${late.length > 1 ? "s" : ""} used before defined`);
  if (markedCount < band[0]) failures.push(`only ${markedCount} terms marked, band is ${band[0]}–${band[1]}`);
  if (markedCount > band[1]) failures.push(`${markedCount} terms marked, band is ${band[0]}–${band[1]}`);
  if (orph.markedButUndefined.length) failures.push(`${orph.markedButUndefined.length} marked without a definition`);
  if (defJargon.length) failures.push(`${defJargon.length} definition${defJargon.length > 1 ? "s" : ""} explained with unexplained acronyms`);

  return {
    words: words(plain).length,
    steps: steps.length,
    readingGrade: Number(grade.toFixed(1)),
    gradeCeiling: ceiling,
    avgSentenceWords: sents.length ? Number((words(plain).length / sents.length).toFixed(1)) : 0,
    longSentences: long.length,
    markedTerms: markedCount,
    termBand: band,
    unglossedAcronyms: acronyms,
    lateDefinitions: late,
    orphans: orph,
    jargonInDefinitions: defJargon,
    failures,
    pass: failures.length === 0
  };
}

/** Mean of a numeric field across scorecards. */
function mean(cards, pick) {
  if (!cards.length) return 0;
  return Number((cards.reduce((n, c) => n + pick(c), 0) / cards.length).toFixed(1));
}

/** Aggregate several runs of the same setting into one summary. */
function summarize(cards) {
  const acr = {};
  for (const c of cards) for (const a of c.unglossedAcronyms) acr[a.acronym] = (acr[a.acronym] || 0) + a.count;
  return {
    runs: cards.length,
    passed: cards.filter((c) => c.pass).length,
    readingGrade: mean(cards, (c) => c.readingGrade),
    gradeRange: [
      Math.min(...cards.map((c) => c.readingGrade)),
      Math.max(...cards.map((c) => c.readingGrade))
    ],
    markedTerms: mean(cards, (c) => c.markedTerms),
    words: Math.round(mean(cards, (c) => c.words)),
    longSentences: mean(cards, (c) => c.longSentences),
    unglossedAcronymsPerRun: mean(cards, (c) => c.unglossedAcronyms.length),
    lateDefinitionsPerRun: mean(cards, (c) => c.lateDefinitions.length),
    worstAcronyms: Object.entries(acr).sort((a, b) => b[1] - a[1]).slice(0, 12)
  };
}

/** Human-readable report for one run set. */
function formatReport(label, cards, meta = {}) {
  const s = summarize(cards);
  const L = [];
  L.push(`## ${label}`);
  if (meta.setting) L.push(`setting: ${meta.setting}`);
  if (meta.task) L.push(`task: ${meta.task}`);
  L.push("");
  L.push(`passed cleanly       ${s.passed} of ${s.runs}`);
  L.push(`reading grade        ${s.readingGrade}  (range ${s.gradeRange[0]}–${s.gradeRange[1]}, ceiling ${cards[0].gradeCeiling})`);
  L.push(`marked terms         ${s.markedTerms}  (band ${cards[0].termBand[0]}–${cards[0].termBand[1]})`);
  L.push(`unglossed acronyms   ${s.unglossedAcronymsPerRun} per run`);
  L.push(`used-before-defined  ${s.lateDefinitionsPerRun} per run`);
  L.push(`long sentences       ${s.longSentences} per run  (over 35 words)`);
  L.push(`narration length     ${s.words} words`);
  if (s.worstAcronyms.length) {
    L.push("");
    L.push(`most common unglossed: ${s.worstAcronyms.map(([a, n]) => `${a}×${n}`).join(", ")}`);
  }
  const allFail = {};
  for (const c of cards) for (const f of c.failures) {
    const key = f.replace(/[\d.]+/g, "N");
    allFail[key] = (allFail[key] || 0) + 1;
  }
  const fails = Object.entries(allFail).sort((a, b) => b[1] - a[1]);
  if (fails.length) {
    L.push("");
    L.push("failures by kind:");
    for (const [f, n] of fails) L.push(`  ${n}/${cards.length}  ${f}`);
  }
  return L.join("\n");
}

/** Side-by-side of two run sets — the A/B you use when tuning a prompt. */
function formatComparison(aLabel, aCards, bLabel, bCards) {
  const a = summarize(aCards);
  const b = summarize(bCards);
  const row = (name, x, y, lowerIsBetter) => {
    const delta = Number((y - x).toFixed(1));
    const better = lowerIsBetter ? delta < 0 : delta > 0;
    /* Arrow shows which way the number moved; the word says whether that is
       good. They differ for metrics where more is better. */
    const arrow = delta === 0 ? "  →  " : delta < 0 ? "  ↓  " : "  ↑  ";
    return `${name.padEnd(22)}${String(x).padStart(7)}${arrow}${String(y).padStart(7)}   ${
      delta === 0 ? "unchanged" : better ? "better" : "worse"
    }`;
  };
  return [
    `## ${aLabel}  →  ${bLabel}`,
    "",
    `${"".padEnd(22)}${aLabel.slice(0, 7).padStart(7)}     ${bLabel.slice(0, 7).padStart(7)}`,
    row("reading grade", a.readingGrade, b.readingGrade, true),
    row("unglossed acronyms", a.unglossedAcronymsPerRun, b.unglossedAcronymsPerRun, true),
    row("used-before-defined", a.lateDefinitionsPerRun, b.lateDefinitionsPerRun, true),
    row("long sentences", a.longSentences, b.longSentences, true),
    row("marked terms", a.markedTerms, b.markedTerms, false),
    row("clean runs", a.passed, b.passed, false)
  ].join("\n");
}

module.exports = {
  scoreSession,
  summarize,
  formatReport,
  formatComparison,
  readingGrade,
  unglossedAcronyms,
  lateDefinitions,
  stripMarks,
  TERM_BANDS,
  GRADE_CEILING
};

/* ---------------- CLI: score saved runs ---------------- */

if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.log("usage: node eval/score.js <runs-dir> [<other-runs-dir> to compare]");
    process.exit(1);
  }
  const load = (dir) => {
    const files = fs.readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort();
    const sessions = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    const meta = sessions[0] || {};
    return {
      label: path.basename(dir),
      cards: sessions.map((s) => scoreSession(s, s.expertise ?? 0)),
      meta: { setting: meta.setting, task: meta.task }
    };
  };
  const sets = dirs.map(load);
  for (const s of sets) console.log(formatReport(s.label, s.cards, s.meta) + "\n");
  if (sets.length === 2) {
    console.log(formatComparison(sets[0].label, sets[0].cards, sets[1].label, sets[1].cards));
  }
}
