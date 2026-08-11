/*
 * setup.js — first-run key setup.
 *
 * If no API key is configured and we're attached to a real console (which we
 * are when launched from Start Understudy.bat), ask for one right there,
 * verify it against the API, and save it to env.txt. Runs once; every launch
 * after that finds the saved key and skips straight to starting the server.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ENV_TXT = path.join(__dirname, "..", "env.txt");

function keyLooksValid(k) {
  return typeof k === "string" && /^sk-ant-api\d{2}-/.test(k.trim());
}

/** Strip quotes, whitespace, and a pasted "ANTHROPIC_API_KEY=" prefix. */
function clean(raw) {
  return String(raw || "")
    .trim()
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** One cheap round-trip to confirm the key actually works. */
async function verifyKey(key) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": key
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-4-5",
        max_tokens: 4,
        messages: [{ role: "user", content: "hi" }]
      })
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    const msg = (body.error && body.error.message) || `HTTP ${res.status}`;
    if (res.status === 401)
      return { ok: false, why: "That key was rejected as invalid. Check you copied the whole thing." };
    if (res.status === 400 && /credit balance/i.test(msg))
      return { ok: false, why: "The key is valid, but the account has no credit. Add credit at console.anthropic.com → Billing, then try again." };
    return { ok: false, why: msg };
  } catch (e) {
    return { ok: false, why: `Couldn't reach the API (${e.message}). Check your internet connection.` };
  }
}

function saveKey(key) {
  fs.writeFileSync(ENV_TXT, `ANTHROPIC_API_KEY=${key}\n`, "utf8");
}

const BANNER = `
==================================================================
  Understudy — first-time setup
==================================================================

  This app needs an Anthropic API key to generate sessions. You
  only have to do this once; it gets saved for next time.

  To get one:
    1. Go to  https://console.anthropic.com
    2. Sign in (this is the developer console — a separate account
       from claude.ai, though the same email works)
    3. Add a few dollars of credit under Billing
    4. API keys  ->  Create key  ->  copy it

  The key starts with  sk-ant-api03-

  Paste it below and press Enter. (In this window, paste with a
  right-click or Ctrl+V. The key will be visible as you paste —
  that's normal, and it's only stored on this computer.)

  Or just press Enter to skip: the app still runs, the saved
  postings and interface all work, but generating a session will
  tell you the key is missing.

`;

/**
 * Ensure a key is present. Returns true if one is configured (already or
 * after prompting), false if running without one.
 */
async function ensureKey(keyIsSet) {
  if (keyIsSet()) return true;

  // No console attached (background launch, CI, etc.) — don't hang waiting.
  if (!process.stdin.isTTY) return false;

  process.stdout.write(BANNER);

  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = clean(await ask("  Paste your API key here: "));

    if (!answer) {
      process.stdout.write("\n  Skipped — starting without a key.\n\n");
      return false;
    }
    if (answer.startsWith("sk-ant-sid")) {
      process.stdout.write(
        "\n  That's a claude.ai login token, not an API key. API keys come\n" +
        "  from console.anthropic.com and start with sk-ant-api03-\n\n"
      );
      continue;
    }
    if (!keyLooksValid(answer)) {
      process.stdout.write("\n  That doesn't look like an API key — it should start with sk-ant-api03-\n\n");
      continue;
    }

    process.stdout.write("  Checking the key...");
    const result = await verifyKey(answer);
    if (result.ok) {
      saveKey(answer);
      process.env.ANTHROPIC_API_KEY = answer;
      process.stdout.write(" it works. Saved to env.txt — you won't be asked again.\n\n");
      return true;
    }
    process.stdout.write(`\n\n  ${result.why}\n\n`);
  }

  process.stdout.write("  Starting without a key. To set one later, delete env.txt and launch again.\n\n");
  return false;
}

module.exports = { ensureKey, keyLooksValid };
