/*
 * server.js — plumbing. Serves the static frontend, fetches postings,
 * and relays the model's NDJSON stream to the browser as SSE events.
 * The interesting decisions live in lib/prompts.js and lib/taxonomy.js.
 */

const fs = require("fs");
const path = require("path");
// Read .env if present, else env.txt — the latter is easier to edit on Windows.
const envPath = fs.existsSync(path.join(__dirname, ".env"))
  ? path.join(__dirname, ".env")
  : path.join(__dirname, "env.txt");
require("dotenv").config({ path: envPath });
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const { KINDS, normalizeKind } = require("./lib/taxonomy");
const { resolveLink } = require("./lib/links");
const {
  EXPERTISE,
  MODES,
  buildSystemPrompt,
  buildUserMessage,
  buildFollowupSystem
} = require("./lib/prompts");
const { resolveJob } = require("./lib/linkedin");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || "claude-sonnet-4-5";
const keyLooksSet = () => {
  const k = process.env.ANTHROPIC_API_KEY || "";
  return k.startsWith("sk-ant-") && !k.includes("paste-your-key");
};

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- meta: taxonomy + knob copy for the client ---------------- */

app.get("/api/meta", (_req, res) => {
  res.json({
    kinds: KINDS,
    expertise: EXPERTISE.map((e) => e.name),
    modes: MODES.map((m) => m.name),
    model: MODEL,
    keySet: keyLooksSet()
  });
});

/* ---------------- fixtures ---------------- */

const FIXTURE_DIR = path.join(__dirname, "fixtures");

app.get("/api/fixtures", (_req, res) => {
  const out = [];
  for (const f of fs.readdirSync(FIXTURE_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8"));
      out.push({ id: j.id, title: j.title, company: j.company, field: j.field });
    } catch { /* skip broken fixture */ }
  }
  res.json(out);
});

app.get("/api/fixtures/:id", (req, res) => {
  const safe = String(req.params.id).replace(/[^a-z0-9-]/gi, "");
  const p = path.join(FIXTURE_DIR, `${safe}.json`);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "No such fixture." });
  res.json(JSON.parse(fs.readFileSync(p, "utf8")));
});

/* ---------------- LinkedIn ingestion ---------------- */

app.get("/api/job", async (req, res) => {
  try {
    const job = await resolveJob(req.query.url || "");
    res.json(job);
  } catch (e) {
    res.status(e.code === "BAD_URL" ? 400 : 502).json({
      error: e.message,
      attempts: e.attempts || []
    });
  }
});

/* ---------------- SSE helpers ---------------- */

function openSSE(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}
function send(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/*
 * The model emits NDJSON (one JSON object per line). We buffer the text
 * stream, cut it at newlines, and forward each parsed object as an SSE
 * event — so the client renders persona/task/steps/terms the moment each
 * completes, and never sees a torn line.
 */
function makeLineRelay(res, state) {
  let buf = "";
  const handleLine = (line) => {
    const t = line.trim();
    if (!t || t.startsWith("```")) return;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      console.warn("unparseable model line:", t.slice(0, 120));
      return;
    }
    if (obj.type === "term") {
      const given = obj.kind;
      obj.kind = normalizeKind(given);
      if (obj.kind === null) console.warn(`kind dropped (not in taxonomy): "${given}" on term "${obj.term}"`);
      const { url, linkSource } = resolveLink(obj.term, obj.sourceUrl);
      obj.url = url;
      obj.linkSource = linkSource;
      delete obj.sourceUrl; // client only ever sees vetted URLs
    }
    if (state) state.raw += t + "\n";
    send(res, obj);
  };
  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    },
    flush() {
      if (buf.trim()) handleLine(buf);
      buf = "";
    }
  };
}

async function relayModelStream(res, { system, messages }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const state = { raw: "" };
  const relay = makeLineRelay(res, state);
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.6,
    system,
    messages
  });
  stream.on("text", (t) => relay.push(t));
  await stream.finalMessage();
  relay.flush();
  send(res, { type: "raw", raw: state.raw }); // client keeps this for follow-up history
  send(res, { type: "done" });
  res.end();
}

function guardKey(res) {
  if (keyLooksSet()) return true;
  openSSE(res);
  send(res, {
    type: "error",
    message:
      "No API key is set on the server. Copy .env.example to .env, paste your ANTHROPIC_API_KEY, and restart with npm start."
  });
  res.end();
  return false;
}

/* ---------------- the session ---------------- */

app.post("/api/shadow", async (req, res) => {
  const { job, expertise = 0, mode = 0 } = req.body || {};
  if (!job || !job.description || String(job.description).trim().length < 40) {
    return res.status(400).json({ error: "No posting to work from — fetch a URL, paste a description, or load a fixture first." });
  }
  if (!guardKey(res)) return;
  openSSE(res);
  try {
    await relayModelStream(res, {
      system: buildSystemPrompt(expertise, mode),
      messages: [{ role: "user", content: buildUserMessage(job) }]
    });
  } catch (e) {
    console.error("shadow error:", e.message);
    send(res, { type: "error", message: `Generation failed: ${e.message}` });
    res.end();
  }
});

/* ---------------- follow-ups (asides, checkpoints, dialogue, seminar) ---------------- */

app.post("/api/followup", async (req, res) => {
  const { job, expertise = 0, mode = 0, transcript = [], question, context } = req.body || {};
  if (!question || !job) return res.status(400).json({ error: "Missing question or job." });
  if (!guardKey(res)) return;
  openSSE(res);

  // Conversation: posting → session raw NDJSON → prior Q/A raw → new question.
  const messages = [{ role: "user", content: buildUserMessage(job) }];
  for (const turn of transcript) {
    if (turn && (turn.role === "user" || turn.role === "assistant") && turn.content) {
      messages.push({ role: turn.role, content: String(turn.content) });
    }
  }
  const ctxLine = context ? `\n(Context: ${context})` : "";
  messages.push({ role: "user", content: `${question}${ctxLine}` });

  try {
    await relayModelStream(res, {
      system: buildFollowupSystem(expertise, mode),
      messages
    });
  } catch (e) {
    console.error("followup error:", e.message);
    send(res, { type: "error", message: `Generation failed: ${e.message}` });
    res.end();
  }
});

/* --open (used by the one-click launcher) pops the browser once the server
   is actually listening. If another copy is already running, don't crash —
   just open the browser at the running copy and exit. */
const wantOpen = process.argv.includes("--open");
const URL_ = `http://localhost:${PORT}`;

function openBrowser(url) {
  const { exec } = require("child_process");
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => {});
}

function listen() {
  const httpServer = app.listen(PORT, () => {
    console.log(`Understudy running at ${URL_}`);
    console.log(`  model: ${MODEL}   key set: ${keyLooksSet() ? "yes" : "NO — live generation disabled"}`);
    console.log(`  Keep this window open while you use the app; closing it stops Understudy.`);
    if (wantOpen) openBrowser(URL_);
  });

  httpServer.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.log(`Understudy is already running in another window — opening ${URL_} in your browser.`);
      if (wantOpen) openBrowser(URL_);
      setTimeout(() => process.exit(0), 1500);
    } else {
      throw e;
    }
  });
}

/* On first run with no key, ask for one in the console before starting. */
const { ensureKey } = require("./lib/setup");
ensureKey(keyLooksSet).then(listen);
