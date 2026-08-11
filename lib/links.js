/*
 * links.js — where a clicked term points.
 *
 * Policy (in order):
 *   1. Hardcoded map below wins. Domain-level or long-stable pages only.
 *   2. If the model supplied a sourceUrl whose host is on the allowlist,
 *      we keep ONLY the origin (https://www.pmi.org) — never the model's
 *      path, because a plausible-looking dead deep link is worse than a
 *      search fallback.
 *   3. Otherwise: a Wikipedia search URL for the term. Deterministic,
 *      always lands somewhere useful.
 */

const OFFICIAL = {
  // project management
  pmp: "https://www.pmi.org/certifications/project-management-pmp",
  capm: "https://www.pmi.org",
  pmi: "https://www.pmi.org",
  "pmbok": "https://www.pmi.org",
  "pmbok guide": "https://www.pmi.org",
  "prince2": "https://www.axelos.com",
  scrum: "https://scrumguides.org",
  "scrum guide": "https://scrumguides.org",
  csm: "https://www.scrumalliance.org",
  "scrum alliance": "https://www.scrumalliance.org",
  agile: "https://agilemanifesto.org",
  "agile manifesto": "https://agilemanifesto.org",
  lean: "https://www.lean.org",
  "six sigma": "https://asq.org",
  // safety / trades
  osha: "https://www.osha.gov",
  "osha 10": "https://www.osha.gov/training",
  "osha 30": "https://www.osha.gov/training",
  "lockout/tagout": "https://www.osha.gov/control-hazardous-energy",
  loto: "https://www.osha.gov/control-hazardous-energy",
  nec: "https://www.nfpa.org",
  "nfpa 70": "https://www.nfpa.org",
  "nfpa 70e": "https://www.nfpa.org",
  nfpa: "https://www.nfpa.org",
  ul: "https://www.ul.com",
  ansi: "https://www.ansi.org",
  iso: "https://www.iso.org",
  ibew: "https://www.ibew.org",
  neca: "https://www.necanet.org",
  // clinical
  "joint commission": "https://www.jointcommission.org",
  "the joint commission": "https://www.jointcommission.org",
  hipaa: "https://www.hhs.gov/hipaa",
  cms: "https://www.cms.gov",
  nclex: "https://www.nclex.com",
  ncsbn: "https://www.ncsbn.org",
  bls: "https://cpr.heart.org",
  acls: "https://cpr.heart.org",
  pals: "https://cpr.heart.org",
  ccrn: "https://www.aacn.org",
  aacn: "https://www.aacn.org",
  ana: "https://www.nursingworld.org",
  epic: "https://www.epic.com"
};

/* Hosts a model-supplied sourceUrl may point at (truncated to origin). */
const ALLOWED_HOSTS = new Set([
  "pmi.org", "axelos.com", "scrumguides.org", "scrumalliance.org",
  "agilemanifesto.org", "lean.org", "asq.org",
  "osha.gov", "nfpa.org", "ul.com", "ansi.org", "iso.org", "ibew.org",
  "necanet.org", "jointcommission.org", "hhs.gov", "cms.gov", "nclex.com",
  "ncsbn.org", "heart.org", "cpr.heart.org", "aacn.org", "nursingworld.org",
  "epic.com", "nist.gov", "ashrae.org", "asme.org", "aws.org", "shrm.org",
  "aicpa.org", "finra.org", "sec.gov", "faa.gov", "fda.gov", "cdc.gov",
  "usp.org", "ahima.org", "himss.org", "comptia.org", "isc2.org", "isaca.org"
]);

function wikipediaUrl(term) {
  return (
    "https://en.wikipedia.org/w/index.php?search=" +
    encodeURIComponent(String(term || "").trim())
  );
}

/**
 * Resolve the link for a term.
 * @returns {{url: string, linkSource: "official"|"body-domain"|"wikipedia"}}
 */
function resolveLink(term, modelUrl) {
  const key = String(term || "").trim().toLowerCase();
  if (OFFICIAL[key]) return { url: OFFICIAL[key], linkSource: "official" };

  if (modelUrl && typeof modelUrl === "string") {
    try {
      const u = new URL(modelUrl);
      const host = u.hostname.replace(/^www\./, "");
      if (
        u.protocol === "https:" &&
        (ALLOWED_HOSTS.has(host) ||
          [...ALLOWED_HOSTS].some((h) => host.endsWith("." + h)))
      ) {
        return { url: u.origin, linkSource: "body-domain" };
      }
    } catch {
      /* fall through to wikipedia */
    }
  }
  return { url: wikipediaUrl(term), linkSource: "wikipedia" };
}

module.exports = { OFFICIAL, ALLOWED_HOSTS, resolveLink, wikipediaUrl };
