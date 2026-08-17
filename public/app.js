/* Understudy — client.
   The card, tab, and rail styling all come from the approved mockup; this
   file wires them to the server. The survey in step 2 builds itself from
   whatever lib/survey.js defines, so editing the questions there is enough. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  /* Must match BUILD in server.js. If they differ, the server is running old
     code — almost always because the app wasn't restarted after an edit. */
  var BUILD = "2026-08-15a";

  function trouble(html) {
    var el = $("trouble");
    el.innerHTML = html;
    el.classList.remove("hidden");
  }

  /* ------------------------------------------------------------------ */
  var meta = { kinds: [], keySet: false, survey: null };
  var kindsById = {};
  var job = null;
  var session = null;
  var answers = {};

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function attr(s) { return esc(s).replace(/"/g, "&quot;"); }

  /* ==================================================================
     Step 2 — two questions, built from lib/survey.js. Whatever they
     click is the answer; there is nothing to score or infer.
  ================================================================== */

  function buildSurvey() {
    var h = "";
    meta.survey.questions.forEach(function (q) {
      h += '<div class="sv-block"><p class="sv-q">' + esc(q.text) + '</p><div class="choice-group">';
      q.options.forEach(function (o, oi) {
        h += '<label><input type="radio" name="sv-' + attr(q.id) + '" value="' + oi + '">' +
             "<span>" + esc(o.label) + "</span></label>";
      });
      h += "</div>";
      if (q.options.some(function (o) { return o.other; })) {
        h += '<input type="text" class="sv-other hidden" id="sv-' + attr(q.id) + '-other" placeholder="' +
             attr((q.options.filter(function (o) { return o.other; })[0] || {}).otherPlaceholder || "") + '">';
      }
      h += "</div>";
    });
    $("survey-questions").innerHTML = h;

    meta.survey.questions.forEach(function (q) {
      Array.prototype.forEach.call(document.getElementsByName("sv-" + q.id), function (r) {
        r.addEventListener("change", function () {
          answers[q.id] = Number(r.value);
          var other = $("sv-" + q.id + "-other");
          if (other) {
            var isOther = q.options[Number(r.value)] && q.options[Number(r.value)].other;
            other.classList.toggle("hidden", !isOther);
            if (isOther) other.focus();
          }
          maybeOfferRerun();
        });
      });
      var other = $("sv-" + q.id + "-other");
      if (other) other.addEventListener("input", function () {
        answers[q.id + "Other"] = this.value;
      });
    });
  }

  /* Mirrors derive() in lib/survey.js — the option carries its own answer. */
  function derive() {
    var Q = meta.survey.questions;
    var fam = Q[0].options[Number(answers.familiarity)];
    var work = Q[1].options[Number(answers.work)];
    return {
      level: fam ? fam.level : 0,
      domainFluency: work ? work.fluency : "medium",
      work: (answers.workOther || (work ? work.label : "")).trim(),
      answered: !!fam
    };
  }

  function levelName(i) {
    return (meta.survey && meta.survey.levelNames && meta.survey.levelNames[i]) || "";
  }

  /* ==================================================================
     Posting (step 1)
  ================================================================== */

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
    var w = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "–";
    return w.slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join("");
  }

  function showResolved(j, pillText) {
    $("fetch-error").classList.add("hidden");
    $("url-hint").classList.add("hidden");
    $("resolved-logo").textContent = initials(j.company || j.title);
    $("resolved-who").textContent = j.title || "Untitled posting";
    $("resolved-where").textContent = [j.company, j.location, j.field].filter(Boolean).join(" · ");
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
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok) { job = res.d; showResolved(job, job.fromCache ? "Posting read (cached)" : "Posting read"); }
        else { job = null; showFetchError(res.d.error, res.d.attempts); }
      })
      .catch(function () { showFetchError("The server could not be reached. Is npm start running?", []); })
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
    fetch("/api/fixtures/" + id).then(function (r) { return r.json(); }).then(function (j) {
      job = j;
      pickTab("url");
      showResolved(j, "Fixture loaded");
    });
  }

  fetch("/api/meta")
    .then(function (r) {
      if (!r.ok) throw new Error("The server answered with " + r.status + ".");
      return r.json();
    })
    .then(function (m) {
      meta = m;
      if (m.build !== BUILD) {
        trouble("<b>The app was updated but not restarted.</b> The page and the running server are different versions (" +
                esc(String(m.build || "unknown")) + " vs " + BUILD + "). Close the black Understudy window, " +
                "double-click <b>Start Understudy.bat</b> again, then reload this page.");
        return;
      }
      if (!m.survey || !m.survey.questions) {
        trouble("<b>The server didn't send the survey questions.</b> Close the black Understudy window, start it again, and reload.");
        return;
      }
      if (!m.keySet) {
        trouble("<b>No API key is set.</b> The interface works, but nothing can be generated. " +
                "Close the black window, delete <b>env.txt</b> from the app folder, and start it again — it will ask you for a key.");
      }
      (m.kinds || []).forEach(function (k) { kindsById[k.id] = k; });
      buildSurvey();
    })
    .catch(function (e) {
      trouble("<b>Can't reach the Understudy server.</b> " + esc(e.message) +
              " Is the black window still open? If not, double-click <b>Start Understudy.bat</b>, then reload this page.");
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

  /* ==================================================================
     Deliverable (step 3)
  ================================================================== */

  var chosenTask = null;

  function taskMode() {
    var el = document.querySelector('input[name="taskmode"]:checked');
    return el ? el.value : "auto";
  }
  function currentTask() {
    var m = taskMode();
    if (m === "own") {
      var t = $("task-own").value.trim();
      return t.length >= 8 ? t : null;
    }
    if (m === "pick") return chosenTask;
    return null;
  }

  Array.prototype.forEach.call(document.querySelectorAll('input[name="taskmode"]'), function (r) {
    r.addEventListener("change", function () {
      var m = taskMode();
      $("task-own").classList.toggle("hidden", m !== "own");
      $("task-list").classList.toggle("hidden", m !== "pick" || !$("task-list").children.length);
      $("task-hint").classList.add("hidden");
      if (m === "own") $("task-own").focus();
      maybeOfferRerun();
    });
  });
  $("task-own").addEventListener("input", function () { maybeOfferRerun(); });

  $("suggest-btn").addEventListener("click", function (e) {
    e.preventDefault();
    var j = activeJob();
    if (!j) return;
    document.querySelector('input[name="taskmode"][value="pick"]').checked = true;
    $("task-own").classList.add("hidden");
    var list = $("task-list");
    list.classList.remove("hidden");
    list.innerHTML = '<p class="loading">Reading the posting for routine work…</p>';
    $("suggest-btn").disabled = true;

    fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: j })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        list.innerHTML = "";
        if (!res.ok || !res.d.tasks || !res.d.tasks.length) {
          list.innerHTML = '<p class="loading">' + esc((res.d && res.d.error) || "No suggestions came back.") + "</p>";
          return;
        }
        res.d.tasks.forEach(function (t) {
          var b = document.createElement("button");
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.innerHTML = "<b>" + esc(t.label || "Work") + "</b>" + esc(t.task);
          b.addEventListener("click", function () {
            chosenTask = t.task;
            Array.prototype.forEach.call(list.children, function (c) {
              if (c.setAttribute) c.setAttribute("aria-pressed", String(c === b));
            });
            maybeOfferRerun();
          });
          list.appendChild(b);
        });
      })
      .catch(function () { list.innerHTML = '<p class="loading">Couldn\'t reach the server.</p>'; })
      .finally(function () { $("suggest-btn").disabled = false; });
  });

  /* ==================================================================
     Streaming helper
  ================================================================== */

  function streamPost(url, body, onEvent, onError) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      var ct = res.headers.get("content-type") || "";
      if (!res.ok && ct.indexOf("json") >= 0) {
        return res.json().then(function (j) { throw new Error(j.error || ("Server error " + res.status)); });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            var chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
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

  /* ==================================================================
     The session
  ================================================================== */

  function termify(text) {
    return esc(text).replace(/\[\[(.+?)\]\]/g, function (_, t) {
      return '<span class="term" data-term="' + attr(t) + '">' + esc(t) + "</span>";
    });
  }
  function paragraphs(text) {
    return String(text).split(/\n{2,}/).map(function (p) {
      return "<p>" + termify(p).replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }
  function wikipediaUrl(t) {
    return "https://en.wikipedia.org/w/index.php?search=" + encodeURIComponent(t);
  }

  function activeJob() {
    var pasteOpen = tabPaste.getAttribute("aria-selected") === "true";
    if (pasteOpen) {
      var text = $("paste-input").value.trim();
      if (text.length < 120) {
        $("paste-hint").textContent = "That's too short to shadow from — paste the full description.";
        $("paste-hint").classList.remove("hidden");
        return null;
      }
      $("paste-hint").classList.add("hidden");
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

    var task = currentTask();
    if (taskMode() === "own" && !task) {
      $("task-hint").textContent = "Type the deliverable first, or switch to letting them choose.";
      $("task-hint").classList.remove("hidden");
      return;
    }
    if (taskMode() === "pick" && !task) {
      $("task-hint").textContent = "Pick one of the suggestions first, or switch to letting them choose.";
      $("task-hint").classList.remove("hidden");
      return;
    }
    $("task-hint").classList.add("hidden");

    var viewer = derive();

    session = {
      job: j,
      task: task,
      familiarity: viewer.level,
      viewer: viewer,
      steps: [],
      terms: {},
      raw: "",
      transcript: [],
      rendered: 0,
      status: "streaming",
      busy: false
    };

    hideRerun();
    $("pane-preview").classList.add("hidden");
    $("pane-live").classList.remove("hidden");
    $("out-badge").textContent = "Live";
    $("out-what").textContent = (j.title || "Session") + (j.company ? " · " + j.company : "");
    $("out-setting").textContent = levelName(viewer.level);

    $("live-avatar").textContent = "…";
    $("live-nm").innerHTML = '<span class="skel">Firstname Lastname</span>';
    $("live-rl").innerHTML = '<span class="skel">Title · years · credentials</span>';
    $("live-task").innerHTML = '<span class="skel">Today’s work: something ordinary and concrete</span>';
    $("narration").innerHTML = '<p class="thinking">Reading the posting and choosing something routine</p>';
    $("rail-list").innerHTML = "";

    setComposer(true, "They're working — questions open when they finish.", "Questions open once the session finishes.");

    var go = $("go");
    go.disabled = true;
    go.firstChild.textContent = "Working… ";

    streamPost("/api/shadow",
      { job: j, task: task, familiarity: viewer.level, viewer: viewer },
      onSessionEvent,
      function (msg) { genError(msg); finishStream(); }
    ).then(finishStream);
  }
  $("go").addEventListener("click", function () {
    try {
      begin();
    } catch (e) {
      trouble("<b>Something went wrong starting the session.</b> " + esc(e.message) +
              " Restarting the app usually fixes this: close the black window and start it again.");
    }
  });

  function finishStream() {
    var go = $("go");
    go.disabled = false;
    go.firstChild.textContent = "Create Shadow ";
  }

  function genError(msg) {
    var n = $("narration");
    var t = n.querySelector(".thinking");
    if (t) t.remove();
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
        $("live-task").innerHTML = "<strong>Working toward:</strong> " + esc(ev.task);
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
        var th = $("narration").querySelector(".thinking");
        if (th) th.remove();
        renderSteps();
        session.transcript = [{ role: "assistant", content: session.raw }];
        setComposer(false, "Ask them anything about what you just watched…",
                    "The work is done — ask them anything about it.");
        break;
    }
  }

  function renderSteps() {
    var n = $("narration");
    var th = n.querySelector(".thinking");
    while (session.rendered < session.steps.length) {
      if (th) { th.remove(); th = null; }
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
  }

  /* ---------- glossary rail ---------- */

  function kindChipHtml(kindId) {
    if (!kindId || !kindsById[kindId]) return '<button class="k nokind" type="button">term</button>';
    var k = kindsById[kindId];
    var cls = kindId === "credential" ? "k cred" : "k";
    return '<button class="' + cls + '" type="button" data-kind="' + attr(kindId) +
           '" title="What we mean by &quot;' + attr(k.label) + '&quot;">' + esc(k.label) + "</button>";
  }

  function railAdd(t) {
    var li = document.createElement("li");
    li.setAttribute("data-term", String(t.term).toLowerCase());
    li.innerHTML =
      '<span class="t-row"><span class="t">' + esc(t.term) + "</span>" +
      '<a class="ext" href="' + attr(t.url || wikipediaUrl(t.term)) +
      '" target="_blank" rel="noopener noreferrer" title="Open reference in a new tab">open ↗</a></span>' +
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
    $("rail-list").appendChild(li);
  }

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

  /* ---------- the chat box ---------- */

  var LOCK_ICON = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  var OPEN_ICON = '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.7"/>';

  function setComposer(locked, placeholder, note) {
    $("ask").disabled = locked;
    $("send").disabled = locked;
    $("ask").placeholder = placeholder;
    $("composer-note-text").textContent = note;
    $("composer-note").firstElementChild.innerHTML = locked ? LOCK_ICON : OPEN_ICON;
  }

  function composerSubmit() {
    if (!session || session.busy || session.status !== "done") return;
    var q = $("ask").value.trim();
    if (!q) return;
    $("ask").value = "";
    followup(q);
  }
  $("send").addEventListener("click", composerSubmit);
  $("ask").addEventListener("keydown", function (e) { if (e.key === "Enter") composerSubmit(); });

  function followup(question) {
    session.busy = true;
    var ex = document.createElement("div");
    ex.className = "exchange";
    ex.innerHTML = '<p class="q">' + esc(question) + '</p><div class="a"><p class="thinking">Thinking</p></div>';
    $("narration").appendChild(ex);
    var answerEl = ex.querySelector(".a");
    var answered = false;

    streamPost("/api/followup", {
      job: session.job,
      task: session.task,
      familiarity: session.familiarity,
      viewer: session.viewer,
      transcript: session.transcript,
      question: question
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
          session.transcript.push({ role: "user", content: question });
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
    }).then(function () { session.busy = false; });
  }

  /* ---------- re-run offer ---------- */

  function maybeOfferRerun() {
    if (!session) return;
    var d = derive();
    var levelChanged = d.level !== session.familiarity;
    var taskChanged = (currentTask() || null) !== (session.task || null);
    if (!levelChanged && !taskChanged) { hideRerun(); return; }
    var msg;
    if (levelChanged) {
      msg = "Your answers changed — the session on screen was made for someone who answered <b>" +
            levelName(session.familiarity) + "</b>.";
      if (taskChanged) msg += " The deliverable changed too.";
    } else {
      msg = "The deliverable changed — the session on screen is still the previous one.";
    }
    $("rerun-text").innerHTML = msg;
    $("rerun-banner").classList.remove("hidden");
  }
  function hideRerun() { $("rerun-banner").classList.add("hidden"); }
  $("rerun-yes").addEventListener("click", function () { begin(); });
  $("rerun-no").addEventListener("click", hideRerun);

})();
