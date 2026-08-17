/*
 * run.js — run the same session N times and score it.
 *
 * Why N: the model is not deterministic. One sample cannot tell you whether a
 * prompt change helped or whether you got a lucky draw. Three to five runs of
 * the same posting, same task, same settings gives you a floor to compare
 * against.
 *
 * Usage
 *   node eval/run.js --label baseline
 *   node eval/run.js --label v2 --n 5 --task "Build a RAID matrix for a newly approved project"
 *   node eval/run.js --label nurse --fixture icu-nurse --expertise 0 --mode 0
 *   node eval/run.js --label v2 --judge          (adds the novice-reader check)
 *
 * Then compare two sets:
 *   node eval/score.js eval/runs/baseline eval/runs/v2
 *
 * Runs are written to eval/runs/<label>/ as run-01.json … plus report.md.
 * Nothing here touches the server; it calls the same prompt builders the app
 * does, so what you measure is what the app produces.
 */

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const envPath = fs.existsSync(path.join(ROOT, ".env"))
  ? path.join(ROOT, ".env")
  : path.join(ROOT, "env.txt");
require("dotenv").config({ path: envPath });

const Anthropic = require("@anthropic-ai/sdk");
const { EXPERTISE, MODES, buildSystemPrompt, buildUserMessage } = require("../lib/prompts");
const { normalizeKind } = require("../lib/taxonomy");
const { scoreSession, formatReport } = require("./score");

/* The default benchmark task: standardised, unglamorous, and identical every
   run, so differences in output come from the prompt and not the task. */
const DEFAULT_TASK =
  "Build a RAID log for a project that has just been approved, working through risks, assumptions, issues and dependencies in turn.";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const OPTS = {
  label: String(arg("label", "run")),
  fixture: String(arg("fixture", "project-manager")),
  expertise: Number(arg("expertise", 0)),
  mode: Number(arg("mode", 0)),
  n: Number(arg("n", 3)),
  task: arg("task", DEFAULT_TASK),
  judge: arg("judge", false) === true,
  model: process.env.MODEL || "claude-sonnet-4-5"
};

/* ---------------- one session ---------------- */

function parseNdjson(text) {
  const out = { persona: null, task: null, steps: [], terms: [] };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("```")) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    if (obj.type === "persona") out.persona = obj;
    else if (obj.type === "task") out.task = obj.task;
    else if (obj.type === "step") out.steps.push({ label: obj.label, body: obj.body });
    else if (obj.type === "term") {
      out.terms.push({
        term: obj.term,
        kind: normalizeKind(obj.kind),
        rawKind: obj.kind,
        definition: obj.definition
      });
    }
  }
  return out;
}

async function runOnce(client, job) {
  const msg = await client.messages.create({
    model: OPTS.model,
    max_tokens: 4096,
    temperature: 0.6,
    system: buildSystemPrompt(OPTS.expertise, OPTS.mode, { task: OPTS.task || null }),
    messages: [{ role: "user", content: buildUserMessage(job) }]
  });
  const text = (msg.content || []).map((c) => c.text || "").join("");
  return { raw: text, ...parseNdjson(text) };
}

/* ---------------- optional novice-reader judge ----------------
   The deterministic metrics catch register and consistency. They cannot catch
   "this sentence assumes I know how procurement works." A second model read,
   playing a genuine novice, can. Kept optional and reported separately,
   because it introduces its own variance — treat it as a reading, not a
   measurement. */

const JUDGE_SYSTEM = `You are a careful adult reader with no background whatsoever in the field being described — no training, no jargon, no industry experience. You are reading a walkthrough that claims to assume no background at all.

You are shown the narration, and after it, the glossary that appears beside it on screen. Terms in that glossary ARE explained to you — do not flag them as unexplained, though you may flag a glossary entry whose explanation itself defeated you.

Go through the narration and find every place the no-background promise breaks: a term used as if you'd know it and absent from the glossary, an acronym never spelled out, a step whose purpose isn't explained, a sentence you had to reread. Be exacting but fair — flag what genuinely stopped you, not everything merely unfamiliar.

Output ONE JSON object, no prose, no code fences:
{"blockers":[{"quote":"the exact phrase that stopped you","why":"what you couldn't follow"}],"verdict":"one sentence: could a total beginner follow this?"}`;

