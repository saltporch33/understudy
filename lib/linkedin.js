/*
 * linkedin.js — fetch and parse a public LinkedIn job posting, server-side.
 *
 * Honest expectations: LinkedIn rate-limits and 999-blocks datacenter IPs.
 * This works best from a residential IP, intermittently from the cloud, and
 * sometimes not at all. Hence: cache-first, one retry, clear errors, and the
 * paste path / fixtures as first-class inputs. Scraping LinkedIn is against
 * their ToS; this fetcher exists for an academic prototype.
 *
 * Chain: cache → jobs/view page (schema.org JobPosting ld+json) →
 *        jobs-guest API fragment → structured error.
 */

const fs = require("fs");
const path = require("path");

const CACHE_DIR = path.join(__dirname, "..", "cache");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;

/* ---------------- URL / ID parsing ---------------- */

/** Extract a job ID from the shapes people actually paste. */
function parseJobId(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m;
  // /jobs/view/1234567890  or  /jobs/view/some-title-1234567890
  m = s.match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/);
  if (m) return m[1];
  // /jobs/search/?currentJobId=1234567890 (and friends)
  m = s.match(/[?&]currentJobId=(\d{6,})/);
  if (m) return m[1];
  // bare ID
  m = s.match(/^(\d{6,})$/);
  if (m) return m[1];
  return null;
}

/* ---------------- small utilities ---------------- */

function decodeEntities(t) {
  return String(t)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** Convert posting-description HTML into readable plain text. */
function htmlToText(html) {
  let t = String(html || "");
  t = t.replace(/<\s*br\s*\/?>/gi, "\n");
  t = t.replace(/<\s*li[^>]*>/gi, "\n• ");
  t = t.replace(/<\/(p|div|ul|ol|li|h[1-6])\s*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = decodeEntities(t);
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- parsers ---------------- */

/** Attempt 1: the public jobs/view page carries a schema.org JobPosting. */
function parseLdJson(html) {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )
  ];
  for (const b of blocks) {
    let obj;
    try {
      obj = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const candidates = Array.isArray(obj) ? obj : obj["@graph"] || [obj];
    for (const c of candidates) {
      if (c && c["@type"] === "JobPosting") {
        const loc = c.jobLocation;
        const addr =
          (Array.isArray(loc) ? loc[0] : loc)?.address || {};
        const location = [addr.addressLocality, addr.addressRegion]
          .filter(Boolean)
          .join(", ");
        return {
          title: decodeEntities(c.title || ""),
          company: decodeEntities(c.hiringOrganization?.name || ""),
          location,
          posted: c.datePosted || "",
          description: htmlToText(c.description || "")
        };
      }
    }
  }
  return null;
}

/** Attempt 2: the guest API returns an HTML fragment. */
function parseGuestFragment(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? decodeEntities(m[1].replace(/<[^>]+>/g, "").trim()) : "";
  };
  const descMatch = html.match(
    /<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  const description = descMatch ? htmlToText(descMatch[1]) : "";
  if (!description) return null;
  return {
    title:
      pick(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i) ||
      pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i),
    company:
      pick(/<a[^>]*topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i) ||
      pick(/<span[^>]*topcard__flavor(?!--)[^>]*>([\s\S]*?)<\/span>/i),
    location: pick(
      /<span[^>]*topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i
    ),
    posted: pick(/<span[^>]*posted-time-ago__text[^>]*>([\s\S]*?)<\/span>/i),
    description
  };
}

/* ---------------- cache ---------------- */

function cachePath(id) {
  return path.join(CACHE_DIR, `${id}.json`);
}
function readCache(id) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(id), "utf8"));
  } catch {
    return null;
  }
}
function writeCache(job) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(job.id), JSON.stringify(job, null, 2));
  } catch (e) {
    console.warn("cache write failed:", e.message);
  }
}

/* ---------------- the chain ---------------- */

async function attemptChain(id, attempts) {
  // 1. public page, ld+json
  try {
    const r = await get(`https://www.linkedin.com/jobs/view/${id}`);
    attempts.push({ stage: "jobs/view page", status: r.status });
    if (r.status === 200) {
      const parsed = parseLdJson(r.body);
      if (parsed && parsed.description) return { ...parsed, source: "ld+json" };
      attempts[attempts.length - 1].note = "200 but no JobPosting data in page";
    }
  } catch (e) {
    attempts.push({ stage: "jobs/view page", status: 0, note: e.name === "AbortError" ? "timed out" : e.message });
  }
  // 2. guest fragment API
  try {
    const r = await get(
      `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`
    );
    attempts.push({ stage: "jobs-guest API", status: r.status });
    if (r.status === 200) {
      const parsed = parseGuestFragment(r.body);
      if (parsed) return { ...parsed, source: "jobs-guest" };
      attempts[attempts.length - 1].note = "200 but description not found in fragment";
    }
  } catch (e) {
    attempts.push({ stage: "jobs-guest API", status: 0, note: e.name === "AbortError" ? "timed out" : e.message });
  }
  return null;
}

function explain(attempts) {
  const has = (code) => attempts.some((a) => a.status === code);
  if (has(999))
    return "LinkedIn answered with status 999 — its bot detection has blocked this server's IP address. This is common from cloud servers and usually lasts the whole session.";
  if (has(429))
    return "LinkedIn is rate-limiting this server (status 429). It may work again in a few minutes.";
  if (has(403))
    return "The request was refused (status 403) — either LinkedIn is blocking this server, or the network this server runs on doesn't allow reaching LinkedIn. A home connection usually behaves better.";
  if (attempts.some((a) => a.note === "timed out"))
    return "LinkedIn did not answer within the timeout.";
  if (attempts.every((a) => a.status === 0))
    return "LinkedIn could not be reached at all from this network.";
  return "LinkedIn served a page, but no posting data could be read from it. The posting may be closed, private, or the page format has changed.";
}

/**
 * Resolve a job by URL or ID: cache first, then the fetch chain, retried once.
 * Returns the job object, or throws {message, attempts}.
 */
async function resolveJob(input) {
  const id = parseJobId(input);
  if (!id) {
    const err = new Error(
      "That doesn't look like a LinkedIn job link. Expected something like linkedin.com/jobs/view/4015… — or use Paste description."
    );
    err.code = "BAD_URL";
    throw err;
  }

  const cached = readCache(id);
  if (cached) return { ...cached, fromCache: true };

  const attempts = [];
  let job = await attemptChain(id, attempts);
  if (!job) {
    await new Promise((r) => setTimeout(r, 1200)); // one retry, briefly spaced
    job = await attemptChain(id, attempts);
  }
  if (!job) {
    const err = new Error(explain(attempts));
    err.code = "FETCH_FAILED";
    err.attempts = attempts;
    throw err;
  }

  const full = {
    id,
    title: job.title || "Untitled posting",
    company: job.company || "",
    location: job.location || "",
    posted: job.posted || "",
    description: job.description,
    source: job.source,
    fetchedAt: new Date().toISOString()
  };
  writeCache(full);
  return full;
}

module.exports = { parseJobId, resolveJob, htmlToText, parseLdJson, parseGuestFragment };
