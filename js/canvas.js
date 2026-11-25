/* canvas.js – a stand-in for one Godot Node2D, for the exercises that move
 * and draw things.
 *
 * Your script is the node. It has position, rotation, scale, visible and
 * modulate; _ready() runs once, _process(delta) and _physics_process(delta)
 * every frame, and _draw() runs when it first appears and again only after
 * queue_redraw() – exactly as in Godot, where a drawing is kept until you ask
 * for a new one and moving the node moves the drawing without redrawing it.
 *
 * Input: the arrow keys or WASD are ui_left/ui_right/ui_up/ui_down, Space and
 * Enter are ui_accept (Space is also "jump"), and the on-screen buttons do the
 * same on a phone. The viewport is 320x180, drawn twice size or more, pixel
 * for pixel.
 */
(function (root) {
  "use strict";
  const GD = root.GD;
  const W = 320, H = 180;
  const KEYMAP = {
    ArrowLeft: ["ui_left", "move_left"], KeyA: ["ui_left", "move_left"],
    ArrowRight: ["ui_right", "move_right"], KeyD: ["ui_right", "move_right"],
    ArrowUp: ["ui_up", "move_up"], KeyW: ["ui_up", "move_up"],
    ArrowDown: ["ui_down", "move_down"], KeyS: ["ui_down", "move_down"],
    Space: ["ui_accept", "jump"], Enter: ["ui_accept"],
  };
  const KEYCODES = { ArrowLeft: 4194319, ArrowUp: 4194320, ArrowRight: 4194321, ArrowDown: 4194322, Space: 32, Enter: 4194309 };

  function makeHost() {
    const input = { down: new Set(), pressed: new Set(), released: new Set(), keys: new Set(), mouse: new GD.Vec2(0, 0), mouseDown: false };
    const fl = GD.fl;
    const host = { input, time: 0, frame: 0 };
    const Input = {
      __native: "Input",
      is_action_pressed: (a) => input.down.has(a),
      is_action_just_pressed: (a) => input.pressed.has(a),
      is_action_just_released: (a) => input.released.has(a),
      get_axis: (neg, pos) => fl((input.down.has(pos) ? 1 : 0) - (input.down.has(neg) ? 1 : 0)),
      get_vector: (l, r, u, d) => {
        let x = (input.down.has(r) ? 1 : 0) - (input.down.has(l) ? 1 : 0);
        let y = (input.down.has(d) ? 1 : 0) - (input.down.has(u) ? 1 : 0);
        const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
        return new GD.Vec2(x, y);
      },
      is_key_pressed: (k) => input.keys.has(GD.num(k)),
      is_mouse_button_pressed: () => input.mouseDown,
      get_action_strength: (a) => fl(input.down.has(a) ? 1 : 0),
    };
    host.globals = {
      Input,
      Time: { __native: "Time", get_ticks_msec: () => Math.round(host.time * 1000), get_ticks_usec: () => Math.round(host.time * 1e6) },
      ThemeDB: { __native: "ThemeDB", fallback_font: { __native: "Font" } },
    };
    host.makeNative = (obj) => {
      obj.native = {
        position: new GD.Vec2(W / 2, H / 2), rotation: 0, scale: new GD.Vec2(1, 1), visible: true,
        modulate: new GD.Color(1, 1, 1, 1), name: "Player", z_index: 0, draw: null, dirty: true, processing: true,
      };
    };
    const PROPS = ["position", "rotation", "scale", "visible", "modulate", "name", "z_index", "global_position", "rotation_degrees"];
    host.getNative = (obj, name) => {
      const n = obj.native; if (!n || !n.position) return undefined;
      switch (name) {
        case "position": case "global_position": return n.position;
        case "rotation": return fl(n.rotation);
        case "rotation_degrees": return fl(n.rotation * 180 / Math.PI);
        case "scale": return n.scale;
        case "visible": return n.visible;
        case "modulate": return n.modulate;
        case "name": return n.name;
        case "z_index": return n.z_index;
      }
      return undefined;
    };
    host.setNative = (obj, name, v) => {
      const n = obj.native; if (!n || !n.position || !PROPS.includes(name)) return false;
      switch (name) {
        case "position": case "global_position": n.position = v; break;
        case "rotation": n.rotation = GD.num(v); break;
        case "rotation_degrees": n.rotation = GD.num(v) * Math.PI / 180; break;
        case "scale": n.scale = v; break;
        case "visible": n.visible = !!v; break;
        case "modulate": n.modulate = v; break;
        case "name": n.name = String(v); break;
        case "z_index": n.z_index = GD.num(v); break;
      }
      return true;
    };
    host.callNative = (obj, name, args) => {
      const n = obj.native; if (!n || !n.position) return undefined;
      const list = n.recording;
      const rec = (op) => { if (!list) throw new GD.GDError("Drawing functions can only be called inside _draw(). Call queue_redraw() to ask for a new drawing.", 0); list.push(op); return null; };
      switch (name) {
        case "queue_redraw": n.dirty = true; return null;
        case "draw_rect": return rec({ op: "rect", r: args[0], c: args[1] || new GD.Color(1, 1, 1), filled: args[2] === undefined ? true : !!args[2], w: args[3] === undefined ? 1 : GD.num(args[3]) });
        case "draw_circle": return rec({ op: "circle", p: args[0], r: GD.num(args[1]), c: args[2] || new GD.Color(1, 1, 1) });
        case "draw_line": return rec({ op: "line", a: args[0], b: args[1], c: args[2] || new GD.Color(1, 1, 1), w: args[3] === undefined ? 1 : GD.num(args[3]) });
        case "draw_arc": return rec({ op: "arc", p: args[0], r: GD.num(args[1]), a0: GD.num(args[2]), a1: GD.num(args[3]), c: args[5] || new GD.Color(1, 1, 1), w: args[6] === undefined ? 1 : GD.num(args[6]) });
        case "draw_string": return rec({ op: "text", p: args[1], t: GD.str(args[2]), size: args[5] === undefined ? 16 : GD.num(args[5]), c: args[6] || new GD.Color(1, 1, 1) });
        case "draw_polygon": case "draw_colored_polygon": return rec({ op: "poly", pts: args[0], c: Array.isArray(args[1]) ? args[1][0] : args[1] });
        case "get_viewport_rect": return new GD.Rect2(new GD.Vec2(0, 0), new GD.Vec2(W, H));
        case "get_global_mouse_position": case "get_local_mouse_position": return input.mouse;
        case "set_process": n.processing = !!args[0]; return null;
        case "is_processing": return n.processing;
        case "translate": n.position = new GD.Vec2(n.position.x + args[0].x, n.position.y + args[0].y); return null;
        case "rotate": n.rotation += GD.num(args[0]); return null;
        case "look_at": n.rotation = Math.atan2(args[0].y - n.position.y, args[0].x - n.position.x); return null;
        case "get_name": return n.name;
        case "is_inside_tree": return true;
      }
      return undefined;
    };
    host.nativeIs = (v, type) => ["Node", "Node2D", "CanvasItem", "Object"].includes(type);
    return host;
  }

  // one frame of the game loop: the same order Godot uses
  function frame(loaded, delta) {
    const { interp, obj, cls } = loaded;
    const host = interp.host;
    host.time += delta; host.frame++;
    interp.drainTimers(host.time);
    if (obj.native.processing) {
      const pp = interp.findFunc(cls, "_physics_process");
      if (pp) GD.call(loaded, "_physics_process", [GD.fl(delta)]);
      const p = interp.findFunc(cls, "_process");
      if (p) GD.call(loaded, "_process", [GD.fl(delta)]);
    }
    host.input.pressed.clear(); host.input.released.clear();
    if (obj.native.dirty) redraw(loaded);
  }
  function redraw(loaded) {
    const n = loaded.obj.native;
    n.dirty = false;
    if (!loaded.interp.findFunc(loaded.cls, "_draw")) { n.draw = []; return; }
    n.recording = [];
    try { GD.call(loaded, "_draw", []); } finally { n.draw = n.recording; n.recording = null; }
  }

  function paint(ctx, loaded) {
    const n = loaded.obj.native;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#4d4d4d"; // Godot's default clear colour
    ctx.fillRect(0, 0, W, H);
    if (!n.visible || !n.draw) return;
    ctx.translate(Math.round(n.position.x), Math.round(n.position.y));
    ctx.rotate(n.rotation);
    ctx.scale(n.scale.x, n.scale.y);
    const mod = n.modulate;
    const css = (c) => new GD.Color(c.r * mod.r, c.g * mod.g, c.b * mod.b, c.a * mod.a).css();
    for (const d of n.draw) {
      if (d.op === "rect") {
        const r = d.r;
        if (d.filled) { ctx.fillStyle = css(d.c); ctx.fillRect(r.position.x, r.position.y, r.size.x, r.size.y); }
        else { ctx.strokeStyle = css(d.c); ctx.lineWidth = d.w; ctx.strokeRect(r.position.x + d.w / 2, r.position.y + d.w / 2, r.size.x - d.w, r.size.y - d.w); }
      } else if (d.op === "circle") {
        ctx.fillStyle = css(d.c); ctx.beginPath(); ctx.arc(d.p.x, d.p.y, d.r, 0, Math.PI * 2); ctx.fill();
      } else if (d.op === "line") {
        ctx.strokeStyle = css(d.c); ctx.lineWidth = d.w; ctx.beginPath(); ctx.moveTo(d.a.x, d.a.y); ctx.lineTo(d.b.x, d.b.y); ctx.stroke();
      } else if (d.op === "arc") {
        ctx.strokeStyle = css(d.c); ctx.lineWidth = d.w; ctx.beginPath(); ctx.arc(d.p.x, d.p.y, d.r, d.a0, d.a1); ctx.stroke();
      } else if (d.op === "text") {
        ctx.fillStyle = css(d.c); ctx.font = d.size + 'px "JetBrains Mono", monospace'; ctx.fillText(d.t, d.p.x, d.p.y);
      } else if (d.op === "poly" && d.pts.length) {
        ctx.fillStyle = css(d.c); ctx.beginPath(); ctx.moveTo(d.pts[0].x, d.pts[0].y);
        for (const p of d.pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
      }
    }
  }

  // opts.quiet: do not take the keyboard – for a view that restarts while the
  // reader is still typing in the editor beside it.
  function play(stageHost, code, outEl, markLine, opts) {
    stageHost.innerHTML = "";
    const wrap = document.createElement("div"); wrap.className = "stage";
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; cv.tabIndex = 0;
    cv.setAttribute("aria-label", "Game view. Click it, then use the arrow keys.");
    const pad = document.createElement("div"); pad.className = "pad";
    pad.innerHTML = '<button type="button" data-a="ui_left" aria-label="Left">◀</button><button type="button" data-a="ui_up" aria-label="Up">▲</button>' +
      '<button type="button" data-a="ui_down" aria-label="Down">▼</button><button type="button" data-a="ui_right" aria-label="Right">▶</button>' +
      '<button type="button" data-a="ui_accept" class="a" aria-label="Accept">A</button><button type="button" class="stop" aria-label="Stop">■</button>';
    const tip = document.createElement("p"); tip.className = "stage-tip"; tip.textContent = "Click the game, then use the arrow keys or WASD. Space is ui_accept.";
    wrap.append(cv, pad); stageHost.append(wrap, tip);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    outEl.innerHTML = ""; outEl.hidden = false;
    let lines = 0;
    const print = (s) => {
      if (lines++ > 300) return;
      const d = document.createElement("div"); d.className = "ln"; d.textContent = s || " "; outEl.append(d);
      outEl.scrollTop = outEl.scrollHeight;
    };
    const host = makeHost();
    const r = GD.run(code, { output: print, host, drain: false });
    if (r.error) {
      const d = document.createElement("div"); d.className = "ln err"; d.textContent = String(r.error); outEl.append(d);
      if (markLine) markLine(r.error.gdLine);
      return { stop() {} };
    }
    const loaded = r.loaded;
    let running = true, last = performance.now();
    const fail = (e) => {
      running = false;
      const d = document.createElement("div"); d.className = "ln err"; d.textContent = String(e.gdLine !== undefined ? e : e.message); outEl.append(d);
      if (markLine && e.gdLine) markLine(e.gdLine);
    };
    try { redraw(loaded); } catch (e) { fail(e); }
    const down = (acts) => acts.forEach((a) => { if (!host.input.down.has(a)) host.input.pressed.add(a); host.input.down.add(a); });
    const up = (acts) => acts.forEach((a) => { if (host.input.down.has(a)) host.input.released.add(a); host.input.down.delete(a); });
    const kd = (e) => { const a = KEYMAP[e.code]; if (KEYCODES[e.code]) host.input.keys.add(KEYCODES[e.code]); if (a) { e.preventDefault(); down(a); } };
    const ku = (e) => { const a = KEYMAP[e.code]; host.input.keys.delete(KEYCODES[e.code]); if (a) { e.preventDefault(); up(a); } };
    cv.addEventListener("keydown", kd); cv.addEventListener("keyup", ku);
    cv.addEventListener("blur", () => { up([...host.input.down]); });
    const toLogical = (e) => { const b = cv.getBoundingClientRect(); return new GD.Vec2((e.clientX - b.left) / b.width * W, (e.clientY - b.top) / b.height * H); };
    cv.addEventListener("pointermove", (e) => { host.input.mouse = toLogical(e); });
    cv.addEventListener("pointerdown", (e) => { cv.focus(); host.input.mouse = toLogical(e); host.input.mouseDown = true; });
    cv.addEventListener("pointerup", () => { host.input.mouseDown = false; });
    pad.querySelectorAll("button[data-a]").forEach((b) => {
      const a = b.getAttribute("data-a");
      const acts = a === "ui_accept" ? ["ui_accept", "jump"] : [a, a.replace("ui_", "move_")];
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); down(acts); });
      b.addEventListener("pointerup", () => up(acts));
      b.addEventListener("pointercancel", () => up(acts));
    });
    const stopBtn = pad.querySelector(".stop");
    const api = { stop() { running = false; stopBtn.disabled = true; } };
    stopBtn.addEventListener("click", () => api.stop());
    const tick = (now) => {
      if (!running || !document.body.contains(cv)) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      try { frame(loaded, dt); paint(ctx, loaded); } catch (e) { fail(e); return; }
      requestAnimationFrame(tick);
    };
    paint(ctx, loaded);
    requestAnimationFrame(tick);
    if (!(opts && opts.quiet)) cv.focus({ preventScroll: true });
    return api;
  }

  // For Check: no canvas, a fixed 60 frames a second, and input that is held
  // down on purpose.
  function simulate(loaded, sim) {
    const host = loaded.interp.host;
    const frames = sim.frames || 60;
    const dt = sim.delta || 1 / 60;
    const hold = sim.hold || [];
    for (let i = 0; i < frames; i++) {
      for (const a of hold) { if (!host.input.down.has(a)) host.input.pressed.add(a); host.input.down.add(a); }
      if (sim.tap && sim.tap.at === i) { host.input.down.add(sim.tap.action); host.input.pressed.add(sim.tap.action); }
      if (sim.tap && sim.tap.at === i - 1) { host.input.down.delete(sim.tap.action); host.input.released.add(sim.tap.action); }
      frame(loaded, dt);
    }
    for (const a of hold) { host.input.down.delete(a); }
  }

  root.CanvasHost = {
    play, simulate, W, H,
    forCheck() { return makeHost(); },
    redraw,
  };
})(typeof window !== "undefined" ? window : globalThis);