async function judge(client, session) {
  const narration = session.steps.map((s) => `${s.label}\n${s.body}`).join("\n\n");
  /* Judge what the reader actually sees: narration plus the glossary rail. */
  const glossary = (session.terms || [])
    .map((t) => `- ${t.term} (${t.kind || "term"}): ${t.definition || ""}`)
    .join("\n");
  const content =
    `NARRATION\n${narration.replace(/\[\[(.+?)\]\]/g, "$1")}\n\n` +
    `GLOSSARY SHOWN BESIDE IT\n${glossary || "(empty)"}`;
  const msg = await client.messages.create({
    model: OPTS.model,
    max_tokens: 1500,
    temperature: 0.2,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content }]
  });
  const text = (msg.content || []).map((c) => c.text || "").join("").trim();
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { blockers: [], verdict: "(judge output did not parse)" };
  }
}

/* ---------------- main ---------------- */

(async () => {
  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key.startsWith("sk-ant-")) {
    console.error("No API key found. Put it in env.txt or .env first.");
    process.exit(1);
  }

  const fixturePath = path.join(ROOT, "fixtures", `${OPTS.fixture}.json`);
  if (!fs.existsSync(fixturePath)) {
    console.error(`No fixture named "${OPTS.fixture}". Available: ` +
      fs.readdirSync(path.join(ROOT, "fixtures")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")).join(", "));
    process.exit(1);
  }
  const job = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  const outDir = path.join(__dirname, "runs", OPTS.label);
  fs.mkdirSync(outDir, { recursive: true });

  const setting = `${EXPERTISE[OPTS.expertise].name} · ${MODES[OPTS.mode].name}`;
  console.log(`\n${OPTS.label}: ${OPTS.n} run(s) of ${OPTS.fixture} at ${setting}`);
  console.log(`task: ${OPTS.task === true ? "(model's choice)" : OPTS.task}\n`);

  const client = new Anthropic({ apiKey: key });
  const cards = [];

  for (let i = 1; i <= OPTS.n; i++) {
    process.stdout.write(`  run ${i}/${OPTS.n} … `);
    let session;
    try {
      session = await runOnce(client, job);
    } catch (e) {
      console.log(`failed (${e.message})`);
      continue;
    }
    if (!session.steps.length) {
      console.log("no steps parsed — skipping");
      continue;
    }
    const card = scoreSession(session, OPTS.expertise);
    if (OPTS.judge) {
      process.stdout.write("judging … ");
      session.judge = await judge(client, session);
    }
    const record = {
      label: OPTS.label,
      fixture: OPTS.fixture,
      setting,
      expertise: OPTS.expertise,
      mode: OPTS.mode,
      task: OPTS.task === true ? null : OPTS.task,
      model: OPTS.model,
      persona: session.persona,
      taskStated: session.task,
      steps: session.steps,
      terms: session.terms,
      judge: session.judge || null,
      score: card
    };
    fs.writeFileSync(
      path.join(outDir, `run-${String(i).padStart(2, "0")}.json`),
      JSON.stringify(record, null, 2)
    );
    cards.push(card);
    console.log(
      `grade ${card.readingGrade}, ${card.markedTerms} terms, ` +
      `${card.unglossedAcronyms.length} unglossed${card.pass ? "  ✓" : ""}`
    );
  }

  if (!cards.length) {
    console.error("\nNo runs succeeded.");
    process.exit(1);
  }

  const report = formatReport(OPTS.label, cards, {
    setting,
    task: OPTS.task === true ? "(model's choice)" : OPTS.task
  });
  fs.writeFileSync(path.join(outDir, "report.md"), report + "\n");
  console.log("\n" + report);

  if (OPTS.judge) {
    const all = [];
    for (const f of fs.readdirSync(outDir).filter((f) => /^run-\d+\.json$/.test(f))) {
      const r = JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8"));
      for (const b of r.judge?.blockers || []) all.push(b);
    }
    console.log(`\nnovice reader flagged ${all.length} blocker(s) across ${cards.length} run(s):`);
    for (const b of all.slice(0, 12)) console.log(`  "${b.quote}" — ${b.why}`);
  }

  console.log(`\nsaved to eval/runs/${OPTS.label}/`);
})();
