/* Understudy — client. The knob/tab code is lifted from the approved mockup;
   everything else wires it to the server. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------
     Knob copy — identical to the approved mockup.
  ------------------------------------------------------------------ */
  var EXPERTISE = [
    { name: "Orientation",
      copy: "Assumes <em>no background at all</em>. Every term, credential, and framework gets unpacked the moment it comes up, including the ones insiders forget are jargon." },
    { name: "Grounding",
      copy: "Still defines the vocabulary, but only on first use. Common business words are left alone; anything specific to the field is spelled out." },
    { name: "Working",
      copy: "Assumes you know the field's basic vocabulary. Time goes to <em>how the pieces fit together</em> and what each certification actually licenses her to do." },
    { name: "Fluent",
      copy: "Assumes the frameworks are familiar. She names them in passing and spends the session on how they get applied to this particular employer." },
    { name: "Peer",
      copy: "Assumes the fundamentals. Skips vocabulary entirely and surfaces the <em>judgment calls and tradeoffs</em> — where the textbook answer is wrong here, and why." }
  ];

  var MODE = [
    { name: "Lecture",
      copy: "She narrates <em>uninterrupted</em>, start to finish. You observe and cannot ask questions — the shape of the work stays intact.",
      placeholder: "Questions are closed while she's narrating.",
      note: "Lecture mode — she runs start to finish and you stay out of it.",
      locked: true },
    { name: "Asides",
      copy: "Still uninterrupted, but you can <em>flag a moment</em> as it goes by. Everything you flagged gets answered once the task is done.",
      placeholder: "Flag this moment — she'll come back to it at the end…",
      note: "Flags are collected silently and answered after the walkthrough.",
      locked: false },
    { name: "Checkpoints",
      copy: "The narration <em>pauses at natural breaks</em> — after each step of the task — and she opens the floor before moving on.",
      placeholder: "Ask at the next checkpoint…",
      note: "She pauses after each step and takes questions before moving on.",
      locked: false },
    { name: "Dialogue",
      copy: "You can <em>interrupt at any point</em>. She answers, then picks the task back up where she left it.",
      placeholder: "Interrupt with a question…",
      note: "She'll answer, then return to the task.",
      locked: false },
    { name: "Seminar",
      copy: "A conversation. You interrupt, push back, and ask about the parts she skipped — the task becomes <em>the excuse for the discussion</em>.",
      placeholder: "Ask, push back, or take it somewhere else…",
      note: "Open floor — the task can be set aside if the conversation is better.",
      locked: false }
  ];

  /* ------------------------------------------------------------------
     State
  ------------------------------------------------------------------ */
  var meta = { kinds: [], keySet: false };
  var kindsById = {};
  var job = null;          // the active posting (from URL, paste, or fixture)
  var jobOrigin = null;    // "linkedin" | "fixture" | "paste"
  var session = null;      // the live session, once one has run

  function expIdx()  { return parseInt($("exp-range").value, 10); }
  function modeIdx() { return parseInt($("mode-range").value, 10); }

  /* ------------------------------------------------------------------
     Mockup knob machinery (unchanged except onChange hooks)
  ------------------------------------------------------------------ */
  function buildTicks(el, count) {
    var html = "";
    for (var i = 0; i < count; i++) html += '<i style="left:' + (i / (count - 1)) * 100 + '%"></i>';
    el.innerHTML = html;
  }
  function buildStops(el, stops, onPick) {
    stops.forEach(function (s, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = s.name;
      b.setAttribute("data-on", "false");
      b.addEventListener("click", function () { onPick(i); });
      el.appendChild(b);
    });
  }
  function swap(el, html) {
    el.innerHTML = html;
    el.classList.remove("fade");
    void el.offsetWidth;
    el.classList.add("fade");
  }
  function makeKnob(cfg) {
    var range = $(cfg.id + "-range"), fill = $(cfg.id + "-fill"),
        thumb = $(cfg.id + "-thumb"), value = $(cfg.id + "-value"),
        desc = $(cfg.id + "-desc"), stopEl = $(cfg.id + "-stops"), last = -1;
    buildTicks($(cfg.id + "-ticks"), cfg.stops.length);
    buildStops(stopEl, cfg.stops, function (i) { range.value = i; render(); });
    function render() {
      var i = parseInt(range.value, 10);
      var pct = (i / (cfg.stops.length - 1)) * 100;
      fill.style.width = pct + "%";
      thumb.style.left = pct + "%";
      if (i !== last) {
        var stop = cfg.stops[i];
        value.textContent = stop.name;
        swap(desc, stop.copy);
        range.setAttribute("aria-valuetext", stop.name);
        Array.prototype.forEach.call(stopEl.children, function (b, n) {
          b.setAttribute("data-on", n === i ? "true" : "false");
        });
        if (cfg.onChange) cfg.onChange(i, stop);
        last = i;
      }
    }
    range.addEventListener("input", render);
    range.addEventListener("change", render);
    render();
  }

  makeKnob({ id: "exp", stops: EXPERTISE, onChange: function () { maybeOfferRerun(); } });

  makeKnob({
    id: "mode", stops: MODE,
    onChange: function (i, stop) {
      $("knob-mode").setAttribute("data-tone", i >= 3 ? "seminar" : "accent");
      if (!session) applyComposer(i);   // preview behavior, as in the mockup
      maybeOfferRerun();
    }
  });

  /* ------------------------------------------------------------------
     Composer configuration
  ------------------------------------------------------------------ */
  var LOCK_ICON = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  var OPEN_ICON = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.7"/>';

  function setComposer(locked, placeholder, note) {
    $("ask").disabled = locked;
    $("send").disabled = locked;
    $("ask").placeholder = placeholder;
    $("composer-note-text").textContent = note;
    $("composer-note").firstElementChild.innerHTML = locked ? LOCK_ICON : OPEN_ICON;
  }
  function applyComposer(i) {
    var m = MODE[i];
    setComposer(m.locked, m.placeholder, m.note);
  }

  /* ------------------------------------------------------------------
     Tabs (mockup) + fixtures + posting ingestion
  ------------------------------------------------------------------ */
  var tabUrl = $("tab-url"), tabPaste = $("tab-paste");
  function pickTab(which) {
    var url = which === "url";
    tabUrl.setAttribute("aria-selected", String(url));
    tabPaste.setAttribute("aria-selected", String(!url));
    $("panel-url").classList.toggle("hidden", !url);
    $("panel-paste").classList.toggle("hidden", url);
  }
  tabUrl.addEventListener("click", function () { pickTab("url"); });
  tabPaste.addEventListener("click", function () { pickTab("paste"); });

  function initials(text) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "–";
    return words.slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
  }

  function showResolved(j, pillText) {
    $("fetch-error").classList.add("hidden");
    $("url-hint").classList.add("hidden");
    $("resolved-logo").textContent = initials(j.company || j.title);
    $("resolved-who").textContent = j.title || "Untitled posting";
    var bits = [j.company, j.location, j.field].filter(Boolean);
    $("resolved-where").textContent = bits.join(" · ");
    $("resolved-pill").textContent = pillText;
    $("resolved").classList.remove("hidden");
  }

  function showFetchError(msg, attempts) {
    $("resolved").classList.add("hidden");
    $("fetch-error-msg").textContent = msg;
    $("fetch-error-attempts").textContent = (attempts || [])
      .map(function (a) { return a.stage + " → " + (a.status || "no response") + (a.note ? " (" + a.note + ")" : ""); })
      .join("   ");
    $("fetch-error").classList.remove("hidden");
  }

  function readPosting() {
    var url = $("url-input").value.trim();
    if (!url) {
      $("url-hint").textContent = "Paste a LinkedIn job link first.";
      $("url-hint").classList.remove("hidden");
      return;
    }
    $("url-hint").classList.add("hidden");
    $("read-btn").disabled = true;
    $("read-btn").textContent = "Reading…";
    fetch("/api/job?url=" + encodeURIComponent(url))
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (res.ok) {
          job = res.data;
          jobOrigin = "linkedin";
          showResolved(job, job.fromCache ? "Posting read (cached)" : "Posting read");
        } else {
          job = null;
          showFetchError(res.data.error, res.data.attempts);
        }
      })
      .catch(function () {
        showFetchError("The server could not be reached. Is npm start running?", []);
      })
      .finally(function () {
        $("read-btn").disabled = false;
        $("read-btn").textContent = "Read posting";
      });
  }
  $("read-btn").addEventListener("click", readPosting);
  $("url-input").addEventListener("keydown", function (e) { if (e.key === "Enter") readPosting(); });

  $("err-paste").addEventListener("click", function () { pickTab("paste"); $("paste-input").focus(); });
  $("err-fixture").addEventListener("click", function () {
    var b = $("fixture-row").querySelector("button");
    if (b) b.focus();
  });

  function loadFixture(id) {
    fetch("/api/fixtures/" + id)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        job = j;
        jobOrigin = "fixture";
        pickTab("url");
        showResolved(j, "Fixture loaded");
      });
  }

  fetch("/api/meta").then(function (r) { return r.json(); }).then(function (m) {
    meta = m;
    m.kinds.forEach(function (k) { kindsById[k.id] = k; });
  });
  fetch("/api/fixtures").then(function (r) { return r.json(); }).then(function (list) {
    var row = $("fixture-row");
    list.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = f.title + " — " + f.company;
      b.title = f.field;
      b.addEventListener("click", function () { loadFixture(f.id); });
      row.appendChild(b);
    });
  });

  /* ------------------------------------------------------------------
     SSE-over-fetch client
  ------------------------------------------------------------------ */
  function streamPost(url, body, onEvent, onError) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok && res.headers.get("content-type") && res.headers.get("content-type").indexOf("json") >= 0) {
        return res.json().then(function (j) { throw new Error(j.error || ("Server error " + res.status)); });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            var chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            chunk.split("\n").forEach(function (line) {
              if (line.indexOf("data: ") === 0) {
                try { onEvent(JSON.parse(line.slice(6))); } catch (e) { /* skip */ }
              }
            });
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (e) { onError(e.message); });
  }

  /* ------------------------------------------------------------------
     The live session
  ------------------------------------------------------------------ */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function termify(text) {
    return esc(text).replace(/\[\[(.+?)\]\]/g, function (_, t) {
      return '<span class="term" data-term="' + esc(t).replace(/"/g, "&quot;") + '">' + esc(t) + "</span>";
    });
  }
  function paragraphs(text) {
    return String(text).split(/\n{2,}/).map(function (p) {
      return "<p>" + termify(p).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function wikipediaUrl(term) {
    return "https://en.wikipedia.org/w/index.php?search=" + encodeURIComponent(term);
  }

  function activeJob() {
    var pasteOpen = tabPaste.getAttribute("aria-selected") === "true";
    if (pasteOpen) {
      var text = $("paste-input").value.trim();
      if (text.length < 120) {
        $("paste-hint").textContent = "That's too short to shadow from — paste the full description (a few paragraphs at least).";
        $("paste-hint").classList.remove("hidden");
        return null;
      }
      $("paste-hint").classList.add("hidden");
      jobOrigin = "paste";
      return { title: "Pasted posting", company: "", location: "", description: text };
    }
    if (job) return job;
    $("url-hint").textContent = "Read a posting, paste one, or load a saved posting first.";
    $("url-hint").classList.remove("hidden");
    return null;
  }

  function begin() {
    var j = activeJob();
    if (!j) return;

    session = {
      job: j,
      expertise: expIdx(),
      mode: modeIdx(),
      steps: [],
      terms: {},
      raw: "",
      transcript: [],
      flags: [],
      revealLimit: 1,       // checkpoints: how many steps may be shown
      rendered: 0,
      status: "streaming",
      busy: false
    };

    hideRerun();
    $("flag-chips").innerHTML = "";
    $("flag-chips").classList.add("hidden");

    // swap panes
    $("pane-preview").classList.add("hidden");
    $("pane-live").classList.remove("hidden");
    $("out-badge").textContent = "Live";
    $("out-what").textContent = (j.title || "Session") + (j.company ? " · " + j.company : "");
    $("out-setting").textContent = EXPERTISE[session.expertise].name + " · " + MODE[session.mode].name;

    // loading state: skeleton persona, thinking line
    $("live-avatar").textContent = "…";
    $("live-nm").innerHTML = '<span class="skel">Firstname Lastname</span>';
    $("live-rl").innerHTML = '<span class="skel">Title · years · credentials</span>';
    $("live-task").innerHTML = '<span class="skel">Today’s task: something ordinary and concrete</span>';
    $("narration").innerHTML = '<p class="thinking">Reading the posting and picking a routine task</p>';
    $("rail-list").innerHTML = "";

    applyComposer(session.mode);
    if (session.mode === 2) setComposer(false, "Ask at this checkpoint…", "She pauses after each step. Ask, or let her continue.");

    var go = $("go");
    go.disabled = true;
    go.firstChild.textContent = "Shadowing… ";

    streamPost("/api/shadow", { job: j, expertise: session.expertise, mode: session.mode }, onSessionEvent, function (msg) {
      genError(msg);
      finishStream();
    }).then(finishStream);
  }
  $("go").addEventListener("click", begin);

  function finishStream() {
    var go = $("go");
    go.disabled = false;
    go.firstChild.textContent = "Begin shadowing ";
  }

  function genError(msg) {
    var n = $("narration");
    var thinking = n.querySelector(".thinking");
    if (thinking) thinking.remove();
    var d = document.createElement("div");
    d.className = "gen-error";
    d.innerHTML = "<b>The session couldn't run.</b> " + esc(msg);
    n.appendChild(d);
  }

  function onSessionEvent(ev) {
    if (!session) return;
    switch (ev.type) {
      case "persona":
        $("live-avatar").textContent = initials(ev.name);
        $("live-nm").textContent = ev.name || "";
        $("live-rl").textContent = [ev.title, ev.experience, (ev.credentials || []).join(", ")]
          .filter(Boolean).join(" · ");
        break;
      case "task":
        $("live-task").innerHTML = "<strong>Today's task:</strong> " + esc(ev.task);
        break;
      case "step":
        session.steps.push(ev);
        renderSteps();
        break;
      case "term":
        session.terms[String(ev.term).toLowerCase()] = ev;
        railAdd(ev);
        break;
      case "raw":
        session.raw = ev.raw;
        break;
      case "error":
        genError(ev.message);
        break;
      case "done":
        session.status = "done";
        var thinking = $("narration").querySelector(".thinking");
        if (thinking) thinking.remove();
        renderSteps();
        session.transcript = [{ role: "assistant", content: session.raw }];
        if (session.mode === 1 && session.flags.length) sendFlags();
        else if (session.mode === 1) setComposer(false, MODE[1].placeholder, "Walkthrough done — flag anything now and she'll answer it.");
        break;
    }
  }

  /* ---------- narration rendering (with checkpoint gating) ---------- */

  function stepAllowed(i) {
    if (session.mode !== 2) return true;          // only checkpoints gate
    return i < session.revealLimit;
  }

  function renderSteps() {
    var n = $("narration");
    var thinking = n.querySelector(".thinking");
    while (session.rendered < session.steps.length && stepAllowed(session.rendered)) {
      if (thinking) { thinking.remove(); thinking = null; }
      var s = session.steps[session.rendered];
      var marker = document.createElement("p");
      marker.className = "step-marker";
      marker.textContent = "Step " + (session.rendered + 1) + " · " + (s.label || "");
      n.appendChild(marker);
      var holder = document.createElement("div");
      holder.innerHTML = paragraphs(s.body || "");
      while (holder.firstChild) n.appendChild(holder.firstChild);
      session.rendered++;
    }
    updateGate();
  }

  function updateGate() {
    var n = $("narration");
    var gate = $("cp-gate");
    if (gate) gate.remove();
    if (session.mode !== 2) return;
    var moreComing = session.rendered < session.steps.length || session.status === "streaming";
    if (!moreComing) return;                      // all revealed and stream done
    if (session.rendered === 0) return;           // nothing shown yet
    gate = document.createElement("div");
    gate.className = "checkpoint-gate";
    gate.id = "cp-gate";
    var btn = document.createElement("button");
    btn.className = "mini-btn";
    btn.type = "button";
    var waiting = session.rendered >= session.steps.length; // stream still writing
    btn.textContent = waiting ? "Next step is being written…" : "Continue →";
    btn.disabled = waiting;
    btn.addEventListener("click", function () {
      session.revealLimit++;
      renderSteps();
    });
    var hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Checkpoint — ask below, or continue.";
    gate.appendChild(btn);
    gate.appendChild(hint);
    n.appendChild(gate);
  }

  /* ---------- glossary rail ---------- */

  function kindChipHtml(kindId) {
    if (!kindId || !kindsById[kindId]) {
      return '<button class="k nokind" type="button">term</button>';
    }
    var k = kindsById[kindId];
    var cls = kindId === "credential" ? "k cred" : "k";
    return '<button class="' + cls + '" type="button" data-kind="' + kindId + '" title="What we mean by “' + esc(k.label) + '”">' + esc(k.label) + "</button>";
  }

  function railAdd(t) {
    var list = $("rail-list");
    var li = document.createElement("li");
    li.setAttribute("data-term", String(t.term).toLowerCase());
    li.innerHTML =
      '<span class="t-row"><span class="t">' + esc(t.term) + "</span>" +
      '<a class="ext" href="' + esc(t.url || wikipediaUrl(t.term)) + '" target="_blank" rel="noopener noreferrer" title="Open reference in a new tab">open ↗</a></span>' +
      kindChipHtml(t.kind) +
      '<p class="d">' + esc(t.definition || "") + "</p>" +
      '<div class="kind-def"></div>';
    var chip = li.querySelector(".k[data-kind]");
    if (chip) {
      chip.addEventListener("click", function () {
        var box = li.querySelector(".kind-def");
        if (box.classList.contains("show")) { box.classList.remove("show"); return; }
        var k = kindsById[chip.getAttribute("data-kind")];
        box.innerHTML = "<b>" + esc(k.label) + ", in our vocabulary</b>" + esc(k.definition) +
          ' <span style="color:var(--ink-3)">Test: ' + esc(k.test) + "</span>";
        box.classList.add("show");
      });
    }
    list.appendChild(li);
  }

  // clicking a marked term in the narration opens its glossary entry
  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest(".term[data-term]") : null;
    if (!el || !session) return;
    var key = el.getAttribute("data-term").toLowerCase();
    var li = $("rail-list").querySelector('li[data-term="' + key.replace(/"/g, '\\"') + '"]');
    if (!li) {
      railAdd({ term: el.getAttribute("data-term"), kind: null,
                definition: "Named in passing — not unpacked in this session.",
                url: wikipediaUrl(el.getAttribute("data-term")) });
      li = $("rail-list").lastElementChild;
    }
    li.scrollIntoView({ behavior: "smooth", block: "center" });
    li.classList.remove("flash");
    void li.offsetWidth;
    li.classList.add("flash");
  });

  /* ---------- follow-ups ---------- */

  function composerSubmit() {
    if (!session || session.busy) return;
    var q = $("ask").value.trim();
    if (!q) return;
    $("ask").value = "";

    if (session.mode === 1 && session.status === "streaming") {
      // Asides: queue the flag
      session.flags.push(q);
      var chips = $("flag-chips");
      chips.classList.remove("hidden");
      var c = document.createElement("span");
      c.className = "flag-chip";
      c.textContent = q;
      chips.appendChild(c);
      $("composer-note-text").textContent =
        session.flags.length + " flagged — answered after the walkthrough.";
      return;
    }

    var context = null;
    if (session.mode === 2) {
      var lastStep = session.steps[Math.min(session.rendered, session.steps.length) - 1];
      context = "asked at the checkpoint just after the step “" + (lastStep ? lastStep.label : "") + "”";
    }
    followup(q, context, q);
  }
  $("send").addEventListener("click", composerSubmit);
  $("ask").addEventListener("keydown", function (e) { if (e.key === "Enter") composerSubmit(); });

  function sendFlags() {
    var list = session.flags.map(function (f, i) { return (i + 1) + ". " + f; }).join("\n");
    var q = "While you worked, I flagged these moments:\n" + list;
    setComposer(true, "She's answering your flagged moments…", "Answering what you flagged, in order.");
    followup(q, "asides mode — the walkthrough is over; answer each flag in order",
             session.flags.length + " flagged moment" + (session.flags.length > 1 ? "s" : ""));
    session.flags = [];
  }

  function followup(question, context, displayQ) {
    session.busy = true;
    var n = $("narration");
    var gate = $("cp-gate");
    var ex = document.createElement("div");
    ex.className = "exchange";
    ex.innerHTML = '<p class="q">' + esc(displayQ) + '</p><div class="a"><p class="thinking">Thinking</p></div>';
    if (gate) n.insertBefore(ex, gate); else n.appendChild(ex);
    var answerEl = ex.querySelector(".a");
    var answered = false;

    streamPost("/api/followup", {
      job: session.job,
      expertise: session.expertise,
      mode: session.mode,
      transcript: session.transcript,
      question: question,
      context: context
    }, function (ev) {
      switch (ev.type) {
        case "answer":
          answered = true;
          answerEl.innerHTML = paragraphs(ev.body || "");
          break;
        case "term":
          session.terms[String(ev.term).toLowerCase()] = ev;
          railAdd(ev);
          break;
        case "raw":
          session.transcript.push({ role: "user", content: question + (context ? "\n(Context: " + context + ")" : "") });
          session.transcript.push({ role: "assistant", content: ev.raw });
          break;
        case "error":
          answerEl.innerHTML = '<p style="color:var(--accent)">' + esc(ev.message) + "</p>";
          answered = true;
          break;
        case "done":
          if (!answered) answerEl.innerHTML = '<p style="color:var(--ink-3)">No answer came back.</p>';
          break;
      }
    }, function (msg) {
      answerEl.innerHTML = '<p style="color:var(--accent)">' + esc(msg) + "</p>";
    }).then(function () {
      session.busy = false;
      if (session.mode === 1) {
        setComposer(false, "Flag another moment…", "Walkthrough done — anything else you flagged in your head, ask now.");
      }
    });
  }

  /* ---------- re-run offer ---------- */

  function maybeOfferRerun() {
    if (!session) return;
    var changed = expIdx() !== session.expertise || modeIdx() !== session.mode;
    if (!changed) { hideRerun(); return; }
    $("rerun-text").innerHTML =
      "Settings moved to <b>" + EXPERTISE[expIdx()].name + " · " + MODE[modeIdx()].name +
      "</b> — the session on screen was run at " +
      EXPERTISE[session.expertise].name + " · " + MODE[session.mode].name + ".";
    $("rerun-banner").classList.remove("hidden");
  }
  function hideRerun() { $("rerun-banner").classList.add("hidden"); }
  $("rerun-yes").addEventListener("click", function () { begin(); });
  $("rerun-no").addEventListener("click", hideRerun);

})();
