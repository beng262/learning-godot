/* book.js – everything interactive in the book, on top of gd.js.
 *
 *   <pre class="gd">…</pre>              highlighted GDScript
 *   <pre class="gd run">…</pre>          …with a Run button that prints its output
 *   <script type="application/json" class="exercise">{…}</script>
 *                                        an exercise: an editor, Run, Check, hints
 *   <script type="application/json" class="tutorial">{…}</script>
 *                                        a live tutorial: one editor, several
 *                                        steps, run and checked as you type
 *   <div class="demo" data-demo="…">     an interactive demo (demos.js)
 *
 * Progress (which exercises you have solved, and your code) is kept in this
 * browser only, and the book works the same without it.
 */
(function () {
  "use strict";
  const GD = window.GD;

  // ───────────── storage that never breaks the page ─────────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem("gdbook:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("gdbook:" + k, JSON.stringify(v)); } catch (e) { /* private window */ } },
    del(k) { try { localStorage.removeItem("gdbook:" + k); } catch (e) { /* ignore */ } },
  };
  window.BookStore = store;

  // ───────────── syntax highlighting ─────────────
  const KW = new Set(["if", "elif", "else", "for", "while", "match", "break", "continue", "pass", "return", "class",
    "class_name", "extends", "is", "in", "as", "self", "signal", "func", "static", "const", "enum", "var", "await",
    "and", "or", "not", "super", "when"]);
  const LIT = new Set(["true", "false", "null", "PI", "TAU", "INF", "NAN"]);
  const BUILTIN = new Set(["print", "prints", "str", "int", "float", "bool", "len", "range", "abs", "min", "max", "clamp",
    "lerp", "sqrt", "randi", "randf", "randi_range", "randf_range", "floor", "ceil", "round", "push_error", "assert",
    "get_node", "get_tree", "queue_free", "add_child", "preload", "load", "is_instance_valid", "snapped", "move_toward"]);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function highlight(src) {
    let out = "", i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === "#") {
        let j = src.indexOf("\n", i); if (j < 0) j = n;
        const text = src.slice(i, j);
        const mark = text.match(/^#\s*<(\d+)>\s*$/);
        out += mark ? '<span class="mk">' + mark[1] + "</span>" : '<span class="c">' + esc(text) + "</span>";
        i = j; continue;
      }
      if (c === '"' || c === "'") {
        const triple = src.substr(i, 3) === c + c + c;
        let j = i + (triple ? 3 : 1);
        while (j < n) {
          if (src[j] === "\\") { j += 2; continue; }
          if (triple ? src.substr(j, 3) === c + c + c : src[j] === c) { j += triple ? 3 : 1; break; }
          if (src[j] === "\n" && !triple) break;
          j++;
        }
        out += '<span class="s">' + esc(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      if (/[0-9]/.test(c) && !/[A-Za-z_]/.test(src[i - 1] || "")) {
        let j = i; while (j < n && /[0-9a-fA-Fx_.e]/.test(src[j])) j++;
        out += '<span class="n">' + esc(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      if (c === "@" || c === "$" || (c === "%" && /[A-Z]/.test(src[i + 1] || ""))) {
        let j = i + 1;
        if (src[j] === '"') { j = src.indexOf('"', j + 1) + 1; } else while (j < n && /[A-Za-z0-9_\/]/.test(src[j])) j++;
        out += '<span class="' + (c === "@" ? "an" : "np") + '">' + esc(src.slice(i, j)) + "</span>"; i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        const w = src.slice(i, j);
        let k = j; while (src[k] === " ") k++;
        const call = src[k] === "(";
        const prev = src.slice(Math.max(0, i - 5), i);
        let cls = "";
        if (KW.has(w)) cls = "k";
        else if (LIT.has(w)) cls = "n";
        else if (/func\s+$/.test(prev) || /func\s+$/.test(src.slice(Math.max(0, i - 6), i))) cls = "fd";
        else if (/^[A-Z][A-Za-z0-9]*$/.test(w) && /[a-z]/.test(w)) cls = "t";
        else if (/^[A-Z][A-Z0-9_]+$/.test(w)) cls = "cn";
        else if (call) cls = BUILTIN.has(w) ? "b" : "f";
        out += cls ? '<span class="' + cls + '">' + w + "</span>" : w;
        i = j; continue;
      }
      out += esc(c); i++;
    }
    return out;
  }
  window.highlightGD = highlight;

  // Code inside <pre> loses its tabs to HTML authors' editors, so the source
  // keeps them and we only trim the common indent and the edge blank lines.
  function dedent(text) {
    const lines = text.replace(/\r/g, "").replace(/^\n+|\s+$/g, "").split("\n");
    const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ ]*/)[0].length));
    return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join("\n");
  }

  // ───────────── the editor: a textarea over a highlighted copy ─────────────
  class Editor {
    constructor(host, code, opts) {
      opts = opts || {};
      this.onRun = opts.onRun;
      this.el = document.createElement("div");
      this.el.className = "ed";
      this.gutter = document.createElement("pre"); this.gutter.className = "ed-gut"; this.gutter.setAttribute("aria-hidden", "true");
      this.hl = document.createElement("pre"); this.hl.className = "ed-hl"; this.hl.setAttribute("aria-hidden", "true");
      this.ta = document.createElement("textarea");
      this.ta.className = "ed-ta";
      this.ta.spellcheck = false;
      this.ta.setAttribute("autocapitalize", "off");
      this.ta.setAttribute("autocomplete", "off");
      this.ta.setAttribute("autocorrect", "off");
      this.ta.setAttribute("aria-label", opts.label || "GDScript code");
      this.ta.value = code;
      const box = document.createElement("div"); box.className = "ed-box";
      box.append(this.hl, this.ta);
      this.el.append(this.gutter, box);
      host.append(this.el);
      this.ta.addEventListener("input", () => this.sync());
      this.ta.addEventListener("scroll", () => { this.hl.scrollTop = this.ta.scrollTop; this.hl.scrollLeft = this.ta.scrollLeft; this.gutter.scrollTop = this.ta.scrollTop; });
      this.ta.addEventListener("keydown", (e) => this.key(e));
      this.sync();
    }
    get value() { return this.ta.value; }
    set value(v) { this.ta.value = v; this.sync(); }
    sync() {
      const v = this.ta.value;
      this.hl.innerHTML = highlight(v) + "\n";
      const count = v.split("\n").length;
      let g = ""; for (let i = 1; i <= count; i++) g += i + "\n";
      this.gutter.textContent = g;
      this.ta.style.height = "auto";
      const h = Math.max(this.ta.scrollHeight, 60);
      this.ta.style.height = h + "px"; this.hl.style.height = h + "px";
      if (this.onChange) this.onChange(v);
    }
    markLine(line) {
      this.el.querySelectorAll(".ed-err").forEach((x) => x.remove());
      if (!line) return;
      const m = document.createElement("div"); m.className = "ed-err";
      const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 21;
      const pad = parseFloat(getComputedStyle(this.ta).paddingTop) || 12;
      m.style.top = pad + (line - 1) * lh + "px"; m.style.height = lh + "px";
      this.el.querySelector(".ed-box").append(m);
    }
    key(e) {
      const ta = this.ta;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (this.onRun) this.onRun(); return; }
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        if (s === en && !e.shiftKey) { this.replace(s, en, "\t", s + 1); return; }
        const le = v.indexOf("\n", en - (en > s && v[en - 1] === "\n" ? 1 : 0)); const end = le < 0 ? v.length : le;
        const block = v.slice(ls, end).split("\n");
        const changed = block.map((l) => (e.shiftKey ? l.replace(/^(\t| {1,4})/, "") : "\t" + l)).join("\n");
        this.replace(ls, end, changed, null, ls, ls + changed.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const s = ta.selectionStart, v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const line = v.slice(ls, s);
        let ind = line.match(/^[\t ]*/)[0];
        if (/:\s*(#.*)?$/.test(line)) ind += "\t";
        this.replace(s, ta.selectionEnd, "\n" + ind, s + 1 + ind.length);
        return;
      }
      if (e.key === "Backspace" && ta.selectionStart === ta.selectionEnd) {
        const s = ta.selectionStart, v = ta.value;
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const before = v.slice(ls, s);
        if (before.length && /^ +$/.test(before) && before.length % 4 === 0) { e.preventDefault(); this.replace(s - 4, s, "", s - 4); }
      }
    }
    replace(a, b, text, caret, selA, selB) {
      const ta = this.ta;
      ta.focus();
      ta.setSelectionRange(a, b);
      // execCommand keeps undo working where the browser still supports it
      let done = false;
      try { done = document.execCommand && document.execCommand("insertText", false, text); } catch (e) { done = false; }
      if (!done) { ta.value = ta.value.slice(0, a) + text + ta.value.slice(b); }
      if (selA !== undefined && selA !== null) ta.setSelectionRange(selA, selB);
      else if (caret !== null && caret !== undefined) ta.setSelectionRange(caret, caret);
      this.sync();
    }
  }
  window.BookEditor = Editor;

  // ───────────── running code ─────────────
  function runConsole(code, outEl, extra) {
    outEl.innerHTML = "";
    const add = (text, cls) => { const d = document.createElement("div"); d.className = "ln" + (cls ? " " + cls : ""); d.textContent = text === "" ? " " : text; outEl.append(d); };
    const r = GD.run(code, Object.assign({ output: (s) => add(s) }, extra || {}));
    if (r.error) add(String(r.error), "err");
    else if (!r.output.length) add("(ran without printing anything)", "quiet");
    outEl.hidden = false;
    return r;
  }

  function enhancePre(pre) {
    const code = dedent(pre.textContent);
    pre.innerHTML = highlight(code);
    if (!pre.classList.contains("run")) return;
    const bar = document.createElement("div"); bar.className = "runbar";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn small"; btn.textContent = "Run";
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn small ghost"; edit.textContent = "Edit and run";
    const out = document.createElement("div"); out.className = "console"; out.hidden = true; out.setAttribute("aria-live", "polite");
    bar.append(btn, edit);
    pre.after(bar, out);
    let ed = null;
    btn.addEventListener("click", () => runConsole(ed ? ed.value : code, out));
    edit.addEventListener("click", () => {
      if (ed) return;
      const host = document.createElement("div");
      pre.replaceWith(host);
      ed = new Editor(host, code, { onRun: () => runConsole(ed.value, out) });
      // Live from here on: it runs again a moment after you stop typing.
      let t = 0;
      ed.onChange = () => { clearTimeout(t); t = setTimeout(() => runConsole(ed.value, out), 450); };
      btn.textContent = "Run again";
      const live = document.createElement("span"); live.className = "live-dot"; live.textContent = "live – runs as you type";
      edit.replaceWith(live);
      runConsole(code, out);
      ed.ta.focus();
    });
  }

  // ───────────── exercises ─────────────
  const LEVELS = { 1: "warm-up", 2: "practice", 3: "stretch", 4: "challenge" };
  function compareTests(spec, code, captured) {
    const r = window.BookChecker.check(spec, code, GD, window.CanvasHost);
    if (captured) captured.push(...r.output);
    return r;
  }
  window.BookCheck = compareTests;

  function buildExercise(script) {
    let spec;
    try { spec = JSON.parse(script.textContent); } catch (e) { console.error("bad exercise JSON", e, script.textContent.slice(0, 200)); return; }
    const id = spec.id;
    const box = document.createElement("section");
    box.className = "gx"; box.id = "ex-" + id;
    const head = document.createElement("div"); head.className = "gx-head";
    head.innerHTML = '<span class="gx-tag">Exercise ' + esc(spec.num || id) + " · " + (LEVELS[spec.level] || "practice") + '</span><span class="gx-state"></span>';
    const title = document.createElement("h4"); title.textContent = spec.title;
    const task = document.createElement("div"); task.className = "gx-task"; task.innerHTML = spec.task || "";
    box.append(head, title, task);
    const edHost = document.createElement("div");
    box.append(edHost);
    const saved = store.get("code:" + id, null);
    const ed = new Editor(edHost, saved !== null ? saved : spec.starter, { label: "Code for exercise " + (spec.num || id) });
    let saveT = 0;
    ed.onChange = (v) => { clearTimeout(saveT); saveT = setTimeout(() => store.set("code:" + id, v), 300); };
    const actions = document.createElement("div"); actions.className = "gx-actions";
    const mk = (label, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + (cls || ""); b.textContent = label; actions.append(b); return b; };
    const bRun = mk(spec.mode === "canvas" ? "Play" : "Run");
    const bCheck = mk("Check", "accent");
    const bHint = spec.hints && spec.hints.length ? mk("Hint", "ghost") : null;
    const bSol = spec.solution ? mk("Show a solution", "ghost") : null;
    const bReset = mk("Start over", "ghost");
    box.append(actions);
    let stage = null;
    if (spec.mode === "canvas") { stage = document.createElement("div"); stage.className = "stage-host"; box.append(stage); }
    const out = document.createElement("div"); out.className = "console"; out.hidden = true; out.setAttribute("aria-live", "polite");
    const tests = document.createElement("ul"); tests.className = "gx-tests"; tests.hidden = true;
    const hints = document.createElement("div"); hints.className = "gx-hints";
    box.append(out, tests, hints);
    script.replaceWith(box);

    const setState = () => {
      const done = store.get("done:" + id, false);
      head.querySelector(".gx-state").textContent = done ? "solved" : "";
      box.classList.toggle("solved", !!done);
    };
    setState();
    let sandbox = null;
    bRun.addEventListener("click", () => {
      ed.markLine(0);
      if (spec.mode === "canvas") {
        if (sandbox) sandbox.stop();
        sandbox = window.CanvasHost.play(stage, ed.value, out, (line) => ed.markLine(line));
        return;
      }
      const r = runConsole(ed.value, out);
      if (r.error) ed.markLine(r.error.gdLine);
    });
    ed.onRun = () => bRun.click();
    bCheck.addEventListener("click", () => {
      ed.markLine(0);
      const printed = [];
      const res = compareTests(spec, ed.value, printed);
      tests.innerHTML = ""; tests.hidden = false;
      if (spec.mode !== "canvas") {
        out.innerHTML = "";
        printed.forEach((s) => { const d = document.createElement("div"); d.className = "ln"; d.textContent = s || " "; out.append(d); });
        out.hidden = !printed.length && !res.error;
      }
      if (res.error) {
        const li = document.createElement("li"); li.className = "bad";
        li.innerHTML = "<b>Your script stopped</b><span>" + esc(String(res.error)) + "</span>";
        tests.append(li); ed.markLine(res.error.gdLine); return;
      }
      let all = true;
      for (const t of res.results) {
        all = all && t.ok;
        const li = document.createElement("li"); li.className = t.ok ? "ok" : "bad";
        li.innerHTML = "<b>" + esc(t.label) + "</b>" + (t.detail ? "<span>" + esc(t.detail) + "</span>" : "");
        tests.append(li);
      }
      const li = document.createElement("li"); li.className = "sum " + (all ? "ok" : "bad");
      li.textContent = all ? "All " + res.results.length + " checks pass. Nicely done." : res.results.filter((t) => t.ok).length + " of " + res.results.length + " checks pass.";
      tests.append(li);
      if (all) { store.set("done:" + id, true); setState(); document.dispatchEvent(new CustomEvent("book:progress")); }
    });
    let hintN = 0;
    if (bHint) bHint.addEventListener("click", () => {
      if (hintN >= spec.hints.length) return;
      const p = document.createElement("p"); p.className = "hint"; p.innerHTML = "<b>Hint " + (hintN + 1) + "</b> " + spec.hints[hintN];
      hints.append(p); hintN++;
      if (hintN >= spec.hints.length) bHint.disabled = true;
    });
    if (bSol) bSol.addEventListener("click", () => {
      if (hints.querySelector(".sol")) return;
      const wrap = document.createElement("div"); wrap.className = "sol";
      const p = document.createElement("p"); p.innerHTML = "<b>One way to do it.</b> Yours can be different and still right – the checks are what matter. " + (spec.explain || "");
      const pre = document.createElement("pre"); pre.className = "gd"; pre.innerHTML = highlight(spec.solution);
      const use = document.createElement("button"); use.type = "button"; use.className = "btn small ghost"; use.textContent = "Put this in the editor";
      use.addEventListener("click", () => { ed.value = spec.solution; ed.ta.focus(); });
      wrap.append(p, pre, use); hints.append(wrap);
    });
    bReset.addEventListener("click", () => {
      if (ed.value !== spec.starter && !confirm("Put the starting code back? Your changes to this exercise will be lost.")) return;
      ed.value = spec.starter; store.del("code:" + id); ed.markLine(0);
      out.hidden = true; tests.hidden = true; hints.innerHTML = ""; hintN = 0; if (bHint) bHint.disabled = false;
    });
  }

  // ───────────── live tutorials ─────────────
  // One editor carried through several steps. The code runs a moment after you
  // stop typing; the current step's checks tick as you meet them; the next step
  // opens when they all pass. Nothing to press except Next.
  function buildTutorial(script) {
    let spec;
    try { spec = JSON.parse(script.textContent); } catch (e) { console.error("bad tutorial JSON", e); return; }
    const id = spec.id, canvas = spec.mode === "canvas", N = spec.steps.length;
    const box = document.createElement("section"); box.className = "tut"; box.id = "tut-" + id;
    const el = (tag, cls, html) => { const x = document.createElement(tag); if (cls) x.className = cls; if (html !== undefined) x.innerHTML = html; return x; };
    const head = el("div", "gx-head", '<span class="gx-tag">Live tutorial' + (spec.num ? " " + esc(spec.num) : "") + " · " + N + ' steps</span><span class="gx-state"></span>');
    const title = el("h4"); title.textContent = spec.title;
    const intro = el("div", "tut-intro", spec.intro || "");
    const rail = el("ol", "tut-rail");
    const stepBox = el("div", "tut-step");
    const edHost = el("div", "tut-ed");
    const side = el("div", "tut-side");
    const stage = canvas ? el("div", "stage-host") : null;
    const out = el("div", "console"); out.setAttribute("aria-live", "off");
    const outLabel = el("p", "tut-label", canvas ? "Your game, running" : "Output, as you type");
    side.append(outLabel); if (stage) side.append(stage); side.append(out);
    const work = el("div", "tut-work" + (canvas ? " canvas" : "")); work.append(edHost, side);
    const tests = el("ul", "gx-tests"); tests.setAttribute("aria-live", "polite");
    const explain = el("div", "tut-explain"); explain.hidden = true;
    const actions = el("div", "gx-actions");
    const mk = (label, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + (cls || ""); b.textContent = label; actions.append(b); return b; };
    const bNext = mk("Next step →", "accent"); bNext.disabled = true;
    const bHint = mk("Hint", "ghost");
    const bSol = mk("Show me this step", "ghost");
    const bReset = mk("Start over", "ghost");
    const hints = el("div", "gx-hints");
    box.append(head, title, intro, rail, stepBox, work, tests, explain, actions, hints);
    script.replaceWith(box);

    const saved = store.get("tut:" + id, null) || {};
    let step = Math.min(saved.step || 0, N - 1), reached = Math.min(saved.reached || 0, N), hintN = 0;
    const ed = new Editor(edHost, typeof saved.code === "string" ? saved.code : spec.starter, { label: "Code for tutorial " + spec.title });
    const persist = () => store.set("tut:" + id, { step, reached, code: ed.value });
    const finished = () => reached >= N;
    const setState = () => {
      head.querySelector(".gx-state").textContent = finished() ? "finished" : "";
      box.classList.toggle("solved", finished());
    };

    let sandbox = null, visible = false, dirty = true;
    function evaluate() {
      if (!visible) { dirty = true; return; }
      dirty = false;
      const cur = spec.steps[step];
      const printed = [];
      const res = window.BookChecker.check({ mode: spec.mode, tests: cur.tests }, ed.value, GD, window.CanvasHost);
      printed.push(...res.output);
      ed.markLine(0);
      if (canvas) {
        if (sandbox) sandbox.stop();
        sandbox = window.CanvasHost.play(stage, ed.value, out, (line) => ed.markLine(line), { quiet: true });
      } else {
        out.innerHTML = "";
        const add = (text, cls) => { const d = el("div", "ln" + (cls ? " " + cls : "")); d.textContent = text === "" ? " " : text; out.append(d); };
        printed.slice(0, 200).forEach((s) => add(s));
        if (res.error) { add(String(res.error), "err"); ed.markLine(res.error.gdLine); }
        else if (!printed.length) add("(nothing printed yet)", "quiet");
      }
      tests.innerHTML = "";
      let all = !res.error;
      const rows = res.error ? cur.tests.map((t) => ({ label: t.label || t.expr || "check", ok: false, detail: "" })) : res.results;
      for (const t of rows) {
        all = all && t.ok;
        const li = el("li", t.ok ? "ok" : "todo");
        li.innerHTML = "<b>" + esc(t.label) + "</b>" + (t.detail && !res.error ? "<span>" + esc(t.detail) + "</span>" : "");
        tests.append(li);
      }
      if (res.error) { const li = el("li", "sum bad"); li.textContent = "The script stops with an error – see the red line."; tests.append(li); }
      if (all) {
        if (reached < step + 1) reached = step + 1;
        explain.hidden = false;
        explain.innerHTML = '<p class="tut-won">' + (step === N - 1 ? "That is the whole thing, working." : "Step " + (step + 1) + " done.") + "</p>" + (cur.explain || "");
        if (finished() && !store.get("done:" + id, false)) { store.set("done:" + id, true); document.dispatchEvent(new CustomEvent("book:progress")); }
      } else explain.hidden = true;
      bNext.disabled = !(all || reached > step) || step === N - 1;
      bNext.hidden = step === N - 1;
      box.classList.toggle("step-ok", all);
      drawRail(); setState(); persist();
    }
    function drawRail() {
      rail.innerHTML = "";
      spec.steps.forEach((st, i) => {
        const li = el("li", i === step ? "now" : i < reached ? "done" : "todo");
        const b = document.createElement("button"); b.type = "button"; b.textContent = i < reached && i !== step ? "✓" : String(i + 1);
        b.setAttribute("aria-label", "Step " + (i + 1) + ": " + st.title + (i < reached ? " (done)" : ""));
        b.disabled = i > reached;
        b.addEventListener("click", () => go(i));
        const s = el("span"); s.textContent = st.title;
        li.append(b, s); rail.append(li);
      });
    }
    function showStep() {
      const cur = spec.steps[step];
      stepBox.innerHTML = '<p class="tut-n">Step ' + (step + 1) + " of " + N + " · " + esc(cur.title) + "</p>" + cur.task;
      hints.innerHTML = ""; hintN = 0;
      bHint.hidden = !(cur.hints && cur.hints.length); bHint.disabled = false;
      evaluate();
    }
    function go(i) { step = Math.max(0, Math.min(N - 1, i)); showStep(); }
    bNext.addEventListener("click", () => { go(step + 1); stepBox.scrollIntoView({ block: "nearest", behavior: "smooth" }); ed.ta.focus({ preventScroll: true }); });
    bHint.addEventListener("click", () => {
      const hs = spec.steps[step].hints || [];
      if (hintN >= hs.length) return;
      const p = el("p", "hint", "<b>Hint " + (hintN + 1) + "</b> " + hs[hintN]);
      hints.append(p); hintN++;
      if (hintN >= hs.length) bHint.disabled = true;
    });
    bSol.addEventListener("click", () => {
      if (hints.querySelector(".sol")) return;
      const cur = spec.steps[step];
      const wrap = el("div", "sol");
      const p = el("p", "", "<b>The code after this step.</b> Read it against yours before you take it – the lines that changed are the lesson.");
      const pre = el("pre", "gd"); pre.innerHTML = highlight(cur.solution);
      const use = document.createElement("button"); use.type = "button"; use.className = "btn small ghost"; use.textContent = "Put this in the editor";
      use.addEventListener("click", () => { ed.value = cur.solution; });
      wrap.append(p, pre, use); hints.append(wrap);
    });
    bReset.addEventListener("click", () => {
      if (ed.value !== spec.starter && !confirm("Start this tutorial again from step 1? Your code for it will be lost.")) return;
      step = 0; reached = 0; store.del("done:" + id);
      ed.value = spec.starter; showStep();
      document.dispatchEvent(new CustomEvent("book:progress"));
    });
    let t = 0;
    ed.onChange = () => { clearTimeout(t); t = setTimeout(evaluate, canvas ? 650 : 380); };
    ed.onRun = () => { clearTimeout(t); evaluate(); };
    // Only the tutorial you are looking at runs: a page can hold many.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible && (dirty || (canvas && !sandbox))) evaluate();
        else if (!visible && sandbox) { sandbox.stop(); sandbox = null; }
      }, { rootMargin: "200px" }).observe(box);
    } else visible = true;
    drawRail(); setState(); showStep();
  }

  // ───────────── chapter list progress on the cover ─────────────
  function progress() {
    document.querySelectorAll("[data-progress]").forEach((el) => {
      const ids = (el.getAttribute("data-progress") || "").split(",").filter(Boolean);
      const done = ids.filter((id) => store.get("done:" + id, false)).length;
      el.textContent = ids.length ? done + "/" + ids.length : "";
      el.classList.toggle("all", ids.length > 0 && done === ids.length);
    });
  }
  document.addEventListener("book:progress", progress);

  // ───────────── theme switch ─────────────
  function theme() {
    const saved = store.get("theme", null);
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    const btn = document.querySelector(".theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next); store.set("theme", next);
    });
  }

  function init() {
    theme();
    document.querySelectorAll("pre.gd").forEach(enhancePre);
    document.querySelectorAll('script[type="application/json"].tutorial').forEach(buildTutorial);
    document.querySelectorAll('script[type="application/json"].exercise').forEach(buildExercise);
    if (window.BookDemos) document.querySelectorAll(".demo[data-demo]").forEach((el) => window.BookDemos.mount(el));
    progress();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
