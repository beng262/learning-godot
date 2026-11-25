/* demos.js – the interactive figures. Each is <div class="demo" data-demo="name">
 * and mounts itself here. None of them needs anything but the page. */
(function () {
  "use strict";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const hl = (code) => (window.highlightGD ? window.highlightGD(code) : esc(code));
  const D = {};

  // ─────────────────────── the scene tree ───────────────────────
  const NODE_INFO = {
    Node: "The plainest node: a name, a place in the tree, and the callbacks. Good for things with no position, like a game manager.",
    Node2D: "A Node with a position, rotation and scale. Its children move with it.",
    Sprite2D: "Draws one texture. Everything you can see in a 2D game is usually one of these.",
    AnimatedSprite2D: "A sprite that flips through frames: a walk cycle, a flickering fire.",
    CharacterBody2D: "A body you move from code that stops at walls (move_and_slide).",
    CollisionShape2D: "The shape a body or area uses to touch things. On its own it does nothing; it belongs under a body or an Area2D.",
    Area2D: "Notices things entering and leaving it: a door trigger, a pickup.",
    Camera2D: "Decides what part of the world is on screen. Make it a child of the player and it follows them.",
    Timer: "Counts down and emits timeout. One-shot or repeating.",
    AudioStreamPlayer: "Plays a sound that is not anywhere in particular – music, a click.",
    CanvasLayer: "A layer drawn on top that the camera does not move: where the HUD lives.",
    Control: "The base of every UI node: a rectangle with anchors.",
    Label: "Text.",
    Button: "A Control you press. Emits pressed.",
    VBoxContainer: "Stacks its children top to bottom and sizes them.",
    HBoxContainer: "Lines its children up left to right.",
    ColorRect: "A rectangle of one colour. The simplest thing you can see.",
  };
  const ADDABLE = Object.keys(NODE_INFO);
  D["scene-tree"] = (el) => {
    let id = 0;
    const node = (type, name, kids) => ({ id: ++id, type, name: name || type, kids: kids || [] });
    let root = node("Node2D", "Main", [
      node("Node2D", "Player", [node("Sprite2D", "Sprite"), node("CollisionShape2D"), node("Camera2D")]),
      node("Node2D", "Room", [node("Sprite2D", "Bed"), node("Sprite2D", "Lamp")]),
      node("CanvasLayer", "HUD", [node("Label", "DayLabel"), node("Button", "MapButton")]),
      node("Timer", "DayTimer"),
    ]);
    let sel = root.kids[0].id;
    el.innerHTML = '<div class="tree-demo"><div class="tree-panel"><div class="dock-title">Scene</div><ul class="tree" role="tree"></ul>' +
      '<div class="tree-tools"><select aria-label="Node type to add"></select><button class="btn small" data-act="add">Add child</button>' +
      '<button class="btn small ghost" data-act="up">Move up</button><button class="btn small ghost" data-act="del">Delete</button></div></div>' +
      '<div class="tree-info"></div></div>';
    const sel_ = el.querySelector("select");
    ADDABLE.forEach((t) => sel_.append(new Option(t, t)));
    const find = (n, want, parent) => { if (n.id === want) return { n, parent }; for (const k of n.kids) { const r = find(k, want, n); if (r) return r; } return null; };
    const pathTo = (want) => { const walk = (n, acc) => { if (n.id === want) return acc.concat(n.name); for (const k of n.kids) { const r = walk(k, acc.concat(n.name)); if (r) return r; } return null; }; return walk(root, []); };
    const render = () => {
      const ul = el.querySelector(".tree"); ul.innerHTML = "";
      const draw = (n, depth) => {
        const li = h('<li role="treeitem" tabindex="0"><span class="ti t-' + n.type + '"></span><span class="nm"></span><span class="ty"></span></li>');
        li.style.paddingLeft = 8 + depth * 18 + "px";
        li.querySelector(".nm").textContent = n.name; li.querySelector(".ty").textContent = n.type;
        if (n.id === sel) li.classList.add("sel");
        li.addEventListener("click", () => { sel = n.id; render(); });
        li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sel = n.id; render(); } });
        ul.append(li);
        n.kids.forEach((k) => draw(k, depth + 1));
      };
      draw(root, 0);
      const f = find(root, sel);
      const path = pathTo(sel);
      const info = el.querySelector(".tree-info");
      const rel = path.slice(1).join("/");
      info.innerHTML = "<h5>" + esc(f.n.name) + " <small>" + esc(f.n.type) + "</small></h5><p>" + esc(NODE_INFO[f.n.type] || "") + "</p>" +
        (f.n.id === root.id ? "<p>This is the scene's root. Every other node is under it, and saving this tree is what a <code>.tscn</code> file is.</p>"
          : "<p>From a script on <b>Main</b> you reach it with:</p><pre class=\"gd\">" + hl("$" + rel + "\nget_node(\"" + rel + "\")") + "</pre>" +
            "<p>Its absolute path while the game runs is <code>/root/" + esc(path.join("/")) + "</code>.</p>") +
        (f.n.kids.length ? "<p>It has " + f.n.kids.length + " child" + (f.n.kids.length > 1 ? "ren" : "") + ". Move it and they move with it; free it and they are freed too.</p>" : "");
    };
    el.addEventListener("click", (e) => {
      const act = e.target.getAttribute && e.target.getAttribute("data-act"); if (!act) return;
      const f = find(root, sel);
      if (act === "add") {
        const t = sel_.value; const base = t.replace(/2D$|Container$/, "");
        let n = 1; const names = new Set(f.n.kids.map((k) => k.name)); let name = t; while (names.has(name)) name = base + (++n);
        const k = node(t, name); f.n.kids.push(k); sel = k.id;
      } else if (act === "del" && f.parent) { f.parent.kids.splice(f.parent.kids.indexOf(f.n), 1); sel = f.parent.id; }
      else if (act === "up" && f.parent) { const a = f.parent.kids; const i = a.indexOf(f.n); if (i > 0) { a.splice(i, 1); a.splice(i - 1, 0, f.n); } }
      render();
    });
    render();
  };

  // ─────────────────────── containers ───────────────────────
  D.containers = (el) => {
    const kids = [
      { name: "Title", fill: true, expand: false, w: 90, h: 28 },
      { name: "Picture", fill: true, expand: true, w: 70, h: 50 },
      { name: "Button", fill: false, expand: false, w: 80, h: 32 },
    ];
    const state = { type: "VBoxContainer", sep: 8, align: "BEGIN" };
    el.innerHTML = '<div class="cont-demo"><div class="cont-ctrl">' +
      '<label>Container <select data-k="type"><option>VBoxContainer</option><option>HBoxContainer</option></select></label>' +
      '<label>separation <input type="range" min="0" max="24" value="8" data-k="sep"><output></output></label>' +
      '<label>alignment <select data-k="align"><option>BEGIN</option><option>CENTER</option><option>END</option></select></label>' +
      '<div class="kids"></div></div><div class="cont-stage"><div class="box"></div></div><pre class="gd code"></pre></div>';
    const box = el.querySelector(".box");
    const kidsEl = el.querySelector(".kids");
    kids.forEach((k, i) => {
      const row = h('<div class="kid"><b></b><label><input type="checkbox" data-f="expand"> Expand</label><label><input type="checkbox" data-f="fill"> Fill</label></div>');
      row.querySelector("b").textContent = k.name;
      row.querySelector('[data-f="expand"]').checked = k.expand;
      row.querySelector('[data-f="fill"]').checked = k.fill;
      row.addEventListener("change", (e) => { k[e.target.getAttribute("data-f")] = e.target.checked; render(); });
      kidsEl.append(row);
    });
    el.querySelectorAll("[data-k]").forEach((c) => c.addEventListener("input", () => { state[c.getAttribute("data-k")] = c.type === "range" ? +c.value : c.value; render(); }));
    const render = () => {
      el.querySelector("output").textContent = state.sep;
      const v = state.type === "VBoxContainer";
      box.style.flexDirection = v ? "column" : "row";
      box.style.gap = state.sep + "px";
      box.style.justifyContent = { BEGIN: "flex-start", CENTER: "center", END: "flex-end" }[state.align];
      box.innerHTML = "";
      kids.forEach((k) => {
        const c = h('<div class="ctl"></div>');
        c.textContent = k.name;
        c.style.flexGrow = k.expand ? "1" : "0";
        c.style.flexBasis = (v ? k.h : k.w) + "px";
        // Fill is about the cross axis in Godot terms here: across the box.
        c.style.alignSelf = k.fill ? "stretch" : "center";
        if (v) { c.style.minHeight = k.h + "px"; if (!k.fill) c.style.width = k.w + "px"; }
        else { c.style.minWidth = k.w + "px"; if (!k.fill) c.style.height = k.h + "px"; }
        if (k.expand) c.classList.add("exp");
        box.append(c);
      });
      const flag = (k) => {
        const f = [];
        if (k.fill) f.push("SIZE_FILL"); else f.push("SIZE_SHRINK_CENTER");
        if (k.expand) f[0] = k.fill ? "SIZE_EXPAND_FILL" : "SIZE_EXPAND";
        return "Control." + f[0];
      };
      const axisMain = v ? "size_flags_vertical" : "size_flags_horizontal";
      const axisCross = v ? "size_flags_horizontal" : "size_flags_vertical";
      let code = "var box := " + state.type + ".new()\nbox.add_theme_constant_override(\"separation\", " + state.sep + ")\n";
      if (state.align !== "BEGIN") code += "box.alignment = BoxContainer.ALIGNMENT_" + state.align + "\n";
      kids.forEach((k) => {
        const n = k.name.toLowerCase();
        code += "\n" + n + "." + axisMain + " = " + (k.expand ? "Control.SIZE_EXPAND_FILL" : "Control.SIZE_FILL") + "\n";
        code += n + "." + axisCross + " = " + (k.fill ? "Control.SIZE_FILL" : "Control.SIZE_SHRINK_CENTER") + "\n";
        code += "box.add_child(" + n + ")\n";
      });
      void flag;
      el.querySelector("pre.code").innerHTML = hl(code.trim());
    };
    render();
  };

  // ─────────────────────── anchors ───────────────────────
  const PRESETS = {
    TOP_LEFT: [0, 0, 0, 0], TOP_RIGHT: [1, 0, 1, 0], BOTTOM_LEFT: [0, 1, 0, 1], BOTTOM_RIGHT: [1, 1, 1, 1],
    CENTER: [0.5, 0.5, 0.5, 0.5], TOP_WIDE: [0, 0, 1, 0], BOTTOM_WIDE: [0, 1, 1, 1], LEFT_WIDE: [0, 0, 0, 1],
    RIGHT_WIDE: [1, 0, 1, 1], FULL_RECT: [0, 0, 1, 1], CENTER_TOP: [0.5, 0, 0.5, 0],
  };
  D.anchors = (el) => {
    el.innerHTML = '<div class="anch-demo"><div class="anch-ctrl"><div class="presets"></div>' +
      '<label>parent width <input type="range" min="180" max="420" value="320" data-k="pw"></label>' +
      '<label>parent height <input type="range" min="120" max="260" value="180" data-k="ph"></label></div>' +
      '<div class="anch-stage"><div class="parent"><div class="child">Control</div></div></div><pre class="gd code"></pre></div>';
    let preset = "TOP_LEFT";
    const st = { pw: 320, ph: 180 };
    const pre = el.querySelector(".presets");
    Object.keys(PRESETS).forEach((k) => { const b = h('<button type="button" class="btn small ghost"></button>'); b.textContent = k; b.addEventListener("click", () => { preset = k; render(); }); pre.append(b); });
    el.querySelectorAll("[data-k]").forEach((c) => c.addEventListener("input", () => { st[c.getAttribute("data-k")] = +c.value; render(); }));
    const render = () => {
      const [l, t, r, b] = PRESETS[preset];
      const cw = 90, ch = 40;
      const stretchX = l !== r, stretchY = t !== b;
      const ol = stretchX ? 12 : -cw * l, or = stretchX ? -12 : cw * (1 - r) + (r === 0 ? cw : 0) - (r === 0 ? 0 : 0);
      const parent = el.querySelector(".parent"); parent.style.width = st.pw + "px"; parent.style.height = st.ph + "px";
      const c = el.querySelector(".child");
      const x0 = l * st.pw + (stretchX ? 12 : -cw * l);
      const x1 = r * st.pw + (stretchX ? -12 : cw * (1 - r));
      const y0 = t * st.ph + (stretchY ? 12 : -ch * t);
      const y1 = b * st.ph + (stretchY ? -12 : ch * (1 - b));
      c.style.left = x0 + "px"; c.style.top = y0 + "px"; c.style.width = (x1 - x0) + "px"; c.style.height = (y1 - y0) + "px";
      el.querySelectorAll(".presets button").forEach((x) => x.classList.toggle("on", x.textContent === preset));
      void ol; void or;
      el.querySelector("pre.code").innerHTML = hl("control.set_anchors_preset(Control.PRESET_" + preset + ")\n# anchors, as fractions of the parent:\n# left " + l + ", top " + t + ", right " + r + ", bottom " + b + "\n# drag the parent's size and see which edges the Control keeps hold of");
    };
    render();
  };

  // ─────────────────────── transforms ───────────────────────
  D.transform = (el) => {
    el.innerHTML = '<div class="tr-demo"><canvas width="320" height="200"></canvas><div class="tr-ctrl">' +
      '<fieldset><legend>Parent (Node2D)</legend><label>position.x <input type="range" min="40" max="280" value="110" data-k="px"></label><label>position.y <input type="range" min="30" max="170" value="100" data-k="py"></label>' +
      '<label>rotation <input type="range" min="-180" max="180" value="0" data-k="pr"></label><label>scale <input type="range" min="50" max="200" value="100" data-k="ps"></label></fieldset>' +
      '<fieldset><legend>Child (Sprite2D)</legend><label>position.x <input type="range" min="-80" max="80" value="50" data-k="cx"></label><label>position.y <input type="range" min="-60" max="60" value="0" data-k="cy"></label></fieldset>' +
      '<p class="readout"></p></div></div>';
    const st = { px: 110, py: 100, pr: 0, ps: 100, cx: 50, cy: 0 };
    const cv = el.querySelector("canvas"); const ctx = cv.getContext("2d");
    el.querySelectorAll("[data-k]").forEach((c) => c.addEventListener("input", () => { st[c.getAttribute("data-k")] = +c.value; draw(); }));
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = css("--code-bg"); ctx.fillRect(0, 0, 320, 200);
      ctx.strokeStyle = css("--rule"); ctx.lineWidth = 1;
      for (let x = 0; x <= 320; x += 20) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, 200); ctx.stroke(); }
      for (let y = 0; y <= 200; y += 20) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(320, y + 0.5); ctx.stroke(); }
      const a = st.pr * Math.PI / 180, s = st.ps / 100;
      ctx.translate(st.px, st.py); ctx.rotate(a); ctx.scale(s, s);
      ctx.strokeStyle = css("--sea"); ctx.lineWidth = 2 / s;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(30, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 30); ctx.stroke();
      ctx.fillStyle = css("--sea"); ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = css("--blush"); ctx.fillRect(st.cx - 10, st.cy - 10, 20, 20);
      const gx = st.px + (st.cx * Math.cos(a) - st.cy * Math.sin(a)) * s;
      const gy = st.py + (st.cx * Math.sin(a) + st.cy * Math.cos(a)) * s;
      el.querySelector(".readout").innerHTML = "Child <code>position</code> = (" + st.cx + ", " + st.cy + ") – where it is <i>relative to its parent</i>.<br>Child <code>global_position</code> = (" + gx.toFixed(1) + ", " + gy.toFixed(1) + ") – where it is on the screen. Rotate or scale the parent and only the second number changes.";
    };
    draw();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  };

  // ─────────────────────── pixel scaling ───────────────────────
  const SPRITE = [
    "....aaaa....", "...abbbba...", "..abccccba..", "..abcdcdba..", "..abccccba..", "...abbbba...",
    "....aeea....", "...aeffea...", "..aeffffea..", "..aeffffea..", "...agaaga...", "...aa..aa...",
  ];
  const PAL = { a: "#3a2b30", b: "#8a5a3a", c: "#f1c39b", d: "#3a2b30", e: "#c9556e", f: "#e88ba0", g: "#5b3f2f" };
  D["pixel-scale"] = (el) => {
    el.innerHTML = '<div class="px-demo"><div class="px-row"></div><div class="px-ctrl"><label><input type="checkbox" data-k="linear"> Filter: Linear (the default for 3D games)</label></div><p class="px-note"></p></div>';
    const row = el.querySelector(".px-row");
    const src = document.createElement("canvas"); src.width = 12; src.height = 12;
    const sctx = src.getContext("2d");
    SPRITE.forEach((r, y) => [...r].forEach((ch, x) => { if (PAL[ch]) { sctx.fillStyle = PAL[ch]; sctx.fillRect(x, y, 1, 1); } }));
    const scales = [1, 1.5, 2, 2.5, 3, 4];
    const cells = scales.map((s) => {
      const c = h('<figure><canvas width="60" height="60"></canvas><figcaption></figcaption></figure>');
      c.querySelector("figcaption").textContent = "× " + s + (Number.isInteger(s) ? "" : "  uneven");
      row.append(c); return { s, cv: c.querySelector("canvas") };
    });
    const draw = (linear) => {
      cells.forEach(({ s, cv }) => {
        const ctx = cv.getContext("2d");
        ctx.clearRect(0, 0, 60, 60);
        ctx.imageSmoothingEnabled = linear;
        const size = 12 * s;
        ctx.drawImage(src, Math.round((60 - size) / 2), Math.round((60 - size) / 2), size, size);
      });
      el.querySelector(".px-note").innerHTML = linear
        ? "With <b>Linear</b> filtering every scale is blurred: each texel is averaged with its neighbours. Right for photographs and 3D; wrong for pixel art. Project Settings → Rendering → Textures → Default Texture Filter → <b>Nearest</b>."
        : "With <b>Nearest</b> the pixels stay sharp – but look at ×1.5 and ×2.5: some art pixels became one screen pixel wide and some two. That unevenness is why pixel-art games scale by whole numbers only (Project Settings → Display → Window → Stretch → Scale Mode → <b>integer</b>).";
    };
    el.querySelector("[data-k]").addEventListener("change", (e) => draw(e.target.checked));
    draw(false);
  };

  // ─────────────────────── easing ───────────────────────
  const EASE = {
    LINEAR: (t) => t, SINE: (t) => 1 - Math.cos((t * Math.PI) / 2), QUAD: (t) => t * t, CUBIC: (t) => t * t * t,
    QUINT: (t) => t ** 5, EXPO: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)), CIRC: (t) => 1 - Math.sqrt(1 - t * t),
    BACK: (t) => 2.70158 * t ** 3 - 1.70158 * t * t,
    ELASTIC: (t) => (t === 0 || t === 1 ? t : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3))),
    BOUNCE: (t) => 1 - bounceOut(1 - t),
  };
  function bounceOut(x) { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; }
  const easeWith = (fn, mode) => (t) => mode === "IN" ? fn(t) : mode === "OUT" ? 1 - fn(1 - t) : mode === "IN_OUT" ? (t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 - 2 * t) / 2) : (t < 0.5 ? (1 - fn(1 - 2 * t)) / 2 : 0.5 + fn(2 * t - 1) / 2);
  D.easing = (el) => {
    el.innerHTML = '<div class="ease-demo"><div class="ease-ctrl"><label>Transition <select data-k="trans"></select></label><label>Ease <select data-k="ease"><option>IN</option><option selected>OUT</option><option>IN_OUT</option><option>OUT_IN</option></select></label><button class="btn small" type="button">Play</button></div>' +
      '<canvas width="320" height="170"></canvas><pre class="gd code"></pre></div>';
    const tr = el.querySelector('[data-k="trans"]'); Object.keys(EASE).forEach((k) => tr.append(new Option(k, k))); tr.value = "BACK";
    const cv = el.querySelector("canvas"); const ctx = cv.getContext("2d");
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    let t0 = null;
    const draw = (p) => {
      const f = easeWith(EASE[tr.value], el.querySelector('[data-k="ease"]').value);
      ctx.clearRect(0, 0, 320, 170);
      ctx.fillStyle = css("--code-bg"); ctx.fillRect(0, 0, 320, 170);
      ctx.strokeStyle = css("--rule"); ctx.strokeRect(20.5, 20.5, 180, 120);
      ctx.strokeStyle = css("--blush"); ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 100; i++) { const t = i / 100; const x = 20 + t * 180, y = 140 - f(t) * 120; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.lineWidth = 1;
      if (p !== null) {
        const v = f(p);
        ctx.fillStyle = css("--sea"); ctx.fillRect(20 + p * 180 - 3, 140 - v * 120 - 3, 6, 6);
        ctx.fillStyle = css("--blush"); ctx.fillRect(240, 140 - v * 120 - 8, 40, 16);
      }
      ctx.fillStyle = css("--slate"); ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText("time →", 150, 160); ctx.fillText("value", 24, 14);
      el.querySelector("pre.code").innerHTML = hl("var tween := create_tween()\ntween.tween_property($Box, \"position:y\", 40.0, 0.8)\\\n\t.set_trans(Tween.TRANS_" + tr.value + ")\\\n\t.set_ease(Tween.EASE_" + el.querySelector('[data-k="ease"]').value + ")");
    };
    const anim = (now) => { if (t0 === null) t0 = now; const p = Math.min(1, (now - t0) / 1000); draw(p); if (p < 1) requestAnimationFrame(anim); else t0 = null; };
    el.querySelector("button").addEventListener("click", () => { t0 = null; requestAnimationFrame(anim); });
    el.querySelectorAll("select").forEach((s) => s.addEventListener("change", () => draw(null)));
    draw(null);
  };

  // ─────────────────────── signals ───────────────────────
  D.signals = (el) => {
    const listeners = [
      { name: "Score label", fn: "_on_coin_collected", says: (n) => "Score: " + n, on: true },
      { name: "Sound player", fn: "_play_chime", says: () => "♪ chime", on: true },
      { name: "Achievement tracker", fn: "_count_coins", says: (n) => (n >= 5 ? "Unlocked: five coins!" : (5 - n) + " to go"), on: false },
    ];
    let coins = 0;
    el.innerHTML = '<div class="sig-demo"><div class="emitter"><b>Coin</b><code>signal collected(total)</code><button class="btn accent" type="button">Pick up a coin</button></div>' +
      '<div class="wires"></div><ol class="log" aria-live="polite"></ol><pre class="gd code"></pre></div>';
    const wires = el.querySelector(".wires"), log = el.querySelector(".log");
    const code = () => {
      el.querySelector("pre.code").innerHTML = hl(listeners.map((l) => (l.on ? "" : "# ") + "coin.collected.connect(" + l.fn + ")").join("\n") + "\n\n# in the coin:\ncollected.emit(total)");
    };
    listeners.forEach((l) => {
      const row = h('<label class="wire"><input type="checkbox"> <span class="who"></span> <code></code></label>');
      row.querySelector("input").checked = l.on; row.querySelector(".who").textContent = l.name; row.querySelector("code").textContent = l.fn + "()";
      row.querySelector("input").addEventListener("change", (e) => { l.on = e.target.checked; code(); });
      wires.append(row);
    });
    el.querySelector(".emitter button").addEventListener("click", () => {
      coins++;
      const li = document.createElement("li");
      const heard = listeners.filter((l) => l.on);
      li.innerHTML = "<b>collected.emit(" + coins + ")</b> → " + (heard.length ? heard.map((l) => esc(l.name) + ": <i>" + esc(l.says(coins)) + "</i>").join(" · ") : "<i>nobody is listening – nothing happens, and that is fine</i>");
      log.prepend(li); while (log.children.length > 6) log.lastChild.remove();
    });
    code();
  };

  // ─────────────────────── the game loop ───────────────────────
  D["game-loop"] = (el) => {
    el.innerHTML = '<div class="loop-demo"><label>Frames per second <input type="range" min="10" max="144" value="60"><output>60</output></label>' +
      '<div class="lanes"><div class="lane"><span>_ready()</span><div class="track r"></div></div><div class="lane"><span>_process(delta)</span><div class="track p"></div></div><div class="lane"><span>_physics_process(delta)</span><div class="track f"></div></div></div>' +
      '<p class="loop-note"></p></div>';
    const range = el.querySelector("input"), out = el.querySelector("output");
    const draw = () => {
      const fps = +range.value; out.textContent = fps;
      const span = 0.25; // a quarter of a second
      const mk = (cls, times, label) => { const tr = el.querySelector(".track." + cls); tr.innerHTML = ""; times.forEach((t) => { const tick = h('<i title=""></i>'); tick.style.left = (t / span) * 100 + "%"; tick.title = label(t); tr.append(tick); }); };
      mk("r", [0], () => "once, when the node enters the tree");
      const p = []; for (let t = 0; t <= span; t += 1 / fps) p.push(t);
      mk("p", p, () => "delta = " + (1 / fps).toFixed(4));
      const f = []; for (let t = 0; t <= span; t += 1 / 60) f.push(t);
      mk("f", f, () => "delta = 0.0167, always");
      el.querySelector(".loop-note").innerHTML = "A quarter of a second at <b>" + fps + " fps</b>: <code>_process</code> runs " + p.length + " times with <code>delta</code> ≈ " + (1 / fps).toFixed(4) +
        "s, so <code>position.x += 100 * delta</code> still moves 25 pixels. <code>_physics_process</code> runs on its own fixed clock, 60 times a second, whatever the screen does.";
    };
    range.addEventListener("input", draw); draw();
  };

  // ─────────────────────── StyleBox ───────────────────────
  D.stylebox = (el) => {
    el.innerHTML = '<div class="sb-demo"><div class="sb-ctrl"><label>corner_radius <input type="range" min="0" max="24" value="12" data-k="r"></label><label>border_width <input type="range" min="0" max="8" value="3" data-k="b"></label>' +
      '<label>shadow_size <input type="range" min="0" max="16" value="8" data-k="s"></label><label><input type="checkbox" data-k="aa" checked> anti_aliasing</label></div>' +
      '<div class="sb-stage"><div class="sb-box">A panel</div></div><pre class="gd code"></pre></div>';
    const st = { r: 12, b: 3, s: 8, aa: true };
    el.querySelectorAll("[data-k]").forEach((c) => c.addEventListener("input", () => { st[c.getAttribute("data-k")] = c.type === "checkbox" ? c.checked : +c.value; draw(); }));
    const draw = () => {
      const b = el.querySelector(".sb-box");
      b.style.borderRadius = st.r + "px"; b.style.borderWidth = st.b + "px";
      b.style.boxShadow = st.s ? "0 " + Math.round(st.s / 2) + "px " + st.s + "px rgba(40,20,25,.3)" : "none";
      b.style.imageRendering = st.aa ? "auto" : "pixelated";
      b.classList.toggle("crisp", !st.aa);
      el.querySelector("pre.code").innerHTML = hl("var sb := StyleBoxFlat.new()\nsb.bg_color = Color(\"#fffaf6\")\nsb.border_color = Color(\"#e7c9cf\")\nsb.set_border_width_all(" + st.b + ")\nsb.set_corner_radius_all(" + st.r + ")\nsb.shadow_size = " + st.s + "\nsb.anti_aliasing = " + st.aa + "\n$Panel.add_theme_stylebox_override(\"panel\", sb)");
    };
    draw();
  };

  // ─────────────────────── y-sort ───────────────────────
  D["y-sort"] = (el) => {
    el.innerHTML = '<div class="ys-demo"><label><input type="checkbox" checked> y_sort_enabled (draw lower things in front)</label><div class="ys-stage"></div><p class="ys-note">Drag the two of them past each other.</p></div>';
    const stage = el.querySelector(".ys-stage");
    const things = [{ name: "tree", x: 60, y: 90, w: 46, h: 80, c: "#4a7c59" }, { name: "you", x: 120, y: 120, w: 26, h: 44, c: "#c9556e" }];
    const els = things.map((t) => { const d = h('<div class="ys-thing" tabindex="0"></div>'); d.textContent = t.name; d.style.background = t.c; stage.append(d); return d; });
    const cb = el.querySelector("input");
    const draw = () => {
      things.forEach((t, i) => {
        const d = els[i]; d.style.left = t.x - t.w / 2 + "px"; d.style.top = t.y - t.h + "px"; d.style.width = t.w + "px"; d.style.height = t.h + "px";
        d.style.zIndex = cb.checked ? Math.round(t.y) : i;
      });
    };
    els.forEach((d, i) => {
      let drag = null;
      d.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, tx: things[i].x, ty: things[i].y }; d.setPointerCapture(e.pointerId); });
      d.addEventListener("pointermove", (e) => { if (!drag) return; things[i].x = Math.max(20, Math.min(280, drag.tx + e.clientX - drag.x)); things[i].y = Math.max(50, Math.min(170, drag.ty + e.clientY - drag.y)); draw(); });
      d.addEventListener("pointerup", () => { drag = null; });
      d.addEventListener("keydown", (e) => { const k = { ArrowUp: [0, -6], ArrowDown: [0, 6], ArrowLeft: [-6, 0], ArrowRight: [6, 0] }[e.key]; if (k) { e.preventDefault(); things[i].x += k[0]; things[i].y += k[1]; draw(); } });
    });
    cb.addEventListener("change", draw); draw();
  };

  // ─────────────────────── the input map ───────────────────────
  D["input-map"] = (el) => {
    const map = { ui_left: ["ArrowLeft", "KeyA"], ui_right: ["ArrowRight", "KeyD"], ui_up: ["ArrowUp", "KeyW"], ui_down: ["ArrowDown", "KeyS"], jump: ["Space"], interact: ["KeyE"] };
    el.innerHTML = '<div class="im-demo"><p>Click here, then press keys.</p><div class="im-pad" tabindex="0" aria-label="Key tester"><table><thead><tr><th>action</th><th>keys</th><th>is_action_pressed</th></tr></thead><tbody></tbody></table></div><ol class="log"></ol></div>';
    const tb = el.querySelector("tbody");
    Object.entries(map).forEach(([a, keys]) => { const tr = h("<tr><td><code></code></td><td></td><td class=\"st\">false</td></tr>"); tr.querySelector("code").textContent = a; tr.children[1].textContent = keys.map((k) => k.replace("Key", "").replace("Arrow", "↑↓←→".includes(k) ? "" : "")).join(", "); tr.dataset.a = a; tb.append(tr); });
    const down = new Set();
    const pad = el.querySelector(".im-pad"), log = el.querySelector(".log");
    const upd = () => tb.querySelectorAll("tr").forEach((tr) => { const on = map[tr.dataset.a].some((k) => down.has(k)); tr.classList.toggle("on", on); tr.querySelector(".st").textContent = on ? "true" : "false"; });
    const ev = (e, pressed) => {
      const acts = Object.keys(map).filter((a) => map[a].includes(e.code));
      if (acts.length || e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (pressed) { if (e.repeat) { add("InputEventKey " + e.code + " pressed=true echo=true"); return; } down.add(e.code); } else down.delete(e.code);
      add("InputEventKey " + e.code + " pressed=" + pressed + (acts.length ? "  → " + acts.map((a) => (pressed ? "just_pressed(\"" : "just_released(\"") + a + "\")").join(", ") : ""));
      upd();
    };
    const add = (t) => { const li = document.createElement("li"); li.textContent = t; log.prepend(li); while (log.children.length > 7) log.lastChild.remove(); };
    pad.addEventListener("keydown", (e) => ev(e, true)); pad.addEventListener("keyup", (e) => ev(e, false));
    pad.addEventListener("blur", () => { down.clear(); upd(); });
  };

  window.BookDemos = {
    mount(el) {
      const name = el.getAttribute("data-demo");
      if (!D[name]) { el.textContent = "(unknown demo: " + name + ")"; return; }
      try { D[name](el); el.querySelectorAll("pre.gd").forEach((p) => { if (!p.innerHTML.includes("<span")) p.innerHTML = hl(p.textContent); }); }
      catch (e) { el.textContent = "This demo could not start: " + e.message; console.error(e); }
    },
    names: () => Object.keys(D),
  };
})();
