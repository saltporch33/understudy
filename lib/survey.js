/*
 * survey.js — the two questions we ask before a session. SINGLE SOURCE OF
 * TRUTH: the page builds itself from this file, so changing the wording here
 * is all that's needed.
 *
 * Question 1 picks the familiarity block in prompts.js. The options ARE the
 * levels — there is no scoring, no inference, nothing to explain. Whatever
 * they click is what the professional is told.
 *
 * Question 2 does two quiet jobs. It lets the professional reach for an
 * analogy from the viewer's own world rather than their own, and it separates
 * two things that look alike from the outside: someone can be expert at their
 * own work and still have never heard the word "stakeholder." Familiarity with
 * the job and fluency in the world the job lives in are not the same thing.
 */

const QUESTIONS = [
  {
    id: "familiarity",
    text: "How familiar are you with this kind of job?",
    options: [
      { label: "Not at all — I don't really know what this job is", level: 0 },
      { label: "I've heard of it, but I don't know what they actually do", level: 1 },
      { label: "I've worked around people who do this job", level: 2 },
      { label: "I work closely with someone who does this job", level: 3 },
      { label: "I do this job now, or I've done it before", level: 4 }
    ]
  },
  {
    id: "work",
    text: "What kind of work do you do?",
    options: [
      { label: "Office work — computers, meetings, email", fluency: "high" },
      { label: "Hands-on work — a trade, repair, construction, driving", fluency: "low" },
      { label: "Healthcare", fluency: "medium" },
      { label: "School — student or teacher", fluency: "medium" },
      { label: "Not working right now", fluency: "medium" },
      { label: "Something else", fluency: "medium", other: true, otherPlaceholder: "What do you do?" }
    ]
  }
];

/* Short internal names, shown on the output header. Not user-facing copy. */
const LEVEL_NAMES = ["New to it", "Heard of it", "Around it", "Works alongside", "Does the job"];

/** Answers → what the prompt needs. No scoring; the click is the answer. */
function derive(answers = {}) {
  const fam = QUESTIONS[0].options[Number(answers.familiarity)];
  const work = QUESTIONS[1].options[Number(answers.work)];
  return {
    level: fam ? fam.level : 0,
    domainFluency: work ? work.fluency : "medium",
    work: (answers.workOther || (work ? work.label : "")).trim(),
    workIsOther: !!(work && work.other)
  };
}

/* ------------------------------------------------------------------ *
 *  The block injected into the system prompt.
 * ------------------------------------------------------------------ */

function viewerBlock(viewer = {}) {
  if (!viewer || !viewer.work) return "";
  const L = ["== WHO IS WATCHING =="];

  L.push(`Their own work: ${viewer.work}`);

  if (viewer.domainFluency === "low") {
    L.push(
      "They are expert at their own work but have never worked in an office. Do not assume they know the general vocabulary of this kind of workplace — not just your role's terms, but words like stakeholder, quarter, escalation, sign-off, deliverable, alignment. Explain that surrounding world too, or avoid it."
    );
  } else if (viewer.domainFluency === "high") {
    L.push(
      "They are at home in an office. Don't explain ordinary workplace vocabulary — spend that effort on what is specific to your role."
    );
  }

  L.push(
    `Where an analogy genuinely helps, reach for THEIR world rather than yours — draw it from what they do (${viewer.work}). A good analogy from their own work is worth three definitions. A forced one is worse than none, so skip it when nothing fits.`
  );

  return L.join("\n");
}

module.exports = { QUESTIONS, LEVEL_NAMES, derive, viewerBlock };
