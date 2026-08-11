# Understudy

Paste a real job posting. An AI plays a professional who holds that job, picks a
routine task from the role, and works through it while narrating out loud —
naming the formal training, certifications, standards, and vocabulary behind
each move. Closer to job shadowing than tutoring.

## Setup and run

You need two things: Node.js and an Anthropic API key.

**1. Install Node.js 18 or newer** — the free LTS installer at
[nodejs.org](https://nodejs.org). Accept the defaults.

**2. Get an API key** — sign in at
[console.anthropic.com](https://console.anthropic.com) (the developer
console; a separate account from claude.ai, though the same email works),
add a few dollars of credit under Billing, then API keys → Create key. It
starts with `sk-ant-api03-`. A typical session costs a few cents.

**3. Start the app.**

- **Windows:** double-click **`Start Understudy.bat`**.
- **Mac / Linux:** run `npm install` then `npm start` in this folder.

The first launch installs dependencies, then asks you to paste your API key
right in the window. It checks the key works, saves it to `env.txt`, and
never asks again. Then your browser opens to the app.

Keep that window open while you use Understudy — closing it stops the app.

No key is included in this repository, by design. You can also press Enter to
skip: the interface, the saved postings, and the preview all still work, and
generating a session tells you the key is missing. To change keys later,
edit `env.txt` — or delete it and launch again to be asked afresh.

## Using it

1. **The posting** — three ways in, all first-class:
   - a LinkedIn job URL (any shape: `/jobs/view/…`, `…?currentJobId=…`, or a bare ID) + "Read posting",
   - **Paste description** — paste the posting text directly,
   - a saved posting from `fixtures/` (retail PM, ICU nurse, journeyman electrician) — no network needed.
2. **The two knobs** — Expertise (who the listener is) and Interaction mode
   (what kind of room it is). Lecture disables questions; Asides queues them
   for the end; Checkpoints pauses after each step; Dialogue and Seminar are
   live conversation.
3. **Begin shadowing.** Terms of art appear with a dotted underline — click one
   to jump to its glossary entry; click a kind label (Artifact, Credential…)
   to see the house definition of that category. Moving a knob after a session
   offers a re-run rather than silently invalidating what's on screen.

## Where things live

- `lib/prompts.js` — **the product.** The core system prompt, the five
  expertise blocks, the five interaction blocks, and the follow-up prompts.
  Iterate here; restart the server (`Ctrl-C`, `npm start`) to pick up edits.
- `lib/taxonomy.js` — the closed kind vocabulary (12 kinds), house
  definitions, the one-line tests, and the alias map that absorbs model
  drift. The server refuses invented kinds.
- `lib/links.js` — link policy: hardcoded official map → model-suggested
  domain (truncated to origin, allowlisted hosts only) → Wikipedia search.
  The model is never allowed to put a deep link on screen.
- `lib/linkedin.js` — ingestion chain: cache → public page (`ld+json`) →
  guest API fragment → honest error.
- `server.js` — Express plumbing and the NDJSON→SSE relay.
- `public/` — the approved mockup, made live.

## Honest limitations

- **LinkedIn blocks scrapers.** Fetching postings is against LinkedIn's Terms
  of Service; this is an academic prototype and the fetcher exists to study
  ingestion — the paste path and fixtures are the supported inputs. Expect
  status 999 (bot detection) from cloud/datacenter IPs; a home connection
  works more often. Every successful fetch is cached to `cache/{jobId}.json`
  and served from cache first, so a posting fetched once keeps working —
  demo insurance.
- The fixtures are **hand-written realistic postings**, not scraped ones.
- Sessions are generated. The narration is illustration of how a role thinks,
  not a factual claim about any employer.
- The API key lives in `env.txt` (or `.env`), server-side only, and is never
  sent to the browser. Both are gitignored; don't commit either.
- **Not locked to Claude.** The prompt architecture in `lib/prompts.js` is
  plain structured English with nothing model-specific in it. Only the ~15
  lines in `server.js` that call the Anthropic SDK would change to run this
  against another provider.

## Config

`env.txt` / `.env` accept `ANTHROPIC_API_KEY` (required), `MODEL` (default
`claude-sonnet-4-5`), and `PORT` (default 3000).

---

Academic prototype, built as part of an independent study. Not affiliated
with LinkedIn or with any employer named in the sample postings.
