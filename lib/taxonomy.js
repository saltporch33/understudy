/*
 * taxonomy.js — the closed kind vocabulary. SINGLE SOURCE OF TRUTH.
 *
 * Every term the model names gets tagged with exactly one of these kinds.
 * The model may not invent kinds; server.js enforces this list (with the
 * alias map below absorbing predictable drift).
 *
 * Each kind carries:
 *   definition — the house definition: what WE mean by the word, in plain
 *                language. Shown in the UI when the kind label is clicked,
 *                and injected into the model's system prompt.
 *   test       — the one question that separates this kind from its
 *                neighbors. Also injected into the prompt.
 *   examples   — three or four across fields, to anchor the model.
 *
 * House rule for collisions: a term is tagged by the job it does in THIS
 * narration, not by its full ontology. The NEC treated as binding law in the
 * narrator's state is a regulation that session; discussed as a reference
 * document, a standard. One term, one kind, per session.
 */

const KINDS = [
  {
    id: "credential",
    label: "Credential",
    definition:
      "Something a person holds and can lose: earned from an outside body, and it travels with the person, not the job. Covers both licenses (required by law) and certifications (required by the market).",
    test: "Does a person carry it from job to job, and could a body revoke it?",
    examples: ["PMP", "RN license", "journeyman card", "OSHA 30 card"]
  },
  {
    id: "body",
    label: "Body",
    definition:
      "A named organization with power over the field: it issues the credentials, publishes the standards, or enforces the rules. Its authority doesn't come from any one employer.",
    test: "Is it an organization that outlasts and outranks any single workplace?",
    examples: ["PMI", "OSHA", "the Joint Commission", "IBEW"]
  },
  {
    id: "standard",
    label: "Standard",
    definition:
      "A published reference that says what “done correctly” means in a field. It is versioned, citable chapter-and-verse, and work can be checked against it.",
    test: "Could an auditor open it and check the work against it?",
    examples: ["PMBOK Guide", "the NEC", "ISO 9001", "USP <797>"]
  },
  {
    id: "regulation",
    label: "Regulation",
    definition:
      "A rule with legal force behind it. Ignore a standard and your peers object; ignore a regulation and the government does.",
    test: "If it's violated, is a government or court the enforcer?",
    examples: ["OSHA 29 CFR 1910", "HIPAA", "a state nurse practice act"]
  },
  {
    id: "framework",
    label: "Framework",
    definition:
      "A reusable way of organizing a decision or a body of work into named parts. You think with it — there are no steps to execute and nothing to comply with.",
    test: "Does it organize the work without telling you how to perform it?",
    examples: ["power–interest grid", "SWOT", "Scrum", "a risk matrix"]
  },
  {
    id: "method",
    label: "Method",
    definition:
      "A specific repeatable technique for doing one thing: steps in, result out. One person can run it this afternoon and be finished.",
    test: "Can you perform it and be done?",
    examples: ["critical path method", "5 Whys", "sterile technique", "a megger test"]
  },
  {
    id: "doctrine",
    label: "Doctrine",
    definition:
      "A school of thought the field argues from: values and priorities that tilt many decisions without prescribing steps or structure.",
    test: "Does it guide many decisions but produce no document, steps, or parts of its own?",
    examples: ["Agile", "Lean", "evidence-based practice", "safety culture"]
  },
  {
    id: "phase",
    label: "Phase",
    definition:
      "A named stretch of the work, defined by what it produces rather than when it happens.",
    test: "Is it a chapter of the work with a defined output at its end?",
    examples: ["Initiating", "rough-in", "triage", "closeout"]
  },
  {
    id: "artifact",
    label: "Artifact",
    definition:
      "A concrete thing the work produces: a document or record that outlives the meeting it came from.",
    test: "Could you attach it to an email or put it in a binder?",
    examples: ["project charter", "stakeholder register", "the MAR", "as-built drawings"]
  },
  {
    id: "role",
    label: "Role",
    definition:
      "A named seat that carries defined authority: you can say what it may decide and who it answers to.",
    test: "Can you name what it is allowed to decide?",
    examples: ["project sponsor", "charge nurse", "journeyman", "the AHJ"]
  },
  {
    id: "metric",
    label: "Metric",
    definition:
      "A number the field agrees to be judged on.",
    test: "Is it a number someone's performance is measured by?",
    examples: ["schedule variance", "door-to-needle time", "voltage drop percentage"]
  },
  {
    id: "system",
    label: "System",
    definition:
      "A named piece of software or equipment the job runs on. Knowing it is a hireable skill in its own right.",
    test: "Is it a product you could list on a résumé under “systems”?",
    examples: ["Epic", "MS Project", "SAP", "Pyxis"]
  }
];

/*
 * Predictable drift the model might produce, mapped onto the closed set.
 * Anything not in KINDS and not here gets its kind dropped (rendered without
 * a kind chip) and logged — never silently invented.
 */
const ALIASES = {
  certification: "credential",
  cert: "credential",
  license: "credential",
  licence: "credential",
  qualification: "credential",
  organization: "body",
  organisation: "body",
  agency: "body",
  association: "body",
  institute: "body",
  union: "body",
  document: "artifact",
  deliverable: "artifact",
  record: "artifact",
  form: "artifact",
  report: "artifact",
  tool: "system",
  software: "system",
  platform: "system",
  equipment: "system",
  technique: "method",
  procedure: "method",
  practice: "method",
  law: "regulation",
  rule: "regulation",
  statute: "regulation",
  code: "standard",
  guideline: "standard",
  reference: "standard",
  philosophy: "doctrine",
  mindset: "doctrine",
  approach: "doctrine",
  movement: "doctrine",
  methodology: "framework",
  model: "framework",
  "process group": "phase",
  stage: "phase",
  step: "phase",
  kpi: "metric",
  measure: "metric",
  measurement: "metric",
  title: "role",
  position: "role",
  job: "role",
  concept: null, // no honest home; drop the chip rather than guess
  term: null
};

const KIND_IDS = new Set(KINDS.map((k) => k.id));

/** Normalize a model-supplied kind to the closed vocabulary, or null. */
function normalizeKind(raw) {
  if (!raw || typeof raw !== "string") return null;
  const k = raw.trim().toLowerCase();
  if (KIND_IDS.has(k)) return k;
  if (k in ALIASES) return ALIASES[k];
  return null;
}

/** The taxonomy rendered as prompt lines for the model. */
function taxonomyForPrompt() {
  return KINDS.map(
    (k) =>
      `- ${k.id} — ${k.definition} Test: ${k.test} e.g., ${k.examples.join(", ")}.`
  ).join("\n");
}

module.exports = { KINDS, ALIASES, KIND_IDS, normalizeKind, taxonomyForPrompt };
