/* workshop.js – a small copy of the Godot editor, in the page.
 *
 * Scene dock, Inspector, Node dock (signals), 2D viewport, script editor,
 * Output, and the .tscn text of whatever you have built. Run plays the scene:
 * every node with a script gets it, _ready() runs children-first as in Godot,
 * _process(delta) runs every frame, $Paths find nodes, buttons emit pressed
 * and timers emit timeout.
 *
 * It is a teaching model, not the engine: seven node types, no physics, no
 * resources. What it gets right is where things are and what they are called,
 * so that the real editor looks familiar the first time you open it.
 */
(function () {
  "use strict";
  const GD = window.GD;
  const VW = 320, VH = 180;          // the game's viewport, like Project Settings > Window
  const EW = 400, EH = 240, OX = 40, OY = 30;   // the editor's view of it, with a margin
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const store = window.BookStore || { get: (k, d) => d, set() {}, del() {} };

  // ───────────── little pixel textures, 16x16 ─────────────
  const TEX = {
    icon: { pal: { a: "#2a4a6b", b: "#478cbf", c: "#ffffff", d: "#1d1d1d" }, rows: [
      "................", "......bbbb......", "...bb.bbbb.bb...", "..bbbbbbbbbbbb..", "..bbbbbbbbbbbb..", ".bbccbbbbbbccbb.",
      ".bcddcbbbbcddcb.", ".bcddcbbbbcddcb.", ".bbccbbbbbbccbb.", ".bbbbbbccbbbbbb.", ".bbbcbbccbbcbbb.", ".bbbcccccccccbb.",
      "..bbbbbbbbbbbb..", "..aaaaaaaaaaaa..", "................", "................"] },
    player: { pal: { a: "#3a2b30", b: "#a4526a", c: "#f1c39b", d: "#3a2b30", e: "#4a7c9b", f: "#e88ba0" }, rows: [
      "................", ".....aaaaaa.....", "....abbbbbba....", "...abbbbbbbba...", "...abccccccba...", "...acdcccdcca...",
      "...acccccccca...", "....acccccca....", "....afffffffa...", "...affffffffa...", "...afaffffafa...", "....aeeeeeea....",
      "....aeeaaeea....", "....aeea.aea....", "....aaa..aaa....", "................"] },
    heart: { pal: { a: "#5b1f2e", b: "#e0566f", c: "#ffb3c1" }, rows: [
      "................", "................", "..aaa.....aaa...", ".abbba...abbba..", "abcbbbaaabbbbba.", "abcbbbbbbbbbbba.",
      "abbbbbbbbbbbbba.", ".abbbbbbbbbbba..", "..abbbbbbbbba...", "...abbbbbbba....", "....abbbbba.....", ".....abbba......",
      "......aba.......", ".......a........", "................", "................"] },
    coin: { pal: { a: "#6b4a10", b: "#f2c14e", c: "#fff2b0" }, rows: [
      "................", ".....aaaaaa.....", "...aabbbbbbaa...", "..abbcbbbbbbba..", "..abcbbaabbbba..", ".abbcbabbabbbba.",
      ".abbbbabbbbbbba.", ".abbbbbaabbbbba.", ".abbbbbbbabbbba.", ".abbbbabbabbbba.", "..abbbbaabbbba..", "..abbbbbbbbbba..",
      "...aabbbbbbaa...", ".....aaaaaa.....", "................", "................"] },
  };
  const texCanvas = {};
  function tex(name) {
    if (texCanvas[name]) return texCanvas[name];
    const t = TEX[name] || TEX.icon;
    const c = document.createElement("canvas"); c.width = 16; c.height = 16;
    const x = c.getContext("2d");
    t.rows.forEach((r, y) => [...r].forEach((ch, i) => { if (t.pal[ch]) { x.fillStyle = t.pal[ch]; x.fillRect(i, y, 1, 1); } }));
    return (texCanvas[name] = c);
  }

  // ───────────── node types and their properties ─────────────
  // [property, kind, default]   kind: vec, num, deg, bool, str, color, tex
  const TYPES = {
    Node: { base: null, props: [], icon: "◯" },
    Node2D: { base: "Node", props: [["position", "vec", [160, 90]], ["rotation_degrees", "num", 0], ["scale", "vec", [1, 1]], ["visible", "bool", true], ["z_index", "num", 0], ["modulate", "color", "#ffffff"]], icon: "✥" },
    Sprite2D: { base: "Node2D", props: [["texture", "tex", "icon"], ["centered", "bool", true], ["flip_h", "bool", false]], icon: "▣" },
    ColorRect: { base: "Control", props: [["position", "vec", [20, 20]], ["size", "vec", [60, 40]], ["color", "color", "#c9556e"], ["visible", "bool", true]], icon: "■" },
    Label: { base: "Control", props: [["position", "vec", [20, 20]], ["size", "vec", [120, 20]], ["text", "str", "Hello"], ["visible", "bool", true], ["modulate", "color", "#ffffff"]], icon: "A" },
    Button: { base: "Control", props: [["position", "vec", [20, 120]], ["size", "vec", [90, 26]], ["text", "str", "Press me"], ["disabled", "bool", false], ["visible", "bool", true]], icon: "▭", signals: ["pressed"] },
    Timer: { base: "Node", props: [["wait_time", "num", 1], ["one_shot", "bool", false], ["autostart", "bool", false]], icon: "◷", signals: ["timeout"] },
  };
  const allProps = (type) => { const out = []; let t = type; const chain = []; while (t && TYPES[t]) { chain.unshift(t); t = TYPES[t].base; } chain.forEach((c) => out.push(...TYPES[c].props)); return out; };
  const isA = (type, want) => { let t = type; while (t) { if (t === want) return true; t = TYPES[t] ? TYPES[t].base : null; } return want === "Node" || (want === "Control" && ["ColorRect", "Label", "Button"].includes(type)) || (want === "CanvasItem" && type !== "Node" && type !== "Timer"); };
  const isControl = (type) => ["ColorRect", "Label", "Button"].includes(type);
  const is2D = (type) => isA(type, "Node2D");

  const TEMPLATE = (type) => "extends " + type + "\n\n\n# Called when the node enters the scene tree for the first time.\nfunc _ready() -> void:\n\tpass # Replace with function body.\n\n\n# Called every frame. 'delta' is the elapsed time since the previous frame.\nfunc _process(delta: float) -> void:\n\tpass\n";

  let uid = 1;
  const mkNode = (type, name, props, kids, script) => {
    const n = { id: uid++, type, name: name || type, props: {}, kids: kids || [], script: script || null };
    for (const [k, , d] of allProps(type)) n.props[k] = Array.isArray(d) ? d.slice() : d;
    Object.assign(n.props, props || {});
    return n;
  };
  function starter() {
    uid = 1;
    const root = mkNode("Node2D", "Main", { position: [0, 0] }, [
      mkNode("Sprite2D", "Player", { position: [160, 100], texture: "player", scale: [2, 2] }, [], [
        "extends Sprite2D", "", "## How fast she walks, in pixels per second.", "@export var speed := 90.0", "",
        "func _ready() -> void:", "\tprint(\"Hello from \", name)", "",
        "func _process(delta: float) -> void:",
        "\tvar dir := Input.get_vector(\"ui_left\", \"ui_right\", \"ui_up\", \"ui_down\")",
        "\tposition += dir * speed * delta", ""].join("\n")),
      mkNode("Sprite2D", "Coin", { position: [250, 60], texture: "coin" }),
      mkNode("Label", "Score", { position: [8, 6], text: "Coins: 0" }),
      mkNode("Button", "Spin", { position: [8, 146], size: [74, 24], text: "Spin" }),
      mkNode("Timer", "Tick", { wait_time: 1, autostart: true }),
    ], [
      "extends Node2D", "", "var coins := 0", "",
      "func _ready() -> void:", "\t$Spin.pressed.connect(_on_spin_pressed)", "",
      "func _process(_delta: float) -> void:",
      "\tif $Player.position.distance_to($Coin.position) < 20:",
      "\t\tcoins += 1",
      "\t\t$Score.text = \"Coins: %d\" % coins",
      "\t\t$Coin.position = Vector2(randf_range(30, 290), randf_range(40, 150))", "",
      "func _on_spin_pressed() -> void:",
      "\t$Player.rotation_degrees += 45", "",
      "func _on_tick_timeout() -> void:",
      "\tprint(\"tick – \", coins, \" coins so far\")", ""].join("\n"));
    return { root, conns: [{ from: "Tick", signal: "timeout", to: ".", method: "_on_tick_timeout" }] };
  }

  // ───────────── the .tscn text ─────────────
  function vecStr(v, cls) { return (cls || "Vector2") + "(" + v.map((x) => +(+x).toFixed(3)).join(", ") + ")"; }
  function tscn(scene) {
    const scripts = [];
    const walk = (n, f) => { f(n); n.kids.forEach((k) => walk(k, f)); };
    walk(scene.root, (n) => { if (n.script !== null) scripts.push(n); });
    let out = "[gd_scene load_steps=" + (scripts.length + 1) + " format=3]\n\n";
    scripts.forEach((n, i) => { out += '[ext_resource type="Script" path="res://' + n.name.toLowerCase() + '.gd" id="' + (i + 1) + '_s"]\n'; });
    if (scripts.length) out += "\n";
    const pathOf = (target) => { const p = []; const f = (n, acc) => { if (n === target) { p.push(...acc); return true; } return n.kids.some((k) => f(k, acc.concat(k.name))); }; f(scene.root, []); return p.slice(0, -1).join("/") || "."; };
    walk(scene.root, (n) => {
      out += '[node name="' + n.name + '" type="' + n.type + '"' + (n === scene.root ? "" : ' parent="' + pathOf(n) + '"') + "]\n";
      for (const [k, kind, d] of allProps(n.type)) {
        const v = n.props[k];
        if (JSON.stringify(v) === JSON.stringify(d)) continue;
        if (kind === "vec") out += k + " = " + vecStr(v) + "\n";
        else if (kind === "color") { const c = GD.colorFromHex(v); out += k + " = Color(" + [c.r, c.g, c.b, c.a].map((x) => +x.toFixed(3)).join(", ") + ")\n"; }
        else if (kind === "str") out += k + ' = "' + String(v).replace(/"/g, '\\"') + '"\n';
        else if (kind === "tex") out += k + ' = preload("res://' + v + '.png")\n';
        else out += k + " = " + v + "\n";
      }
      if (n.script !== null) out += 'script = ExtResource("' + (scripts.indexOf(n) + 1) + '_s")\n';
      out += "\n";
    });
    scene.conns.forEach((c) => { out += '[connection signal="' + c.signal + '" from="' + c.from + '" to="' + c.to + '" method="' + c.method + '"]\n'; });
    return out.trim() + "\n";
  }

  // ───────────── the editor ─────────────
  function mount(root) {
    let scene = load() || starter();
    let selId = scene.root.kids[0] ? scene.root.kids[0].id : scene.root.id;
    let tab = "2D";
    let running = null;
    let editor = null;
    root.innerHTML = `
<div class="ws" data-tab="2D">
  <div class="ws-top">
    <div class="ws-menu"><span>Scene</span><span>Project</span><span>Debug</span><span>Editor</span><span>Help</span></div>
    <div class="ws-tabs" role="tablist"><button role="tab" data-tab="2D" class="on">2D</button><button role="tab" data-tab="Script">Script</button></div>
    <div class="ws-play"><button class="btn small accent" data-act="run" title="Run the scene (F5)">▶ Run</button><button class="btn small ghost" data-act="stop" title="Stop (F8)" disabled>■ Stop</button></div>
  </div>
  <div class="ws-mtabs" role="tablist"><button data-m="scene" class="on">Scene</button><button data-m="view">View</button><button data-m="insp">Inspector</button><button data-m="out">Output</button></div>
  <div class="ws-body" data-m="scene">
    <aside class="ws-left">
      <section class="dock" data-dock="scene"><h6>Scene</h6>
        <div class="dock-tools"><button class="btn small" data-act="add" title="Add Child Node">＋ Add</button><button class="btn small ghost" data-act="script" title="Attach a script">Script</button><button class="btn small ghost" data-act="dup">Duplicate</button><button class="btn small ghost" data-act="del">Delete</button></div>
        <ul class="tree" role="tree"></ul>
      </section>
      <section class="dock" data-dock="files"><h6>FileSystem</h6><ul class="files"></ul></section>
    </aside>
    <main class="ws-center">
      <div class="ws-view"><canvas width="${EW}" height="${EH}" tabindex="0" aria-label="2D viewport"></canvas><p class="ws-hint">Drag a node to move it. While running: arrow keys, and click buttons.</p></div>
      <div class="ws-script"><div class="ws-script-head"></div><div class="ws-ed"></div></div>
      <div class="ws-bottom"><div class="ws-btabs"><button data-b="out" class="on">Output</button><button data-b="tscn">Scene file (.tscn)</button></div><div class="ws-out console"></div><pre class="ws-tscn"></pre></div>
    </main>
    <aside class="ws-right">
      <div class="ws-rtabs"><button data-r="insp" class="on">Inspector</button><button data-r="node">Node</button></div>
      <section class="dock insp"></section>
      <section class="dock node" hidden></section>
    </aside>
  </div>
  <dialog class="ws-add"><form method="dialog"><h5>Create New Node</h5><input type="search" placeholder="Search" aria-label="Search node types"><ul></ul><div class="row"><button class="btn small ghost" value="cancel">Cancel</button></div></form></dialog>
  <div class="ws-foot"><button class="btn small ghost" data-act="reset">Start over</button><span class="ws-saved"></span></div>
</div>`;
    const ws = root.querySelector(".ws");
    const cv = ws.querySelector("canvas");
    const ctx = cv.getContext("2d"); ctx.imageSmoothingEnabled = false;
    const out = ws.querySelector(".ws-out");

    const all = () => { const a = []; const w = (n, p) => { n.parent = p; a.push(n); n.kids.forEach((k) => w(k, n)); }; w(scene.root, null); return a; };
    const byId = (id) => all().find((n) => n.id === id);
    const sel = () => byId(selId) || scene.root;
    function save() { store.set("workshop", JSON.stringify(scene, (k, v) => (k === "parent" || k === "rt" ? undefined : v))); ws.querySelector(".ws-saved").textContent = "Saved in this browser."; }
    function load() { try { const s = store.get("workshop", null); if (!s) return null; const sc = JSON.parse(s); let m = 0; const w = (n) => { m = Math.max(m, n.id); n.kids.forEach(w); }; w(sc.root); uid = m + 1; return sc; } catch (e) { return null; } }

    // ── Scene dock
    function drawTree() {
      const ul = ws.querySelector(".tree"); ul.innerHTML = "";
      const w = (n, depth) => {
        const li = document.createElement("li");
        li.setAttribute("role", "treeitem"); li.tabIndex = 0;
        li.style.paddingLeft = 6 + depth * 16 + "px";
        li.innerHTML = '<span class="ic">' + TYPES[n.type].icon + '</span><span class="nm">' + esc(n.name) + "</span>" + (n.script !== null ? '<span class="sc" title="Has a script">📜</span>' : "") +
          (scene.conns.some((c) => c.from === n.name || (n === scene.root && c.from === ".")) ? '<span class="sg" title="Has connected signals">⇢</span>' : "");
        if (n.id === selId) li.classList.add("sel");
        li.addEventListener("click", () => { selId = n.id; refresh(); });
        li.addEventListener("dblclick", () => rename(n));
        li.addEventListener("keydown", (e) => { if (e.key === "Enter") rename(n); if (e.key === "Delete") del(); });
        ul.append(li);
        n.kids.forEach((k) => w(k, depth + 1));
      };
      w(scene.root, 0);
      const files = ws.querySelector(".files"); files.innerHTML = "<li>📁 res://</li><li class=\"f\">🎬 main.tscn</li>";
      all().filter((n) => n.script !== null).forEach((n) => { files.innerHTML += '<li class="f">📜 ' + esc(n.name.toLowerCase()) + ".gd</li>"; });
      Object.keys(TEX).forEach((t) => { files.innerHTML += '<li class="f">🖼 ' + t + ".png</li>"; });
    }
    function rename(n) {
      const v = prompt("Rename node", n.name);
      if (!v || !/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(v.trim())) return;
      const old = n.name; n.name = v.trim();
      scene.conns.forEach((c) => { if (c.from === old) c.from = n.name; if (c.to === old) c.to = n.name; });
      refresh();
    }
    function del() {
      const n = sel(); if (!n.parent) { alert("The root node cannot be deleted – every scene has exactly one root."); return; }
      n.parent.kids.splice(n.parent.kids.indexOf(n), 1); selId = n.parent.id; refresh();
    }

    // ── Inspector
    function drawInspector() {
      const n = sel(); const box = ws.querySelector(".insp");
      let html = '<div class="insp-head"><b>' + esc(n.name) + "</b> <small>" + n.type + "</small></div>";
      let section = null;
      const chain = []; let t = n.type; while (t && TYPES[t]) { chain.unshift(t); t = TYPES[t].base; }
      chain.forEach((c) => {
        if (!TYPES[c].props.length) return;
        html += '<div class="insp-sec">' + c + "</div>";
        TYPES[c].props.forEach(([k, kind]) => {
          const v = n.props[k];
          let input = "";
          if (kind === "vec") input = '<span class="vec"><label>x <input type="number" step="1" data-p="' + k + '" data-i="0" value="' + v[0] + '"></label><label>y <input type="number" step="1" data-p="' + k + '" data-i="1" value="' + v[1] + '"></label></span>';
          else if (kind === "num") input = '<input type="number" step="any" data-p="' + k + '" value="' + v + '">';
          else if (kind === "bool") input = '<input type="checkbox" data-p="' + k + '"' + (v ? " checked" : "") + ">";
          else if (kind === "str") input = '<input type="text" data-p="' + k + '" value="' + esc(v) + '">';
          else if (kind === "color") input = '<input type="color" data-p="' + k + '" value="' + v + '">';
          else if (kind === "tex") input = '<select data-p="' + k + '">' + Object.keys(TEX).map((x) => "<option" + (x === v ? " selected" : "") + ">" + x + "</option>").join("") + "</select>";
          html += '<div class="prop"><span class="pk" title="' + k + '">' + k.replace(/_/g, " ") + "</span>" + input + "</div>";
        });
      });
      html += '<div class="insp-sec">Node</div><div class="prop"><span class="pk">name</span><input type="text" data-name value="' + esc(n.name) + '"></div>' +
        '<div class="prop"><span class="pk">script</span>' + (n.script !== null ? '<button class="btn small ghost" data-act="open">' + esc(n.name.toLowerCase()) + '.gd</button><button class="btn small ghost" data-act="detach" title="Detach script">✕</button>' : '<button class="btn small ghost" data-act="script">Attach…</button>') + "</div>";
      void section;
      box.innerHTML = html;
      box.querySelectorAll("[data-p]").forEach((inp) => inp.addEventListener("input", () => {
        const k = inp.getAttribute("data-p"), i = inp.getAttribute("data-i");
        const kind = allProps(n.type).find((p) => p[0] === k)[1];
        if (kind === "vec") n.props[k][+i] = +inp.value || 0;
        else if (kind === "num") n.props[k] = +inp.value || 0;
        else if (kind === "bool") n.props[k] = inp.checked;
        else n.props[k] = inp.value;
        paint(); drawTscn(); save();
      }));
      const nm = box.querySelector("[data-name]");
      nm.addEventListener("change", () => { const v = nm.value.trim(); if (/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(v)) { scene.conns.forEach((c) => { if (c.from === n.name) c.from = v; }); n.name = v; } refresh(); });
      // Node dock: signals
      const node = ws.querySelector(".node");
      const sigs = (TYPES[n.type].signals || []).concat(["ready", "tree_entered", "tree_exiting"]);
      node.innerHTML = "<div class=\"insp-head\"><b>Signals</b> <small>" + n.type + "</small></div>" + sigs.map((s) => {
        const conns = scene.conns.filter((c) => (c.from === n.name || (n === scene.root && c.from === ".")) && c.signal === s);
        return '<div class="sig"><span>⚡ ' + s + "()</span>" + conns.map((c) => '<div class="conn">→ ' + esc(c.to === "." ? scene.root.name : c.to) + " :: " + esc(c.method) + '() <button class="btn small ghost" data-unconn="' + scene.conns.indexOf(c) + '">✕</button></div>').join("") +
          '<button class="btn small ghost" data-conn="' + s + '">Connect…</button></div>';
      }).join("") + "<p class=\"note\">Connecting here is the same as writing <code>$" + esc(n.name) + ".pressed.connect(…)</code> in code; the connection is saved in the .tscn instead.</p>";
      node.querySelectorAll("[data-conn]").forEach((b) => b.addEventListener("click", () => {
        const s = b.getAttribute("data-conn");
        const scripted = all().filter((x) => x.script !== null);
        const target = scripted.length ? (scripted.find((x) => x === scene.root) || scripted[0]) : scene.root;
        if (target.script === null) target.script = TEMPLATE(target.type);
        const method = "_on_" + n.name.toLowerCase().replace(/\s+/g, "_") + "_" + s;
        if (!new RegExp("func\\s+" + method + "\\b").test(target.script)) target.script = target.script.replace(/\s*$/, "") + "\n\n\nfunc " + method + "() -> void:\n\tpass # Replace with function body.\n";
        scene.conns.push({ from: n === scene.root ? "." : n.name, signal: s, to: target === scene.root ? "." : target.name, method });
        selId = target.id; tab = "Script"; refresh();
      }));
      node.querySelectorAll("[data-unconn]").forEach((b) => b.addEventListener("click", () => { scene.conns.splice(+b.getAttribute("data-unconn"), 1); refresh(); }));
    }

    // ── Script
    function drawScript() {
      const n = sel();
      const head = ws.querySelector(".ws-script-head");
      const host = ws.querySelector(".ws-ed");
      if (n.script === null) {
        head.innerHTML = "<b>" + esc(n.name) + "</b> has no script. ";
        host.innerHTML = '<p class="note">A node does not need a script to exist – it already knows how to be a ' + n.type + '. Attach one when you want it to <i>do</i> something.</p><button class="btn" data-act="script">Attach Script</button>';
        editor = null; return;
      }
      head.innerHTML = "📜 <b>" + esc(n.name.toLowerCase()) + ".gd</b> <small>on " + esc(n.name) + " (" + n.type + ")</small>";
      host.innerHTML = "";
      editor = new window.BookEditor(host, n.script, { label: "Script for " + n.name, onRun: () => run() });
      editor.onChange = (v) => { n.script = v; drawTscn(); save(); };
    }
    function drawTscn() { ws.querySelector(".ws-tscn").textContent = tscn(scene); }

    function refresh() {
      ws.setAttribute("data-tab", tab);
      ws.querySelectorAll(".ws-tabs button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-tab") === tab));
      drawTree(); drawInspector(); if (tab === "Script") drawScript(); drawTscn(); paint(); save();
    }

    // ── 2D viewport (editing)
    const worldOf = (n) => {
      // accumulate Node2D transforms from the root down
      const chain = []; let p = n; while (p) { chain.unshift(p); p = p.parent; }
      let m = new DOMMatrix();
      for (const c of chain) {
        if (is2D(c.type)) { const pr = c.rt ? c.rt : c.props; m = m.translate(pr.position[0], pr.position[1]).rotate(pr.rotation_degrees || 0).scale(pr.scale[0], pr.scale[1]); }
      }
      return m;
    };
    const boundsOf = (n) => {
      const pr = n.rt || n.props;
      if (n.type === "Sprite2D") { const m = worldOf(n); const s = 16, o = pr.centered ? -8 : 0; const pts = [[o, o], [o + s, o], [o, o + s], [o + s, o + s]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y))); const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
      if (isControl(n.type)) return [pr.position[0], pr.position[1], pr.position[0] + pr.size[0], pr.position[1] + pr.size[1]];
      if (n.type === "Node2D") { const m = worldOf(n); const q = m.transformPoint(new DOMPoint(0, 0)); return [q.x - 5, q.y - 5, q.x + 5, q.y + 5]; }
      return null;
    };
    function paint() {
      const editing = !running;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = editing ? "#2f3542" : "#4d4d4d"; ctx.fillRect(0, 0, EW, EH);
      if (editing) {
        ctx.strokeStyle = "rgba(255,255,255,.05)";
        for (let x = OX % 16; x < EW; x += 16) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, EH); ctx.stroke(); }
        for (let y = OY % 16; y < EH; y += 16) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(EW, y + 0.5); ctx.stroke(); }
        ctx.strokeStyle = "rgba(230,80,80,.6)"; ctx.beginPath(); ctx.moveTo(0, OY + 0.5); ctx.lineTo(EW, OY + 0.5); ctx.stroke();
        ctx.strokeStyle = "rgba(110,200,110,.6)"; ctx.beginPath(); ctx.moveTo(OX + 0.5, 0); ctx.lineTo(OX + 0.5, EH); ctx.stroke();
        ctx.fillStyle = "#4d4d4d"; ctx.fillRect(OX, OY, VW, VH);
        ctx.strokeStyle = "#9c7ad6"; ctx.strokeRect(OX - 0.5, OY - 0.5, VW + 1, VH + 1);
      } else { ctx.fillStyle = "#1b1b1f"; ctx.fillRect(0, 0, EW, EH); ctx.fillStyle = "#4d4d4d"; ctx.fillRect(OX, OY, VW, VH); }
      ctx.save(); ctx.beginPath(); ctx.rect(editing ? 0 : OX, editing ? 0 : OY, editing ? EW : VW, editing ? EH : VH); ctx.clip();
      const nodes = all().filter((n) => (n.rt || n.props).visible !== false && !(n.rt && n.rt.freed));
      const hidden = new Set(); all().forEach((n) => { const pr = n.rt || n.props; if (pr.visible === false || (n.rt && n.rt.freed)) { const w = (k) => { hidden.add(k); k.kids.forEach(w); }; w(n); } });
      const order = nodes.filter((n) => !hidden.has(n)).map((n, i) => ({ n, i, z: (n.rt || n.props).z_index || 0 })).sort((a, b) => a.z - b.z || a.i - b.i);
      for (const { n } of order) {
        const pr = n.rt || n.props;
        ctx.setTransform(1, 0, 0, 1, OX, OY);
        if (n.type === "Sprite2D") {
          const m = worldOf(n);
          ctx.setTransform(m.a, m.b, m.c, m.d, m.e + OX, m.f + OY);
          if (pr.flip_h) ctx.scale(-1, 1);
          ctx.globalAlpha = colorOf(pr.modulate).a;
          const o = pr.centered ? -8 : 0;
          ctx.drawImage(tex(pr.texture), o, o, 16, 16);
          ctx.globalAlpha = 1;
        }
        if (n.type === "Node2D" && n.rt && n.rt.draw) {
          const m = worldOf(n); ctx.setTransform(m.a, m.b, m.c, m.d, m.e + OX, m.f + OY);
          for (const d of n.rt.draw) drawOp(d);
        }
        if (n.type === "ColorRect") { ctx.fillStyle = pr.color; ctx.fillRect(pr.position[0], pr.position[1], pr.size[0], pr.size[1]); }
        if (n.type === "Label") { ctx.fillStyle = "#ffffff"; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textBaseline = "top"; ctx.fillText(String(pr.text), pr.position[0] + 1, pr.position[1] + 4); }
        if (n.type === "Button") {
          const [x, y] = pr.position, [w, hh] = pr.size;
          ctx.fillStyle = pr.disabled ? "#3a3a40" : (n.rt && n.rt.down ? "#2b2b30" : "#3d3d45"); ctx.fillRect(x, y, w, hh);
          ctx.strokeStyle = "#5c5c66"; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
          ctx.fillStyle = pr.disabled ? "#777" : "#e8e8e8"; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textBaseline = "middle"; ctx.textAlign = "center";
          ctx.fillText(String(pr.text), x + w / 2, y + hh / 2 + 1); ctx.textAlign = "start";
        }
        if (editing && n.type === "Node2D" && n !== scene.root) { const b = boundsOf(n); ctx.setTransform(1, 0, 0, 1, OX, OY); ctx.strokeStyle = "#ffcc66"; ctx.beginPath(); ctx.arc((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 4, 0, 7); ctx.stroke(); }
      }
      ctx.restore();
      if (editing) {
        const b = boundsOf(sel());
        if (b) { ctx.setTransform(1, 0, 0, 1, OX, OY); ctx.strokeStyle = "#ffa500"; ctx.lineWidth = 1; ctx.strokeRect(b[0] - 1.5, b[1] - 1.5, b[2] - b[0] + 3, b[3] - b[1] + 3); }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const colorOf = (hex) => GD.colorFromHex(hex || "#ffffff");
    function drawOp(d) {
      const css = (c) => c.css();
      if (d.op === "rect") { const r = d.r; if (d.filled) { ctx.fillStyle = css(d.c); ctx.fillRect(r.position.x, r.position.y, r.size.x, r.size.y); } else { ctx.strokeStyle = css(d.c); ctx.strokeRect(r.position.x, r.position.y, r.size.x, r.size.y); } }
      else if (d.op === "circle") { ctx.fillStyle = css(d.c); ctx.beginPath(); ctx.arc(d.p.x, d.p.y, d.r, 0, 7); ctx.fill(); }
      else if (d.op === "line") { ctx.strokeStyle = css(d.c); ctx.lineWidth = d.w; ctx.beginPath(); ctx.moveTo(d.a.x, d.a.y); ctx.lineTo(d.b.x, d.b.y); ctx.stroke(); ctx.lineWidth = 1; }
    }

    // pointer: select and drag while editing; press buttons while running
    const toWorld = (e) => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * EW - OX, (e.clientY - b.top) / b.height * EH - OY]; };
    let drag = null;
    cv.addEventListener("pointerdown", (e) => {
      cv.focus();
      const [x, y] = toWorld(e);
      if (running) {
        const btn = all().filter((n) => n.type === "Button" && n.rt && !n.rt.disabled && n.rt.visible !== false).reverse().find((n) => { const b = boundsOf(n); return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; });
        if (btn) { btn.rt.down = true; running.press(btn); }
        return;
      }
      const hit = all().slice().reverse().find((n) => { const b = boundsOf(n); return b && n !== scene.root && x >= b[0] - 2 && x <= b[2] + 2 && y >= b[1] - 2 && y <= b[3] + 2; });
      if (hit) { selId = hit.id; const p = hit.props.position; drag = { n: hit, sx: x, sy: y, px: p[0], py: p[1] }; cv.setPointerCapture(e.pointerId); refresh(); }
    });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const [x, y] = toWorld(e);
      let dx = x - drag.sx, dy = y - drag.sy;
      // a child of a scaled or rotated Node2D moves in its parent's space
      if (drag.n.parent && is2D(drag.n.parent.type)) { const inv = worldOf(drag.n.parent).inverse(); const a = inv.transformPoint(new DOMPoint(drag.sx, drag.sy)), b = inv.transformPoint(new DOMPoint(x, y)); dx = b.x - a.x; dy = b.y - a.y; }
      drag.n.props.position = [Math.round(drag.px + dx), Math.round(drag.py + dy)];
      paint();
    });
    cv.addEventListener("pointerup", () => { if (drag) { drag = null; drawInspector(); drawTscn(); save(); } all().forEach((n) => { if (n.rt) n.rt.down = false; }); });

    // ── Running the scene
    function print(s, cls) { const d = document.createElement("div"); d.className = "ln" + (cls ? " " + cls : ""); d.textContent = s === "" ? " " : s; out.append(d); out.scrollTop = out.scrollHeight; if (out.children.length > 400) out.firstChild.remove(); }
    function run() {
      stop();
      out.innerHTML = "";
      print("--- Running main.tscn ---", "quiet");
      const nodes = all();
      nodes.forEach((n) => { n.rt = JSON.parse(JSON.stringify(n.props)); n.rt.down = false; n.rt.signals = {}; n.rt.draw = null; n.rt.dirty = true; n.rt.time_left = 0; n.rt.stopped = true; (TYPES[n.type].signals || []).forEach((s) => { n.rt.signals[s] = new GD.GDSignal(s, null); }); });
      const input = { down: new Set(), pressed: new Set(), released: new Set() };
      const fl = GD.fl;
      const wrapper = (n) => n.obj || n.wrap || (n.wrap = { __native: n.type, node: n, id: n.id });
      const nodeOf = (o) => (o && o.native && o.native.node) || (o && o.node) || null;
      const resolve = (from, path) => {
        let n = from;
        if (path.startsWith("%")) return all().find((x) => x.name === path.slice(1)) || null;
        if (path.startsWith("/root/")) { n = { kids: [scene.root] }; path = path.slice(6); }
        for (const part of path.split("/")) {
          if (!part || part === ".") continue;
          if (part === "..") { n = n.parent; if (!n) return null; continue; }
          n = n.kids.find((k) => k.name === part); if (!n) return null;
        }
        return n;
      };
      const host = {
        globals: {
          Input: { __native: "Input", is_action_pressed: (a) => input.down.has(a), is_action_just_pressed: (a) => input.pressed.has(a), is_action_just_released: (a) => input.released.has(a),
            get_axis: (a, b) => fl((input.down.has(b) ? 1 : 0) - (input.down.has(a) ? 1 : 0)),
            get_vector: (l, r, u, d) => { let x = (input.down.has(r) ? 1 : 0) - (input.down.has(l) ? 1 : 0), y = (input.down.has(d) ? 1 : 0) - (input.down.has(u) ? 1 : 0); const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; } return new GD.Vec2(x, y); } },
          Time: { __native: "Time", get_ticks_msec: () => Math.round(t * 1000) },
        },
        makeNative: (obj, base, interp) => { obj.native = interp.pendingNative || {}; },
        getNode: (self, path) => { const from = nodeOf(self); if (!from) return undefined; const n = resolve(from, path); return n ? wrapper(n) : null; },
        nativeIs: (v, type) => { const n = nodeOf(v); return !!n && isA(n.type, type); },
        getNative: (o, name) => {
          const n = nodeOf(o); if (!n) return undefined;
          const r = n.rt;
          if (r.signals[name]) return r.signals[name];
          if (name === "name") return n.name;
          if (name === "position" || name === "global_position") { if (name === "global_position" && is2D(n.type)) { const m = worldOf(n); return new GD.Vec2(m.e, m.f); } return new GD.Vec2(r.position[0], r.position[1]); }
          if (name === "size" || name === "scale") return new GD.Vec2(r[name][0], r[name][1]);
          if (name === "rotation") return fl((r.rotation_degrees || 0) * Math.PI / 180);
          if (name === "rotation_degrees" || name === "wait_time" || name === "z_index") return name === "z_index" ? r[name] : fl(r[name]);
          if (name === "time_left") return fl(r.time_left);
          if (name === "modulate" || name === "color") return colorOf(r[name]);
          if (name in r && typeof r[name] !== "object") return r[name];
          return undefined;
        },
        setNative: (o, name, v) => {
          const n = nodeOf(o); if (!n) return false;
          const r = n.rt; const props = allProps(n.type).map((p) => p[0]);
          if (name === "rotation") { r.rotation_degrees = GD.num(v) * 180 / Math.PI; return true; }
          if (name === "global_position") name = "position";
          if (name === "name") { n.name = String(v); return true; }
          if (!props.includes(name)) return false;
          const kind = allProps(n.type).find((p) => p[0] === name)[1];
          if (kind === "vec") { if (!(v instanceof GD.Vec2)) throw new GD.GDError("Expected a Vector2 for " + name + ".", 0); r[name] = [v.x, v.y]; }
          else if (kind === "num") r[name] = GD.num(v);
          else if (kind === "color") { if (v instanceof GD.Color) r[name] = "#" + [v.r, v.g, v.b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join(""); }
          else if (kind === "bool") r[name] = GD.truthy(v);
          else r[name] = typeof v === "string" ? v : GD.str(v);
          return true;
        },
        callNative: (o, name, args) => {
          const n = nodeOf(o); if (!n) return undefined;
          const r = n.rt;
          switch (name) {
            case "get_node": { const k = resolve(n, String(args[0])); return k ? wrapper(k) : null; }
            case "get_parent": return n.parent ? wrapper(n.parent) : null;
            case "get_children": return n.kids.map(wrapper);
            case "get_child": return n.kids[GD.num(args[0])] ? wrapper(n.kids[GD.num(args[0])]) : null;
            case "get_child_count": return n.kids.length;
            case "queue_free": case "free": r.freed = true; return null;
            case "hide": r.visible = false; return null;
            case "show": r.visible = true; return null;
            case "queue_redraw": r.dirty = true; return null;
            case "start": if (n.type === "Timer") { if (args.length) r.wait_time = GD.num(args[0]); r.time_left = r.wait_time; r.stopped = false; return null; } break;
            case "stop": if (n.type === "Timer") { r.stopped = true; return null; } break;
            case "is_stopped": return !!r.stopped;
            case "get_viewport_rect": return new GD.Rect2(new GD.Vec2(0, 0), new GD.Vec2(VW, VH));
            case "draw_rect": case "draw_circle": case "draw_line": {
              if (!r.recording) throw new GD.GDError("Drawing functions can only be called inside _draw().", 0);
              if (name === "draw_rect") r.recording.push({ op: "rect", r: args[0], c: args[1] || new GD.Color(1, 1, 1), filled: args[2] === undefined ? true : !!args[2] });
              if (name === "draw_circle") r.recording.push({ op: "circle", p: args[0], r: GD.num(args[1]), c: args[2] || new GD.Color(1, 1, 1) });
              if (name === "draw_line") r.recording.push({ op: "line", a: args[0], b: args[1], c: args[2] || new GD.Color(1, 1, 1), w: args[3] === undefined ? 1 : GD.num(args[3]) });
              return null;
            }
          }
          return undefined;
        },
      };
      let t = 0;
      const interp = new (function () {})();
      void interp;
      let world;
      const scripted = [];
      try {
        world = null;
        for (const n of nodes) {
          if (n.script === null) continue;
          const first = !world;
          const loaded = first ? GD.load(n.script, { output: (s) => print(s), host }) : GD.attach(world, n.script, { node: n });
          if (first) { world = loaded.interp; loaded.obj.native = { node: n }; }
          n.obj = loaded.obj; n.cls = loaded.cls;
          const ext = loaded.cls.decl.ext;
          if (ext && TYPES[ext] && !isA(n.type, ext)) throw new GD.GDError('Script inherits from "' + ext + '", so it can\'t be attached to "' + n.name + '", which is a ' + n.type + ".", 1);
          scripted.push(n);
        }
      } catch (e) {
        print(String(e.gdLine !== undefined ? e : e.message), "err"); nodes.forEach((n) => { n.rt = null; n.obj = null; }); paint(); return;
      }
      if (!world) { const loaded = GD.load("extends Node\n", { output: (s) => print(s), host }); world = loaded.interp; }
      // connections from the scene file
      for (const c of scene.conns) {
        const from = c.from === "." ? scene.root : resolve(scene.root, c.from);
        const to = c.to === "." ? scene.root : resolve(scene.root, c.to);
        if (!from || !to || !to.obj) continue;
        const sig = from.rt.signals[c.signal];
        const f = world.findFunc(to.cls, c.method);
        if (!sig) continue;
        if (!f) { print('Signal "' + c.signal + '" is connected to "' + c.method + '()", which ' + to.name + "'s script does not have.", "err"); continue; }
        sig.conns.push({ callable: new GD.Callable("method", { fn: f.fn, self: to.obj, cls: f.cls, name: c.method }) });
      }
      const call = (n, fname, args) => { if (n.obj && world.findFunc(n.cls, fname)) GD.call({ interp: world, obj: n.obj, cls: n.cls }, fname, args); };
      const errorOut = (e, n) => { print((n ? n.name.toLowerCase() + ".gd – " : "") + String(e.gdLine !== undefined ? e : e.message), "err"); stop(); };
      // _ready: children before their parents, as in Godot
      const post = []; const w = (n) => { n.kids.forEach(w); post.push(n); }; w(scene.root);
      let current = null;
      try {
        for (const n of post) { current = n; if (n.obj) { world.runOnready(n.obj); call(n, "_ready", []); } }
        for (const n of nodes) if (n.type === "Timer" && n.rt.autostart) { n.rt.time_left = n.rt.wait_time; n.rt.stopped = false; }
      } catch (e) { errorOut(e, current); return; }
      const KEY = { ArrowLeft: "ui_left", KeyA: "ui_left", ArrowRight: "ui_right", KeyD: "ui_right", ArrowUp: "ui_up", KeyW: "ui_up", ArrowDown: "ui_down", KeyS: "ui_down", Space: "ui_accept", Enter: "ui_accept" };
      const kd = (e) => { const a = KEY[e.code]; if (!a) return; e.preventDefault(); if (!input.down.has(a)) input.pressed.add(a); input.down.add(a); };
      const ku = (e) => { const a = KEY[e.code]; if (!a) return; e.preventDefault(); input.down.delete(a); input.released.add(a); };
      cv.addEventListener("keydown", kd); cv.addEventListener("keyup", ku);
      let last = performance.now(), live = true;
      running = {
        press(btn) { try { current = btn; world.emit(btn.rt.signals.pressed, []); } catch (e) { errorOut(e, btn); } },
        stop() { live = false; cv.removeEventListener("keydown", kd); cv.removeEventListener("keyup", ku); },
      };
      ws.querySelector('[data-act="stop"]').disabled = false;
      ws.classList.add("running");
      const frame = (now) => {
        if (!live) return;
        const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
        try {
          world.drainTimers(t);
          for (const n of nodes) {
            if (n.type !== "Timer" || n.rt.stopped || n.rt.freed) continue;
            n.rt.time_left -= dt;
            if (n.rt.time_left <= 0) { if (n.rt.one_shot) { n.rt.stopped = true; n.rt.time_left = 0; } else n.rt.time_left += n.rt.wait_time; current = n; world.emit(n.rt.signals.timeout, []); }
          }
          for (const n of nodes) { if (n.rt.freed) continue; current = n; call(n, "_physics_process", [GD.fl(1 / 60)]); call(n, "_process", [GD.fl(dt)]); }
          for (const n of nodes) {
            if (!n.obj || !n.rt.dirty || !world.findFunc(n.cls, "_draw")) continue;
            n.rt.dirty = false; n.rt.recording = []; current = n; call(n, "_draw", []); n.rt.draw = n.rt.recording; n.rt.recording = null;
          }
        } catch (e) { errorOut(e, current); return; }
        input.pressed.clear(); input.released.clear();
        paint();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      cv.focus({ preventScroll: true });
      if (matchMedia("(max-width: 900px)").matches) setM("view");
    }
    function stop() {
      if (running) { running.stop(); running = null; print("--- Stopped ---", "quiet"); }
      all().forEach((n) => { n.rt = null; n.obj = null; n.wrap = null; });
      ws.querySelector('[data-act="stop"]').disabled = true;
      ws.classList.remove("running");
      paint();
    }

    // ── Add node dialog
    const dlg = ws.querySelector(".ws-add");
    const fillAdd = (q) => {
      const ul = dlg.querySelector("ul"); ul.innerHTML = "";
      Object.keys(TYPES).filter((t) => t.toLowerCase().includes((q || "").toLowerCase())).forEach((t) => {
        const li = document.createElement("li"); const b = document.createElement("button"); b.type = "button"; b.className = "addtype";
        b.innerHTML = "<span class=\"ic\">" + TYPES[t].icon + "</span> <b>" + t + "</b><small>" + (TYPES[t].base ? " ← " + TYPES[t].base : "") + "</small>";
        b.addEventListener("click", () => {
          const parent = sel(); let name = t, i = 1; while (parent.kids.some((k) => k.name === name)) name = t + ++i;
          const n = mkNode(t, name); if (isControl(t) || is2D(t)) { /* keep defaults */ }
          parent.kids.push(n); selId = n.id; dlg.close(); refresh();
        });
        li.append(b); ul.append(li);
      });
    };
    dlg.querySelector("input").addEventListener("input", (e) => fillAdd(e.target.value));

    ws.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const act = b.getAttribute("data-act");
      if (b.getAttribute("data-tab")) { tab = b.getAttribute("data-tab"); refresh(); return; }
      if (b.getAttribute("data-r")) { ws.querySelectorAll(".ws-rtabs button").forEach((x) => x.classList.toggle("on", x === b)); ws.querySelector(".insp").hidden = b.getAttribute("data-r") !== "insp"; ws.querySelector(".node").hidden = b.getAttribute("data-r") !== "node"; return; }
      if (b.getAttribute("data-b")) { ws.querySelectorAll(".ws-btabs button").forEach((x) => x.classList.toggle("on", x === b)); ws.querySelector(".ws-bottom").setAttribute("data-b", b.getAttribute("data-b")); return; }
      if (b.getAttribute("data-m")) { setM(b.getAttribute("data-m")); return; }
      switch (act) {
        case "run": run(); break;
        case "stop": stop(); break;
        case "add": fillAdd(""); dlg.querySelector("input").value = ""; if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); break;
        case "del": del(); break;
        case "dup": { const n = sel(); if (!n.parent) return; const copy = JSON.parse(JSON.stringify(n, (k, v) => (k === "parent" || k === "rt" || k === "obj" || k === "wrap" || k === "cls" ? undefined : v))); const re = (x) => { x.id = uid++; x.kids.forEach(re); }; re(copy); copy.name = n.name + "2"; n.parent.kids.push(copy); selId = copy.id; refresh(); break; }
        case "script": { const n = sel(); if (n.script === null) n.script = TEMPLATE(n.type); tab = "Script"; refresh(); break; }
        case "open": tab = "Script"; refresh(); break;
        case "detach": { const n = sel(); if (confirm("Detach the script from " + n.name + "?")) { n.script = null; refresh(); } break; }
        case "reset": if (confirm("Throw this scene away and start from the example again?")) { stop(); store.del("workshop"); scene = starter(); selId = scene.root.kids[0].id; tab = "2D"; refresh(); } break;
      }
    });
    function setM(m) { ws.querySelector(".ws-body").setAttribute("data-m", m); ws.querySelectorAll(".ws-mtabs button").forEach((x) => x.classList.toggle("on", x.getAttribute("data-m") === m)); }
    document.addEventListener("keydown", (e) => {
      if (!document.body.contains(ws)) return;
      if (e.key === "F5") { e.preventDefault(); run(); }
      if (e.key === "F8") { e.preventDefault(); stop(); }
    });
    ws.querySelector(".ws-bottom").setAttribute("data-b", "out");
    refresh();
    return { run, stop, scene: () => scene };
  }

  window.Workshop = { mount, tscn, TYPES };
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("[data-workshop]").forEach((el) => mount(el)));
})();
