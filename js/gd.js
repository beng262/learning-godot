/* gd.js – a small GDScript interpreter for the book.
 *
 * Real Godot cannot run in a web page, so the exercises run on this: a subset
 * of GDScript 4 that behaves the way the engine does where it matters for
 * learning – int and float are different (5 / 2 is 2), arrays and dictionaries
 * are shared by reference while Vector2 is copied, lambdas capture by value,
 * "String" + 1 is an error, signals connect and emit, and `await` really
 * suspends a function until the signal or timer arrives.
 *
 * What it is not: the engine. There is no physics, no scene file loader and no
 * renderer here; the pages that need those (the canvas sandbox, the workshop)
 * provide a small stand-in through the `host` hooks.
 *
 *   const run = GD.run(source, {output: line => ..., host: {...}})
 *
 * Works in the browser (window.GD) and in Node (require('./gd.js')), which is
 * how tools/check.js proves every exercise in the book can be solved.
 */
(function (root) {
  "use strict";

  // ───────────────────────────── errors ─────────────────────────────
  class GDError extends Error {
    constructor(msg, line) {
      super(msg);
      this.gdLine = line || 0;
    }
    toString() {
      return (this.gdLine ? "Line " + this.gdLine + ": " : "") + this.message;
    }
  }
  const fail = (msg, line) => { throw new GDError(msg, line); };

  // ───────────────────────────── values ─────────────────────────────
  // int is a plain JS number holding an integer; float is wrapped, because
  // 2 and 2.0 are different values in GDScript and print differently.
  class F { constructor(v) { this.v = v; } }
  const fl = (v) => new F(v);
  const isInt = (x) => typeof x === "number";
  const isFloat = (x) => x instanceof F;
  const isNum = (x) => typeof x === "number" || x instanceof F;
  const num = (x) => (x instanceof F ? x.v : x);
  const toInt = (n) => { const t = Math.trunc(n); return Object.is(t, -0) ? 0 : t; };

  class Vec2 {
    constructor(x, y, isI) { this.x = x; this.y = y; this.i = !!isI; }
    with(k, v) {
      const n = num(v);
      if (k === "x") return new Vec2(this.i ? toInt(n) : n, this.y, this.i);
      if (k === "y") return new Vec2(this.x, this.i ? toInt(n) : n, this.i);
      fail('Invalid assignment of property "' + k + '" on Vector2.');
    }
  }
  class Rect2 {
    constructor(p, s) { this.position = p; this.size = s; }
    get end() { return new Vec2(this.position.x + this.size.x, this.position.y + this.size.y); }
    with(k, v) {
      if (k === "position") return new Rect2(v, this.size);
      if (k === "size") return new Rect2(this.position, v);
      if (k === "end") return new Rect2(this.position, new Vec2(v.x - this.position.x, v.y - this.position.y));
      fail('Invalid assignment of property "' + k + '" on Rect2.');
    }
  }
  class Color {
    constructor(r, g, b, a) { this.r = r; this.g = g; this.b = b; this.a = a === undefined ? 1 : a; }
    with(k, v) {
      const c = new Color(this.r, this.g, this.b, this.a);
      if ("rgba".includes(k) && k.length === 1) { c[k] = num(v); return c; }
      fail('Invalid assignment of property "' + k + '" on Color.');
    }
    css() {
      const q = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255);
      return "rgba(" + q(this.r) + "," + q(this.g) + "," + q(this.b) + "," + Math.max(0, Math.min(1, this.a)) + ")";
    }
  }
  const NAMED_COLORS = {
    WHITE: [1, 1, 1], BLACK: [0, 0, 0], RED: [1, 0, 0], GREEN: [0, 1, 0], BLUE: [0, 0, 1],
    YELLOW: [1, 1, 0], CYAN: [0, 1, 1], MAGENTA: [1, 0, 1], ORANGE: [1, 0.65, 0], PINK: [1, 0.75, 0.8],
    PURPLE: [0.63, 0.13, 0.94], GRAY: [0.75, 0.75, 0.75], DARK_GRAY: [0.66, 0.66, 0.66],
    BROWN: [0.65, 0.16, 0.16], HOT_PINK: [1, 0.41, 0.71], SKY_BLUE: [0.53, 0.81, 0.92],
    LIME_GREEN: [0.2, 0.8, 0.2], GOLD: [1, 0.84, 0], CORAL: [1, 0.5, 0.31], TEAL: [0, 0.5, 0.5],
    TRANSPARENT: [1, 1, 1, 0], NAVY_BLUE: [0, 0, 0.5], SALMON: [0.98, 0.5, 0.45],
  };
  function colorFromHex(s, line) {
    let h = String(s).replace(/^#/, "");
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) {
      const up = String(s).toUpperCase().replace(/ /g, "_");
      if (NAMED_COLORS[up]) { const c = NAMED_COLORS[up]; return new Color(c[0], c[1], c[2], c[3]); }
      fail('Invalid color code: "' + s + '".', line);
    }
    const p = (i) => parseInt(h.substr(i, 2), 16) / 255;
    return new Color(p(0), p(2), p(4), h.length === 8 ? p(6) : 1);
  }

  class Callable {
    constructor(kind, data) { this.kind = kind; Object.assign(this, data); }
  }
  class GDSignal {
    constructor(name, owner) { this.name = name; this.owner = owner; this.conns = []; this.awaiters = []; }
  }
  class Pending { constructor(task) { this.task = task; } }

  // A script class: the file itself, or an inner `class Foo:`.
  class GDClass {
    constructor(name, decl, outer, interp) {
      this.name = name; this.decl = decl; this.outer = outer; this.interp = interp;
      this.members = []; this.funcs = {}; this.consts = new Map(); this.signals = [];
      this.inner = {}; this.base = null; this.nativeBase = "RefCounted"; this.statics = new Map();
    }
  }
  let nextId = 1000;
  class GDObject {
    constructor(cls) {
      this.cls = cls; this.fields = new Map(); this.id = nextId++;
      this.signals = {}; this.native = {};
    }
  }

  // ───────────────────────────── lexer ─────────────────────────────
  const KEYWORDS = new Set(["if", "elif", "else", "for", "while", "match", "break", "continue", "pass",
    "return", "class", "class_name", "extends", "is", "in", "as", "self", "signal", "func", "static",
    "const", "enum", "var", "await", "and", "or", "not", "true", "false", "null", "super", "when"]);
  const OPS = ["**=", "<<=", ">>=", "**", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=",
    "^=", "->", "&&", "||", "<<", ">>", ":=", "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]",
    "{", "}", ",", ".", ":", "!", "&", "|", "^", "~", ";"];

  function lex(src) {
    const toks = [];
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    const indents = [0];
    let depth = 0; // bracket depth: newlines inside brackets are ignored
    let i = 0, line = 1;
    const s = lines.join("\n");
    let atLineStart = true;
    const push = (t, v, extra) => toks.push(Object.assign({ t, v, line }, extra || {}));
    while (i < s.length) {
      if (atLineStart && depth === 0) {
        // measure indentation; skip blank and comment-only lines
        let j = i, w = 0;
        while (j < s.length && (s[j] === " " || s[j] === "\t")) { w += s[j] === "\t" ? 4 : 1; j++; }
        if (j >= s.length) { i = j; break; }
        if (s[j] === "\n") { i = j + 1; line++; continue; }
        if (s[j] === "#") { while (j < s.length && s[j] !== "\n") j++; i = j; continue; }
        if (w > indents[indents.length - 1]) { indents.push(w); push("INDENT"); }
        else {
          while (w < indents[indents.length - 1]) { indents.pop(); push("DEDENT"); }
          if (w !== indents[indents.length - 1]) fail("Unindent doesn't match the previous indentation level.", line);
        }
        i = j; atLineStart = false; continue;
      }
      const c = s[i];
      if (c === "\n") {
        line++; i++;
        if (depth === 0) {
          if (toks.length && toks[toks.length - 1].t !== "NEWLINE") push("NEWLINE");
          atLineStart = true;
        }
        continue;
      }
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "\\" && s[i + 1] === "\n") { i += 2; line++; continue; }
      if (c === "#") { while (i < s.length && s[i] !== "\n") i++; continue; }
      // strings: "x", 'x', """x""", &"name", ^"path"
      if (c === '"' || c === "'" || ((c === "&" || c === "^") && (s[i + 1] === '"' || s[i + 1] === "'"))) {
        if (c === "&" || c === "^") i++;
        const q = s[i];
        const triple = s.substr(i, 3) === q + q + q;
        i += triple ? 3 : 1;
        let out = "";
        const startLine = line;
        while (true) {
          if (i >= s.length) fail("Unterminated string.", startLine);
          if (triple ? s.substr(i, 3) === q + q + q : s[i] === q) { i += triple ? 3 : 1; break; }
          if (s[i] === "\n") { if (!triple) fail("Unterminated string.", startLine); line++; }
          if (s[i] === "\\") {
            const e = s[i + 1];
            const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "0": "\0" };
            if (e === "u") { out += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue; }
            out += map[e] !== undefined ? map[e] : e; i += 2; continue;
          }
          out += s[i]; i++;
        }
        push("STR", out); continue;
      }
      // numbers
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
        let j = i;
        if (c === "0" && (s[i + 1] === "x" || s[i + 1] === "X")) {
          j += 2; while (/[0-9a-fA-F_]/.test(s[j] || "")) j++;
          push("INT", parseInt(s.slice(i + 2, j).replace(/_/g, ""), 16)); i = j; continue;
        }
        if (c === "0" && (s[i + 1] === "b" || s[i + 1] === "B")) {
          j += 2; while (/[01_]/.test(s[j] || "")) j++;
          push("INT", parseInt(s.slice(i + 2, j).replace(/_/g, ""), 2)); i = j; continue;
        }
        let isF = false;
        while (/[0-9_]/.test(s[j] || "")) j++;
        if (s[j] === "." && /[0-9]/.test(s[j + 1] || "")) { isF = true; j++; while (/[0-9_]/.test(s[j] || "")) j++; }
        else if (s[j] === "." && !/[a-zA-Z_]/.test(s[j + 1] || "")) { isF = true; j++; }
        if ((s[j] === "e" || s[j] === "E") && /[-+0-9]/.test(s[j + 1] || "")) {
          isF = true; j++; if (s[j] === "-" || s[j] === "+") j++; while (/[0-9]/.test(s[j] || "")) j++;
        }
        const txt = s.slice(i, j).replace(/_/g, "");
        push(isF ? "FLOAT" : "INT", isF ? parseFloat(txt) : parseInt(txt, 10)); i = j; continue;
      }
      // $Node, $"Path/To", %Unique
      if (c === "$" || (c === "%" && /[A-Za-z_"]/.test(s[i + 1] || "") && prevAllowsOperand(toks))) {
        let j = i + 1, path;
        if (s[j] === '"') { const k = s.indexOf('"', j + 1); path = s.slice(j + 1, k); j = k + 1; }
        // A dot ends the path ($Score.text is the text of Score), except in a
        // ".." segment ($../Sibling).
        else {
          for (;;) {
            if (s[j] === "." && s[j + 1] === "." && (j === i + 1 || s[j - 1] === "/")) j += 2;
            else if (/[A-Za-z0-9_\/]/.test(s[j] || "")) j++;
            else break;
          }
          path = s.slice(i + 1, j);
        }
        push("NODE", (c === "%" ? "%" : "") + path); i = j; continue;
      }
      if (c === "@") {
        let j = i + 1; while (/[A-Za-z0-9_]/.test(s[j] || "")) j++;
        push("ANNOT", s.slice(i + 1, j)); i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (/[A-Za-z0-9_]/.test(s[j] || "")) j++;
        const w = s.slice(i, j);
        push(KEYWORDS.has(w) ? "KW" : "NAME", w); i = j; continue;
      }
      const op = OPS.find((o) => s.startsWith(o, i));
      if (op) {
        if ("([{".includes(op)) depth++;
        if (")]}".includes(op)) depth = Math.max(0, depth - 1);
        push("OP", op); i += op.length; continue;
      }
      fail('Unexpected character "' + c + '".', line);
    }
    if (toks.length && toks[toks.length - 1].t !== "NEWLINE") push("NEWLINE");
    while (indents.length > 1) { indents.pop(); push("DEDENT"); }
    push("EOF");
    return toks;
  }
  function prevAllowsOperand(toks) {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === "OP") return !")]}".includes(p.v);
    if (p.t === "KW") return !["true", "false", "null", "self"].includes(p.v);
    return p.t === "NEWLINE" || p.t === "INDENT" || p.t === "DEDENT";
  }

  // ───────────────────────────── parser ─────────────────────────────
  function parse(src) {
    const toks = lex(src);
    let p = 0;
    const peek = (o) => toks[p + (o || 0)];
    const at = (t, v) => { const k = toks[p]; return k.t === t && (v === undefined || k.v === v); };
    const atOp = (v) => at("OP", v);
    const atKw = (v) => at("KW", v);
    const next = () => toks[p++];
    const expect = (t, v, what) => {
      if (at(t, v)) return next();
      const k = toks[p];
      const got = k.t === "NEWLINE" ? "end of line" : k.t === "EOF" ? "end of file" : k.t === "INDENT" ? "an indented block" :
        k.t === "DEDENT" ? "end of block" : '"' + k.v + '"';
      fail(what || 'Expected "' + (v || t) + '", found ' + got + ".", k.line);
    };
    const skipNewlines = () => { while (at("NEWLINE") || at("OP", ";")) next(); };

    function parseType() {
      // Name, Name.Inner, Array[int], Dictionary[String, int]
      let name = expect("NAME", undefined, "Expected a type name.").v;
      while (atOp(".")) { next(); name += "." + expect("NAME").v; }
      if (atOp("[")) {
        next(); parseType(); if (atOp(",")) { next(); parseType(); } expect("OP", "]");
      }
      return name;
    }

    function parseClassBody(cls, untilDedent) {
      const body = { t: "Class", name: cls, ext: null, className: null, items: [] };
      skipNewlines();
      let annots = [];
      while (!at("EOF") && !(untilDedent && at("DEDENT"))) {
        const k = peek();
        if (k.t === "ANNOT") {
          next(); const a = { name: k.v, line: k.line };
          if (atOp("(")) { next(); let d = 1; while (d > 0 && !at("EOF")) { const q = next(); if (q.v === "(") d++; if (q.v === ")") d--; } }
          annots.push(a);
          if (at("NEWLINE")) next();
          continue;
        }
        if (atKw("extends")) {
          next(); let n = at("STR") ? next().v : expect("NAME").v;
          while (atOp(".")) { next(); n += "." + expect("NAME").v; }
          body.ext = n; endStmt(); continue;
        }
        if (atKw("class_name")) {
          next(); body.className = expect("NAME").v;
          if (atKw("extends")) { next(); body.ext = expect("NAME").v; }
          endStmt(); continue;
        }
        if (atKw("signal")) {
          next(); const n = expect("NAME").v; const params = [];
          if (atOp("(")) {
            next();
            while (!atOp(")")) { params.push(expect("NAME").v); if (atOp(":")) { next(); parseType(); } if (atOp(",")) next(); }
            next();
          }
          body.items.push({ t: "Signal", name: n, params, line: k.line }); endStmt(); continue;
        }
        if (atKw("var")) {
          const v = parseVar(); v.annots = annots.map((a) => a.name); annots = [];
          body.items.push(v); endStmt(); continue;
        }
        if (atKw("const")) { body.items.push(parseConst()); endStmt(); continue; }
        if (atKw("enum")) { body.items.push(parseEnum()); endStmt(); continue; }
        if (atKw("static") || atKw("func")) {
          let isStatic = false;
          if (atKw("static")) { next(); isStatic = true; }
          if (atKw("var")) { const v = parseVar(); v.isStatic = true; body.items.push(v); endStmt(); continue; }
          const f = parseFunc(); f.isStatic = isStatic; body.items.push(f); annots = []; continue;
        }
        if (atKw("class")) {
          next(); const n = expect("NAME").v;
          let ext = null;
          if (atKw("extends")) { next(); ext = expect("NAME").v; while (atOp(".")) { next(); ext += "." + expect("NAME").v; } }
          expect("OP", ":"); expect("NEWLINE", undefined, 'Expected a new line after "class ' + n + ':".');
          expect("INDENT", undefined, "Expected an indented block for class " + n + ".");
          const inner = parseClassBody(n, true); inner.ext = inner.ext || ext; inner.line = k.line;
          expect("DEDENT"); body.items.push({ t: "InnerClass", decl: inner, line: k.line }); skipNewlines(); continue;
        }
        if (at("NEWLINE")) { next(); continue; }
        fail('Unexpected "' + k.v + '" in class body. Only var, const, func, signal, enum and class can be declared here.', k.line);
      }
      return body;
    }
    function endStmt() {
      if (atOp(";")) next();
      if (at("NEWLINE")) { next(); return; }
      if (at("EOF") || at("DEDENT")) return;
      fail('Expected end of statement, found "' + peek().v + '".', peek().line);
    }
    function parseVar() {
      const line = next().line; // var
      const name = expect("NAME", undefined, 'Expected a variable name after "var".').v;
      let type = null, value = null, infer = false;
      if (atOp(":=")) { next(); infer = true; value = parseExpr(); }
      else {
        if (atOp(":")) { next(); type = parseType(); }
        if (atOp("=")) { next(); value = parseExpr(); }
      }
      // setget-style property blocks are not supported; say so clearly
      if (atOp(":")) fail("Property getters and setters are not supported in the book's runner.", line);
      return { t: "Var", name, type, value, infer, line };
    }
    function parseConst() {
      const line = next().line;
      const name = expect("NAME").v;
      if (atOp(":")) { next(); parseType(); }
      if (atOp(":=")) next(); else expect("OP", "=", 'Expected "=" after constant name.');
      return { t: "Const", name, value: parseExpr(), line };
    }
    function parseEnum() {
      const line = next().line;
      let name = null;
      if (at("NAME")) name = next().v;
      expect("OP", "{");
      const keys = []; let n = 0;
      while (!atOp("}")) {
        const k = expect("NAME").v;
        if (atOp("=")) { next(); const v = parseExpr(); keys.push([k, v]); n = null; }
        else keys.push([k, null]);
        if (atOp(",")) next();
      }
      next();
      return { t: "Enum", name, keys, line };
    }
    function parseParams() {
      expect("OP", "(");
      const params = [];
      while (!atOp(")")) {
        const pn = expect("NAME", undefined, "Expected a parameter name.").v;
        let type = null, def = null;
        if (atOp(":=")) { next(); def = parseExpr(); }
        else {
          if (atOp(":")) { next(); type = parseType(); }
          if (atOp("=")) { next(); def = parseExpr(); }
        }
        params.push({ name: pn, type, def });
        if (atOp(",")) next(); else if (!atOp(")")) fail('Expected "," or ")" after parameter.', peek().line);
      }
      next();
      return params;
    }
    function parseFunc() {
      const line = next().line; // func
      const name = expect("NAME", undefined, 'Expected a function name after "func".').v;
      const params = parseParams();
      let ret = null;
      if (atOp("->")) { next(); ret = parseType(); }
      expect("OP", ":", 'Expected ":" after the function declaration.');
      const body = parseBlock();
      return { t: "Func", name, params, ret, body, line };
    }
    function parseBlock() {
      if (!at("NEWLINE")) {
        // one-liner: `if x: return 1`
        const st = parseSimpleStmtLine();
        return st;
      }
      next();
      if (!at("INDENT")) fail("Expected an indented block.", peek().line);
      next();
      const out = [];
      while (!at("DEDENT") && !at("EOF")) {
        if (at("NEWLINE")) { next(); continue; }
        out.push(...parseStatement());
      }
      expect("DEDENT");
      return out;
    }
    function parseSimpleStmtLine() {
      const out = [parseSimpleStmt()];
      while (atOp(";")) { next(); if (at("NEWLINE") || at("EOF")) break; out.push(parseSimpleStmt()); }
      if (at("NEWLINE")) next();
      return out;
    }
    function parseStatement() {
      const k = peek();
      if (atKw("if")) return [parseIf()];
      if (atKw("while")) {
        next(); const cond = parseExpr(); expect("OP", ":", 'Expected ":" after "while" condition.');
        return [{ t: "While", cond, body: parseBlock(), line: k.line }];
      }
      if (atKw("for")) {
        next(); const v = expect("NAME", undefined, 'Expected a loop variable after "for".').v;
        if (atOp(":")) { next(); parseType(); }
        expect("KW", "in", 'Expected "in" after the loop variable.');
        const iter = parseExpr(); expect("OP", ":", 'Expected ":" after "for" iterator.');
        return [{ t: "For", v, iter, body: parseBlock(), line: k.line }];
      }
      if (atKw("match")) return [parseMatch()];
      return parseSimpleStmtLine();
    }
    function parseIf() {
      const line = next().line;
      const cond = parseExpr(); expect("OP", ":", 'Expected ":" after "if" condition.');
      const body = parseBlock();
      let els = null;
      if (atKw("elif")) { els = [parseIf()]; }
      else if (atKw("else")) { next(); expect("OP", ":", 'Expected ":" after "else".'); els = parseBlock(); }
      return { t: "If", cond, body, els, line };
    }
    function parseMatch() {
      const line = next().line;
      const subject = parseExpr(); expect("OP", ":", 'Expected ":" after "match" value.');
      expect("NEWLINE"); expect("INDENT", undefined, "Expected an indented block of patterns.");
      const branches = [];
      while (!at("DEDENT") && !at("EOF")) {
        if (at("NEWLINE")) { next(); continue; }
        const pats = [parsePattern()];
        while (atOp(",")) { next(); pats.push(parsePattern()); }
        let guard = null;
        if (atKw("when")) { next(); guard = parseExpr(); }
        expect("OP", ":", 'Expected ":" after the pattern.');
        branches.push({ pats, guard, body: parseBlock() });
      }
      expect("DEDENT");
      return { t: "Match", subject, branches, line };
    }
    function parsePattern() {
      if (at("NAME", "_")) { next(); return { t: "PWild" }; }
      if (atKw("var")) { next(); return { t: "PBind", name: expect("NAME").v }; }
      if (atOp("[")) {
        next(); const items = []; let rest = false;
        while (!atOp("]")) {
          if (atOp(".") && peek(1).v === ".") { next(); next(); rest = true; }
          else items.push(parsePattern());
          if (atOp(",")) next();
        }
        next(); return { t: "PArray", items, rest };
      }
      return { t: "PValue", expr: parseExpr() };
    }
    function parseSimpleStmt() {
      const k = peek();
      if (atKw("pass")) { next(); return { t: "Pass", line: k.line }; }
      if (atKw("break")) { next(); return { t: "Break", line: k.line }; }
      if (atKw("continue")) { next(); return { t: "Continue", line: k.line }; }
      if (atKw("return")) {
        next();
        const value = at("NEWLINE") || at("EOF") || at("DEDENT") || atOp(";") || atOp(")") ? null : parseExpr();
        return { t: "Return", value, line: k.line };
      }
      if (atKw("var")) return parseVar();
      if (atKw("const")) return parseConst();
      if (atKw("if") || atKw("for") || atKw("while") || atKw("match")) return parseStatement()[0];
      const e = parseExpr();
      const ASSIGN = ["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>="];
      if (at("OP") && ASSIGN.includes(peek().v)) {
        const op = next().v;
        if (!["Name", "Attr", "Index"].includes(e.t)) fail("Cannot assign to this expression.", k.line);
        const value = parseExpr();
        return { t: "Assign", target: e, op, value, line: k.line };
      }
      return { t: "ExprStmt", e, line: k.line };
    }

    // expressions, loosest first
    function parseExpr() { return parseTernary(); }
    function parseTernary() {
      let e = parseOr();
      if (atKw("if") && !lineStartsWithIf()) {
        const line = next().line; const cond = parseOr();
        expect("KW", "else", 'Expected "else" in the ternary expression.');
        const other = parseTernary();
        e = { t: "Ternary", cond, a: e, b: other, line };
      }
      return e;
    }
    function lineStartsWithIf() { return false; }
    function bin(nextFn, ops) {
      return function () {
        let l = nextFn();
        while (true) {
          const k = peek();
          const isOp = (k.t === "OP" || k.t === "KW") && ops.includes(k.v);
          if (!isOp) break;
          next();
          l = { t: "Bin", op: k.v, l, r: nextFn(), line: k.line };
        }
        return l;
      };
    }
    function parseOr() { return bin(parseAnd, ["or", "||"])(); }
    function parseAnd() { return bin(parseNot, ["and", "&&"])(); }
    function parseNot() {
      if (atKw("not") || atOp("!")) { const k = next(); return { t: "Not", e: parseNot(), line: k.line }; }
      return parseIn();
    }
    function parseIn() {
      let l = parseCmp();
      while (true) {
        if (atKw("in")) { const k = next(); l = { t: "In", l, r: parseCmp(), line: k.line }; continue; }
        if (atKw("not") && peek(1).t === "KW" && peek(1).v === "in") {
          const k = next(); next(); l = { t: "Not", e: { t: "In", l, r: parseCmp(), line: k.line }, line: k.line }; continue;
        }
        break;
      }
      return l;
    }
    function parseCmp() { return bin(parseBor, ["==", "!=", "<", ">", "<=", ">="])(); }
    function parseBor() { return bin(parseBxor, ["|"])(); }
    function parseBxor() { return bin(parseBand, ["^"])(); }
    function parseBand() { return bin(parseShift, ["&"])(); }
    function parseShift() { return bin(parseAdd, ["<<", ">>"])(); }
    function parseAdd() { return bin(parseMul, ["+", "-"])(); }
    function parseMul() { return bin(parseUnary, ["*", "/", "%"])(); }
    function parseUnary() {
      if (atOp("-") || atOp("+") || atOp("~")) { const k = next(); return { t: "Unary", op: k.v, e: parseUnary(), line: k.line }; }
      return parsePow();
    }
    function parsePow() {
      let l = parseIsAs();
      if (atOp("**")) { const k = next(); l = { t: "Bin", op: "**", l, r: parseUnary(), line: k.line }; }
      return l;
    }
    function parseIsAs() {
      let l = parseAwait();
      while (atKw("is") || atKw("as")) {
        const k = next();
        let neg = false;
        if (k.v === "is" && atKw("not")) { next(); neg = true; }
        const type = parseType();
        l = k.v === "is" ? { t: "Is", e: l, type, neg, line: k.line } : { t: "As", e: l, type, line: k.line };
      }
      return l;
    }
    function parseAwait() {
      if (atKw("await")) { const k = next(); return { t: "Await", e: parseAwait(), line: k.line }; }
      return parsePostfix(parseAtom());
    }
    function parsePostfix(e) {
      while (true) {
        const k = peek();
        if (atOp("(")) {
          next(); const args = [];
          while (!atOp(")")) { args.push(parseExpr()); if (atOp(",")) next(); else if (!atOp(")")) fail('Expected "," or ")" in the call.', peek().line); }
          next(); e = { t: "Call", fn: e, args, line: k.line }; continue;
        }
        if (atOp(".")) {
          next(); const n = at("NAME") || at("KW") ? next().v : fail("Expected a name after \".\".", k.line);
          e = { t: "Attr", e, name: n, line: k.line }; continue;
        }
        if (atOp("[")) {
          next(); const idx = parseExpr(); expect("OP", "]"); e = { t: "Index", e, idx, line: k.line }; continue;
        }
        break;
      }
      return e;
    }
    function parseAtom() {
      const k = next();
      switch (k.t) {
        case "INT": return { t: "Lit", v: k.v, line: k.line };
        case "FLOAT": return { t: "Lit", v: fl(k.v), line: k.line };
        case "STR": return { t: "Lit", v: k.v, line: k.line };
        case "NODE": return { t: "GetNode", path: k.v, line: k.line };
        case "NAME": return { t: "Name", name: k.v, line: k.line };
        case "KW":
          if (k.v === "true") return { t: "Lit", v: true, line: k.line };
          if (k.v === "false") return { t: "Lit", v: false, line: k.line };
          if (k.v === "null") return { t: "Lit", v: null, line: k.line };
          if (k.v === "self") return { t: "Self", line: k.line };
          if (k.v === "super") return { t: "Super", line: k.line };
          if (k.v === "func") return parseLambda(k);
          break;
        case "OP":
          if (k.v === "(") { const e = parseExpr(); expect("OP", ")"); return e; }
          if (k.v === "[") {
            const items = [];
            while (!atOp("]")) { items.push(parseExpr()); if (atOp(",")) next(); else if (!atOp("]")) fail('Expected "," or "]" in the array.', peek().line); }
            next(); return { t: "ArrayLit", items, line: k.line };
          }
          if (k.v === "{") {
            const items = [];
            while (!atOp("}")) {
              let key;
              // Lua-style {name = value}
              if (at("NAME") && peek(1).t === "OP" && peek(1).v === "=") { key = { t: "Lit", v: next().v }; next(); }
              else { key = parseExpr(); expect("OP", ":", 'Expected ":" after the dictionary key.'); }
              items.push([key, parseExpr()]);
              if (atOp(",")) next(); else if (!atOp("}")) fail('Expected "," or "}" in the dictionary.', peek().line);
            }
            next(); return { t: "DictLit", items, line: k.line };
          }
          break;
      }
      const what = k.t === "NEWLINE" ? "end of line" : k.t === "EOF" ? "end of file" : k.t === "INDENT" ? "an indent" : k.t === "DEDENT" ? "end of block" : '"' + k.v + '"';
      fail("Expected an expression, found " + what + ".", k.line);
    }
    function parseLambda(k) {
      let name = null;
      if (at("NAME")) name = next().v;
      const params = parseParams();
      if (atOp("->")) { next(); parseType(); }
      expect("OP", ":", 'Expected ":" after the lambda parameters.');
      let body;
      if (at("NEWLINE")) {
        // multi-line lambda: only outside brackets, where the lexer keeps indentation
        body = parseBlock();
        p--; // let the enclosing statement see an end of line
        toks[p] = { t: "NEWLINE", line: k.line };
      } else {
        const st = parseSimpleStmt();
        body = [st.t === "ExprStmt" ? { t: "Return", value: st.e, line: st.line, implicit: true } : st];
      }
      return { t: "Lambda", name, params, body, line: k.line };
    }

    const cls = parseClassBody(null, false);
    return cls;
  }

  // ───────────────────────────── formatting ─────────────────────────────
  function fmtFloat(v) {
    if (Number.isNaN(v)) return "nan";
    if (v === Infinity) return "inf";
    if (v === -Infinity) return "-inf";
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return v.toFixed(1);
    let s = parseFloat(v.toPrecision(14)).toString();
    if (s.includes("e")) {
      const [m, e] = s.split("e");
      s = m + "e" + (e[0] === "-" ? "-" : "+") + e.replace(/^[-+]/, "").padStart(2, "0");
    }
    return s;
  }
  function str(v, nested) {
    if (v === null || v === undefined) return "<null>";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return String(v);
    if (v instanceof F) return fmtFloat(v.v);
    if (typeof v === "string") return nested ? JSON.stringify(v) : v;
    if (Array.isArray(v)) return "[" + v.map((x) => str(x, true)).join(", ") + "]";
    if (v instanceof Map) {
      if (v.size === 0) return "{  }";
      return "{ " + [...v.entries()].map(([k, x]) => str(k, true) + ": " + str(x, true)).join(", ") + " }";
    }
    if (v instanceof Vec2) return v.i ? "(" + v.x + ", " + v.y + ")" : "(" + fmtFloat(v.x) + ", " + fmtFloat(v.y) + ")";
    if (v instanceof Rect2) return "[P: " + str(v.position) + ", S: " + str(v.size) + "]";
    if (v instanceof Color) return "(" + [v.r, v.g, v.b, v.a].map((x) => fmtFloat(x).replace(/\.0$/, "")).join(", ") + ")";
    if (v instanceof Callable) return v.kind === "lambda" ? "<anonymous lambda>" : (v.name || "Callable") + "()";
    if (v instanceof GDSignal) return "Signal(" + v.name + ")";
    if (v instanceof GDObject) {
      const ts = v.cls.funcs._to_string;
      if (ts && v.cls.interp) { const r = v.cls.interp.callMethodSync(v, "_to_string", []); return str(r); }
      return "<" + (v.cls.name || v.cls.nativeBase) + "#" + v.id + ">";
    }
    if (v instanceof Pending) return "<coroutine>";
    if (v && v.__native) return "<" + v.__native + "#" + (v.id || 1) + ">";
    return String(v);
  }
  function typeName(v) {
    if (v === null || v === undefined) return "Nil";
    if (typeof v === "boolean") return "bool";
    if (typeof v === "number") return "int";
    if (v instanceof F) return "float";
    if (typeof v === "string") return "String";
    if (Array.isArray(v)) return "Array";
    if (v instanceof Map) return "Dictionary";
    if (v instanceof Vec2) return v.i ? "Vector2i" : "Vector2";
    if (v instanceof Rect2) return "Rect2";
    if (v instanceof Color) return "Color";
    if (v instanceof Callable) return "Callable";
    if (v instanceof GDSignal) return "Signal";
    if (v instanceof GDObject) return v.cls.name || v.cls.nativeBase;
    if (v && v.__native) return v.__native;
    return "Object";
  }

  // printf-style "%s" % args, the way GDScript does it
  function formatPercent(fmtStr, args, line) {
    const list = Array.isArray(args) ? args : [args];
    let ai = 0, out = "";
    for (let i = 0; i < fmtStr.length; i++) {
      const c = fmtStr[i];
      if (c !== "%") { out += c; continue; }
      if (fmtStr[i + 1] === "%") { out += "%"; i++; continue; }
      let j = i + 1, flags = "";
      while ("-+0 ".includes(fmtStr[j]) && j < fmtStr.length) flags += fmtStr[j++];
      let width = ""; while (/[0-9]/.test(fmtStr[j] || "")) width += fmtStr[j++];
      let prec = null;
      if (fmtStr[j] === ".") { j++; prec = ""; while (/[0-9]/.test(fmtStr[j] || "")) prec += fmtStr[j++]; }
      const conv = fmtStr[j];
      if (ai >= list.length) fail("String formatting error: not enough arguments for format string.", line);
      const a = list[ai++];
      let s;
      switch (conv) {
        case "s": s = str(a); break;
        case "d": case "i":
          if (!isNum(a)) fail("String formatting error: a number is required.", line);
          s = String(toInt(num(a))); if (flags.includes("+") && num(a) >= 0) s = "+" + s; break;
        case "f":
          if (!isNum(a)) fail("String formatting error: a number is required.", line);
          s = num(a).toFixed(prec === null ? 6 : parseInt(prec || "0", 10)); if (flags.includes("+") && num(a) >= 0) s = "+" + s; break;
        case "x": s = toInt(num(a)).toString(16); break;
        case "X": s = toInt(num(a)).toString(16).toUpperCase(); break;
        case "c": s = typeof a === "string" ? a : String.fromCharCode(num(a)); break;
        case "o": s = toInt(num(a)).toString(8); break;
        case "v": s = str(a); break;
        default: fail('String formatting error: unsupported format character "' + conv + '".', line);
      }
      if (width) {
        const w = parseInt(width, 10);
        if (flags.includes("-")) s = s.padEnd(w);
        else s = s.padStart(w, flags.includes("0") && conv !== "s" ? "0" : " ");
      }
      out += s; i = j;
    }
    if (ai < list.length) fail("String formatting error: not all arguments converted during string formatting.", line);
    return out;
  }

  // ───────────────────────────── equality ─────────────────────────────
  function eq(a, b) {
    if (isNum(a) && isNum(b)) return num(a) === num(b);
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    if (typeof a !== typeof b && !(typeof a === "object" && typeof b === "object")) return false;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]));
    if (a instanceof Map) {
      if (!(b instanceof Map) || a.size !== b.size) return false;
      for (const [k, v] of a) { const bk = mapFindKey(b, k); if (bk === undefined || !eq(v, b.get(bk))) return false; }
      return true;
    }
    if (a instanceof Vec2) return b instanceof Vec2 && a.x === b.x && a.y === b.y;
    if (a instanceof Rect2) return b instanceof Rect2 && eq(a.position, b.position) && eq(a.size, b.size);
    if (a instanceof Color) return b instanceof Color && a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
    if (a instanceof Callable && b instanceof Callable) return a.fn === b.fn && a.self === b.self && a.name === b.name;
    return a === b;
  }
  // Dictionary keys: ints, floats and strings compare by value
  function keyOf(k) {
    if (k instanceof F) return Number.isInteger(k.v) ? "f:" + k.v : k.v; // keep 1.0 and 1 apart like Godot
    if (k instanceof Vec2) return "v:" + k.x + "," + k.y;
    return k;
  }
  function mapFindKey(m, k) {
    if (m.has(k)) return k;
    if (k instanceof F || k instanceof Vec2) { const want = keyOf(k); for (const key of m.keys()) if (keyOf(key) === want) return key; }
    return undefined;
  }
  function truthy(v) {
    if (v === null || v === undefined || v === false) return false;
    if (v === true) return true;
    if (typeof v === "number") return v !== 0;
    if (v instanceof F) return v.v !== 0;
    if (typeof v === "string") return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (v instanceof Map) return v.size > 0;
    if (v instanceof Vec2) return v.x !== 0 || v.y !== 0;
    return true;
  }
  function deepCopy(v) {
    if (Array.isArray(v)) return v.map(deepCopy);
    if (v instanceof Map) { const m = new Map(); for (const [k, x] of v) m.set(k, deepCopy(x)); return m; }
    return v;
  }

  // ───────────────────────────── random (seeded, for repeatable tests) ─────────────────────────────
  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    return { next, seed: (n) => { s = (n >>> 0) || 0x9e3779b9; } };
  }

  // ───────────────────────────── interpreter ─────────────────────────────
  const FLOW_RETURN = 1, FLOW_BREAK = 2, FLOW_CONTINUE = 3;
  const STEP_LIMIT = 3000000;

  class Scope {
    constructor(parent, fnBoundary) { this.vars = new Map(); this.consts = new Set(); this.parent = parent; this.fnBoundary = !!fnBoundary; }
    find(name) { let s = this; while (s) { if (s.vars.has(name)) return s; if (s.fnBoundary) return null; s = s.parent; } return null; }
  }

  class Interp {
    constructor(opts) {
      this.out = opts.output || ((s) => console.log(s));
      this.host = opts.host || {};
      this.steps = 0;
      this.stepLimit = opts.stepLimit || STEP_LIMIT;
      this.rng = makeRng(opts.seed || 12345);
      this.time = 0; // virtual seconds, for timers when there is no frame loop
      this.timers = [];
      this.tasks = 0;
      this.errors = [];
    }

    // ---------- classes ----------
    buildClass(decl, outer, name) {
      const cls = new GDClass(name || decl.className || "", decl, outer, this);
      for (const it of decl.items) {
        if (it.t === "Func") {
          if (cls.funcs[it.name]) fail('Function "' + it.name + '" has the same name as a previously declared function.', it.line);
          cls.funcs[it.name] = it;
        } else if (it.t === "Var") {
          if (cls.members.some((m) => m.name === it.name)) fail('Member "' + it.name + '" redefined.', it.line);
          if (it.isStatic) cls.statics.set(it.name, null); else cls.members.push(it);
        } else if (it.t === "Signal") cls.signals.push(it.name);
        else if (it.t === "InnerClass") { cls.inner[it.decl.name] = this.buildClass(it.decl, cls, it.decl.name); }
      }
      // constants and enums are evaluated after inner classes exist
      for (const it of decl.items) {
        if (it.t === "Const") cls.consts.set(it.name, this.evalSync(it.value, this.classScope(cls)));
        else if (it.t === "Enum") {
          const m = new Map(); let n = 0;
          for (const [k, vexpr] of it.keys) {
            if (vexpr) n = num(this.evalSync(vexpr, this.classScope(cls)));
            m.set(k, n); if (!it.name) cls.consts.set(k, n); n++;
          }
          if (it.name) cls.consts.set(it.name, m);
        }
      }
      for (const it of decl.items) {
        if (it.t === "Var" && it.isStatic) cls.statics.set(it.name, it.value ? this.evalSync(it.value, this.classScope(cls)) : this.defaultFor(it.type));
      }
      if (decl.ext) {
        const b = this.findClass(decl.ext, outer);
        if (b) cls.base = b; else cls.nativeBase = decl.ext;
      }
      if (cls.base) { let c = cls.base; while (c.base) c = c.base; cls.nativeBase = c.nativeBase; }
      return cls;
    }
    findClass(name, from) {
      let c = from;
      while (c) { if (c.inner[name]) return c.inner[name]; c = c.outer; }
      if (this.mainClass && this.mainClass.decl.className === name) return this.mainClass;
      return null;
    }
    classScope(cls) { const s = new Scope(null, true); s.cls = cls; return s; }

    findFunc(cls, name) {
      let c = cls;
      while (c) { if (c.funcs[name]) return { fn: c.funcs[name], cls: c }; c = c.base; }
      return null;
    }
    findConst(cls, name) {
      let c = cls;
      while (c) {
        if (c.consts.has(name)) return { v: c.consts.get(name) };
        if (c.statics.has(name)) return { v: c.statics.get(name), statics: c.statics };
        if (c.inner[name]) return { v: c.inner[name] };
        c = c.base;
      }
      let o = cls && cls.outer;
      while (o) {
        if (o.consts.has(name)) return { v: o.consts.get(name) };
        if (o.inner[name]) return { v: o.inner[name] };
        if (o.statics.has(name)) return { v: o.statics.get(name), statics: o.statics };
        o = o.outer;
      }
      return null;
    }

    instantiate(cls, args, line) {
      const obj = new GDObject(cls);
      const chain = []; let c = cls; while (c) { chain.unshift(c); c = c.base; }
      if (this.host.makeNative) this.host.makeNative(obj, cls.nativeBase, this);
      for (const k of chain) {
        for (const sname of k.signals) obj.signals[sname] = new GDSignal(sname, obj);
      }
      for (const k of chain) {
        for (const m of k.members) {
          if (m.annots && m.annots.includes("onready")) { obj.fields.set(m.name, null); continue; }
          let v = m.value ? this.evalSync(m.value, this.objScope(obj, k)) : this.defaultFor(m.type);
          obj.fields.set(m.name, this.coerce(v, m.type, m.line));
        }
      }
      const init = this.findFunc(cls, "_init");
      if (init) this.invoke(init.fn, obj, args || [], init.cls, line);
      else if (args && args.length) fail("Too many arguments for \"new()\" call. Expected at most 0 but received " + args.length + ".", line);
      return obj;
    }
    runOnready(obj) {
      const chain = []; let c = obj.cls; while (c) { chain.unshift(c); c = c.base; }
      for (const k of chain) for (const m of k.members) {
        if (m.annots && m.annots.includes("onready") && m.value) obj.fields.set(m.name, this.coerce(this.evalSync(m.value, this.objScope(obj, k)), m.type, m.line));
      }
    }
    objScope(obj, cls) { const s = new Scope(null, true); s.self = obj; s.cls = cls || obj.cls; return s; }

    defaultFor(type) {
      switch (type) {
        case "int": return 0;
        case "float": return fl(0);
        case "String": case "StringName": return "";
        case "bool": return false;
        case "Vector2": return new Vec2(0, 0);
        case "Vector2i": return new Vec2(0, 0, true);
        case "Color": return new Color(0, 0, 0, 1);
        case "Rect2": return new Rect2(new Vec2(0, 0), new Vec2(0, 0));
        case "Array": return [];
        case "Dictionary": return new Map();
        default:
          if (type && type.startsWith("Array")) return [];
          if (type && type.startsWith("Dictionary")) return new Map();
          return null;
      }
    }
    coerce(v, type, line) {
      if (!type) return v;
      if (type === "float" && typeof v === "number") return fl(v);
      if (type === "int" && v instanceof F) return toInt(v.v);
      if (type === "int" && typeof v !== "number" && v !== null) {
        if (typeof v === "boolean") return v ? 1 : 0;
        fail('Cannot assign a value of type "' + typeName(v) + '" as "int".', line);
      }
      if (type === "float" && !(v instanceof F) && v !== null) fail('Cannot assign a value of type "' + typeName(v) + '" as "float".', line);
      if (type === "String" && typeof v !== "string") fail('Cannot assign a value of type "' + typeName(v) + '" as "String".', line);
      if (type === "bool" && typeof v !== "boolean") fail('Cannot assign a value of type "' + typeName(v) + '" as "bool".', line);
      if ((type === "Array" || type.startsWith("Array[")) && !Array.isArray(v)) fail('Cannot assign a value of type "' + typeName(v) + '" as "Array".', line);
      if (type === "Vector2" && !(v instanceof Vec2)) fail('Cannot assign a value of type "' + typeName(v) + '" as "Vector2".', line);
      return v;
    }

    // ---------- tasks (await) ----------
    invoke(fn, self, args, cls, line, closure) {
      const gen = this.runFunction(fn, self, args, cls, line, closure);
      return this.startTask(gen);
    }
    startTask(gen) {
      const task = { gen, done: false, value: null, waiters: [] };
      this.step(task, undefined);
      if (task.done) return task.value;
      return new Pending(task);
    }
    step(task, sent) {
      let r;
      let value = sent;
      while (true) {
        r = task.gen.next(value);
        if (r.done) {
          task.done = true; task.value = r.value === undefined ? null : r.value;
          const ws = task.waiters; task.waiters = [];
          for (const w of ws) this.step(w, task.value);
          return;
        }
        const w = r.value;
        if (w.signal) { w.signal.awaiters.push(task); return; }
        if (w.task) {
          if (w.task.done) { value = w.task.value; continue; }
          w.task.waiters.push(task); return;
        }
        value = null;
      }
    }
    emit(sig, args) {
      for (const c of [...sig.conns]) {
        const a = c.binds ? args.concat(c.binds) : args;
        this.callCallable(c.callable, a, 0);
        if (c.oneShot) sig.conns.splice(sig.conns.indexOf(c), 1);
      }
      const ws = sig.awaiters; sig.awaiters = [];
      const sent = args.length === 0 ? null : args.length === 1 ? args[0] : args;
      for (const t of ws) this.step(t, sent);
    }
    // timers for programs with no frame loop: run them in time order, instantly
    makeTimer(seconds) {
      const sig = new GDSignal("timeout", null);
      const t = { at: this.time + Math.max(0, num(seconds)), sig, id: this.timers.length };
      this.timers.push(t);
      return { __native: "SceneTreeTimer", timeout: sig, time_left: fl(Math.max(0, num(seconds))) };
    }
    drainTimers(maxTime) {
      let guard = 0;
      while (this.timers.length && guard++ < 100000) {
        this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
        if (maxTime !== undefined && this.timers[0].at > maxTime) break;
        const t = this.timers.shift();
        this.time = Math.max(this.time, t.at);
        this.emit(t.sig, []);
      }
      if (maxTime !== undefined) this.time = Math.max(this.time, maxTime);
    }

    // ---------- running functions ----------
    *runFunction(fn, self, args, cls, line, closure) {
      const scope = new Scope(closure || null, true);
      scope.self = self; scope.cls = cls || (self && self.cls) || this.mainClass;
      if (closure) { scope.fnBoundary = true; scope.closure = closure; }
      const ps = fn.params;
      const required = ps.filter((p) => !p.def).length;
      if (args.length > ps.length) fail('Too many arguments for "' + (fn.name || "lambda") + '()" call. Expected at most ' + ps.length + " but received " + args.length + ".", line);
      if (args.length < required) fail('Too few arguments for "' + (fn.name || "lambda") + '()" call. Expected at least ' + required + " but received " + args.length + ".", line);
      for (let i = 0; i < ps.length; i++) {
        let v = i < args.length ? args[i] : yield* this.eval(ps[i].def, scope);
        v = this.coerce(v, ps[i].type, line);
        scope.vars.set(ps[i].name, v);
      }
      const r = yield* this.execBlock(fn.body, scope);
      if (r && r.flow === FLOW_RETURN) return r.value;
      return null;
    }
    *execBlock(stmts, scope) {
      for (const st of stmts) {
        const r = yield* this.exec(st, scope);
        if (r) return r;
      }
      return null;
    }
    tick(line) {
      if (++this.steps > this.stepLimit) fail("Your code ran for too long – is there a loop that never ends?", line);
    }
    *exec(st, scope) {
      this.tick(st.line);
      switch (st.t) {
        case "Pass": return null;
        case "ExprStmt": yield* this.eval(st.e, scope); return null;
        case "Var": {
          if (scope.vars.has(st.name)) fail('There is already a variable named "' + st.name + '" in this scope.', st.line);
          let v = st.value ? yield* this.eval(st.value, scope) : this.defaultFor(st.type);
          if (v instanceof Pending) v = null;
          scope.vars.set(st.name, this.coerce(v, st.type, st.line));
          if (st.type) (scope.types || (scope.types = new Map())).set(st.name, st.type);
          return null;
        }
        case "Const": {
          scope.vars.set(st.name, yield* this.eval(st.value, scope)); scope.consts.add(st.name); return null;
        }
        case "Assign": {
          let v = yield* this.eval(st.value, scope);
          if (st.op !== "=") {
            const cur = yield* this.eval(st.target, scope);
            v = this.binop(st.op.slice(0, -1), cur, v, st.line);
          }
          yield* this.assign(st.target, v, scope, st.line);
          return null;
        }
        case "Return": return { flow: FLOW_RETURN, value: st.value ? yield* this.eval(st.value, scope) : null };
        case "Break": return { flow: FLOW_BREAK };
        case "Continue": return { flow: FLOW_CONTINUE };
        case "If": {
          const c = yield* this.eval(st.cond, scope);
          if (truthy(c)) return yield* this.execBlock(st.body, new Scope(scope));
          if (st.els) return yield* this.execBlock(st.els, new Scope(scope));
          return null;
        }
        case "While": {
          while (truthy(yield* this.eval(st.cond, scope))) {
            this.tick(st.line);
            const r = yield* this.execBlock(st.body, new Scope(scope));
            if (r && r.flow === FLOW_BREAK) break;
            if (r && r.flow === FLOW_RETURN) return r;
          }
          return null;
        }
        case "For": {
          const it = yield* this.eval(st.iter, scope);
          let seq;
          if (typeof it === "number") seq = Array.from({ length: Math.max(0, it) }, (_, i) => i);
          else if (it instanceof F) seq = Array.from({ length: Math.max(0, Math.ceil(it.v)) }, (_, i) => i);
          else if (Array.isArray(it)) seq = it;
          else if (it instanceof Map) seq = [...it.keys()];
          else if (typeof it === "string") seq = [...it];
          else if (it && it.__range) seq = it.__range;
          else if (it instanceof Vec2) seq = Array.from({ length: Math.max(0, it.y - it.x) }, (_, i) => it.x + i);
          else fail('Unable to iterate on value of type "' + typeName(it) + '".', st.line);
          // arrays are walked live, like Godot (changing one while walking it is a bug either way)
          for (let i = 0; i < seq.length; i++) {
            this.tick(st.line);
            const inner = new Scope(scope);
            inner.vars.set(st.v, seq[i]);
            const r = yield* this.execBlock(st.body, inner);
            if (r && r.flow === FLOW_BREAK) break;
            if (r && r.flow === FLOW_RETURN) return r;
          }
          return null;
        }
        case "Match": {
          const v = yield* this.eval(st.subject, scope);
          for (const br of st.branches) {
            for (const pat of br.pats) {
              const inner = new Scope(scope);
              if (yield* this.matchPat(pat, v, inner)) {
                if (br.guard && !truthy(yield* this.eval(br.guard, inner))) continue;
                const r = yield* this.execBlock(br.body, inner);
                if (r && r.flow !== FLOW_CONTINUE) return r;
                return null;
              }
            }
          }
          return null;
        }
      }
      fail("Unknown statement.", st.line);
    }
    *matchPat(pat, v, scope) {
      switch (pat.t) {
        case "PWild": return true;
        case "PBind": scope.vars.set(pat.name, v); return true;
        case "PValue": return eq(yield* this.eval(pat.expr, scope), v);
        case "PArray": {
          if (!Array.isArray(v)) return false;
          if (pat.rest ? v.length < pat.items.length : v.length !== pat.items.length) return false;
          for (let i = 0; i < pat.items.length; i++) if (!(yield* this.matchPat(pat.items[i], v[i], scope))) return false;
          return true;
        }
      }
      return false;
    }

    *assign(target, v, scope, line) {
      if (target.t === "Name") {
        const s = scope.find(target.name);
        if (s) {
          if (s.consts.has(target.name)) fail('Cannot assign a new value to a constant.', line);
          const ty = s.types && s.types.get(target.name);
          s.vars.set(target.name, this.coerce(v, ty, line)); return;
        }
        // lambdas see a COPY of the locals they were made in; writing to one
        // changes the copy, which is the GDScript behaviour worth learning
        let cl = scope;
        while (cl) { if (cl.closure) { const cs = cl.closure.find(target.name); if (cs) { cs.vars.set(target.name, v); return; } } cl = cl.parent; }
        const self = this.selfOf(scope);
        if (self && self.fields.has(target.name)) {
          const decl = this.memberDecl(self.cls, target.name);
          self.fields.set(target.name, this.coerce(v, decl && decl.type, line)); return;
        }
        if (self && this.host.setNative && this.host.setNative(self, target.name, v, this)) return;
        const st = this.findStatic(scope, target.name);
        if (st) { st.set(target.name, v); return; }
        if (this.findConst(this.clsOf(scope), target.name)) fail("Cannot assign a new value to a constant.", line);
        fail('Identifier "' + target.name + '" not declared in the current scope.', line);
      }
      if (target.t === "Attr") {
        const base = yield* this.eval(target.e, scope);
        if (base instanceof Vec2 || base instanceof Rect2 || base instanceof Color) {
          yield* this.assign(target.e, base.with(target.name, v), scope, line); return;
        }
        this.setProp(base, target.name, v, line); return;
      }
      if (target.t === "Index") {
        const base = yield* this.eval(target.e, scope);
        const idx = yield* this.eval(target.idx, scope);
        if (Array.isArray(base)) {
          if (!isNum(idx)) fail("Invalid index type for an Array.", line);
          let i = toInt(num(idx)); if (i < 0) i += base.length;
          if (i < 0 || i >= base.length) fail("Out of bounds set index " + toInt(num(idx)) + " (on base: 'Array')", line);
          base[i] = v; return;
        }
        if (base instanceof Map) { const k = mapFindKey(base, idx); base.set(k === undefined ? idx : k, v); return; }
        if (base instanceof Vec2) { yield* this.assign(target.e, base.with(num(idx) === 0 ? "x" : "y", v), scope, line); return; }
        if (base instanceof GDObject && typeof idx === "string") { this.setProp(base, idx, v, line); return; }
        fail("Invalid set index on base '" + typeName(base) + "'.", line);
      }
      fail("Cannot assign to this expression.", line);
    }
    memberDecl(cls, name) { let c = cls; while (c) { const m = c.members.find((x) => x.name === name); if (m) return m; c = c.base; } return null; }
    findStatic(scope, name) {
      let c = this.clsOf(scope);
      while (c) { if (c.statics.has(name)) return c.statics; let o = c.outer; while (o) { if (o.statics.has(name)) return o.statics; o = o.outer; } c = c.base; }
      return null;
    }
    selfOf(scope) { let s = scope; while (s) { if (s.self !== undefined) return s.self; s = s.parent; } return null; }
    clsOf(scope) { let s = scope; while (s) { if (s.cls) return s.cls; s = s.parent; } return this.mainClass; }

    setProp(base, name, v, line) {
      if (base instanceof GDObject) {
        if (base.fields.has(name)) { const d = this.memberDecl(base.cls, name); base.fields.set(name, this.coerce(v, d && d.type, line)); return; }
        if (this.host.setNative && this.host.setNative(base, name, v, this)) return;
        fail('Invalid assignment of property or key "' + name + '" with value of type "' + typeName(v) + '" on a base object of type "' + typeName(base) + '".', line);
      }
      if (base instanceof Map) { base.set(name, v); return; }
      if (base instanceof GDClass && base.statics.has(name)) { base.statics.set(name, v); return; }
      if (base && base.__native && this.host.setNative && this.host.setNative(base, name, v, this)) return;
      if (base && base.__native && name in base) { base[name] = v; return; }
      if (base === null) fail('Invalid assignment of property or key "' + name + '" on a base object of type "null instance".', line);
      fail('Invalid assignment of property "' + name + '" on a base of type "' + typeName(base) + '".', line);
    }

    // ---------- expressions ----------
    evalSync(e, scope) {
      const g = this.eval(e, scope);
      const r = g.next();
      if (!r.done) fail('"await" can only be used inside a function.', e.line);
      return r.value;
    }
    *eval(e, scope) {
      switch (e.t) {
        case "Lit": return e.v;
        case "Name": return this.lookup(e.name, scope, e.line);
        case "Self": { const s = this.selfOf(scope); if (!s) fail('Cannot use "self" here.', e.line); return s; }
        case "ArrayLit": { const a = []; for (const x of e.items) a.push(yield* this.eval(x, scope)); return a; }
        case "DictLit": {
          const m = new Map();
          for (const [k, x] of e.items) { const kv = yield* this.eval(k, scope); const ek = mapFindKey(m, kv); m.set(ek === undefined ? kv : ek, yield* this.eval(x, scope)); }
          return m;
        }
        case "Ternary": return truthy(yield* this.eval(e.cond, scope)) ? yield* this.eval(e.a, scope) : yield* this.eval(e.b, scope);
        case "Not": return !truthy(yield* this.eval(e.e, scope));
        case "Unary": {
          const v = yield* this.eval(e.e, scope);
          if (e.op === "-") {
            if (typeof v === "number") return -v || 0;
            if (v instanceof F) return fl(-v.v);
            if (v instanceof Vec2) return new Vec2(-v.x, -v.y, v.i);
            fail('Invalid operand of type "' + typeName(v) + '" for unary operator "-".', e.line);
          }
          if (e.op === "~") return ~toInt(num(v));
          return v;
        }
        case "Bin": {
          if (e.op === "and" || e.op === "&&") return truthy(yield* this.eval(e.l, scope)) && truthy(yield* this.eval(e.r, scope));
          if (e.op === "or" || e.op === "||") return truthy(yield* this.eval(e.l, scope)) || truthy(yield* this.eval(e.r, scope));
          const l = yield* this.eval(e.l, scope);
          const r = yield* this.eval(e.r, scope);
          return this.binop(e.op, l, r, e.line);
        }
        case "In": {
          const l = yield* this.eval(e.l, scope);
          const r = yield* this.eval(e.r, scope);
          if (Array.isArray(r)) return r.some((x) => eq(x, l));
          if (r instanceof Map) return mapFindKey(r, l) !== undefined;
          if (typeof r === "string") { if (typeof l !== "string") fail('Invalid operands "' + typeName(l) + '" and "String" for "in".', e.line); return r.includes(l); }
          if (r instanceof GDObject) return r.fields.has(l);
          fail('Invalid operands "' + typeName(l) + '" and "' + typeName(r) + '" for "in" operator.', e.line);
        }
        case "Is": { const v = yield* this.eval(e.e, scope); const res = this.isType(v, e.type, scope); return e.neg ? !res : res; }
        case "As": {
          const v = yield* this.eval(e.e, scope);
          if (v === null) return null;
          if (e.type === "int") return isNum(v) ? toInt(num(v)) : v;
          if (e.type === "float") return isNum(v) ? fl(num(v)) : v;
          if (v instanceof GDObject || (v && v.__native)) return this.isType(v, e.type, scope) ? v : null;
          return v;
        }
        case "Await": {
          const v = yield* this.eval(e.e, scope);
          if (v instanceof Pending) return yield { task: v.task };
          if (v instanceof GDSignal) return yield { signal: v };
          return v;
        }
        case "GetNode": {
          const self = this.selfOf(scope);
          if (this.host.getNode) { const n = this.host.getNode(self, e.path, this); if (n !== undefined) { if (n === null) fail('Node not found: "' + e.path + '" (relative to "' + str(self) + '").', e.line); return n; } }
          fail('Node not found: "' + e.path + '". (There is no scene here – the workshop page has one.)', e.line);
        }
        case "Index": {
          const base = yield* this.eval(e.e, scope);
          const idx = yield* this.eval(e.idx, scope);
          return this.index(base, idx, e.line);
        }
        case "Attr": {
          if (e.e.t === "Super") fail('"super" is only supported for method calls.', e.line);
          const base = yield* this.eval(e.e, scope);
          return this.getProp(base, e.name, e.line);
        }
        case "Lambda": {
          // capture by value: a snapshot of every local visible right now
          const snap = new Scope(null, true);
          let s = scope;
          const seen = new Set();
          while (s) {
            for (const [k, v] of s.vars) if (!seen.has(k)) { seen.add(k); snap.vars.set(k, v); }
            if (s.fnBoundary && !s.closure) break;
            s = s.closure || s.parent;
          }
          snap.self = this.selfOf(scope); snap.cls = this.clsOf(scope);
          const c = new Callable("lambda", { fn: e, self: snap.self, closure: snap, cls: snap.cls, name: e.name || "<anonymous lambda>" });
          if (e.name) scope.vars.set(e.name, c);
          return c;
        }
        case "Call": return yield* this.evalCall(e, scope);
        case "Super": fail('"super" must be followed by a method call.', e.line);
      }
      fail("Unknown expression.", e.line);
    }

    isType(v, type, scope) {
      switch (type) {
        case "int": return typeof v === "number";
        case "float": return v instanceof F;
        case "String": case "StringName": return typeof v === "string";
        case "bool": return typeof v === "boolean";
        case "Array": return Array.isArray(v);
        case "Dictionary": return v instanceof Map;
        case "Vector2": return v instanceof Vec2 && !v.i;
        case "Vector2i": return v instanceof Vec2 && v.i;
        case "Color": return v instanceof Color;
        case "Rect2": return v instanceof Rect2;
        case "Callable": return v instanceof Callable;
        case "Signal": return v instanceof GDSignal;
        case "Object": case "RefCounted": return v instanceof GDObject || !!(v && v.__native);
      }
      if (v instanceof GDObject) {
        let c = v.cls;
        while (c) { if (c.name === type || c.decl.className === type) return true; c = c.base; }
        if (this.host.nativeIs) return this.host.nativeIs(v, type);
        return v.cls.nativeBase === type || (type === "Node" && /Node|Sprite|Label|Button|Control|Container|Rect|Timer|Camera/.test(v.cls.nativeBase));
      }
      if (v && v.__native && this.host.nativeIs) return this.host.nativeIs(v, type);
      return false;
    }

    lookup(name, scope, line) {
      const s = scope.find(name);
      if (s) return s.vars.get(name);
      let cl = scope;
      while (cl) { if (cl.closure) { const cs = cl.closure.find(name); if (cs) return cs.vars.get(name); } cl = cl.parent; }
      const self = this.selfOf(scope);
      if (self instanceof GDObject) {
        if (self.fields.has(name)) return self.fields.get(name);
        if (self.signals[name]) return self.signals[name];
        if (this.host.getNative) { const r = this.host.getNative(self, name, this); if (r !== undefined) return r; }
      }
      const cls = this.clsOf(scope);
      const k = this.findConst(cls, name);
      if (k) return k.v;
      const f = (self instanceof GDObject ? this.findFunc(self.cls, name) : null) || this.findFunc(cls, name);
      if (f) return new Callable("method", { fn: f.fn, self, cls: f.cls, name });
      if (this.mainClass && this.mainClass.decl.className === name) return this.mainClass;
      if (Object.prototype.hasOwnProperty.call(GLOBALS, name)) return GLOBALS[name];
      if (this.host.globals && name in this.host.globals) return this.host.globals[name];
      if (BUILTIN_FUNCS[name]) return new Callable("builtin", { name });
      fail('Identifier "' + name + '" not declared in the current scope.', line);
    }

    index(base, idx, line) {
      if (Array.isArray(base)) {
        if (!isNum(idx)) fail('Invalid index type "' + typeName(idx) + '" for a base of type "Array".', line);
        let i = toInt(num(idx)); if (i < 0) i += base.length;
        if (i < 0 || i >= base.length) fail("Out of bounds get index '" + toInt(num(idx)) + "' (on base: 'Array')", line);
        return base[i];
      }
      if (base instanceof Map) {
        const k = mapFindKey(base, idx);
        if (k === undefined) fail('Invalid access to property or key ' + str(idx, true) + ' on a base object of type "Dictionary".', line);
        return base.get(k);
      }
      if (typeof base === "string") {
        let i = toInt(num(idx)); if (i < 0) i += base.length;
        if (i < 0 || i >= base.length) fail("Out of bounds get index '" + toInt(num(idx)) + "' (on base: 'String')", line);
        return base[i];
      }
      if (base instanceof Vec2) { const i = toInt(num(idx)); return i === 0 ? (base.i ? base.x : fl(base.x)) : (base.i ? base.y : fl(base.y)); }
      if (base instanceof GDObject && typeof idx === "string") return this.getProp(base, idx, line);
      fail('Invalid get index on a base of type "' + typeName(base) + '".', line);
    }

    getProp(base, name, line) {
      if (base === null || base === undefined) fail('Invalid access to property or key "' + name + '" on a base object of type "null instance".', line);
      if (base instanceof Vec2) {
        if (name === "x" || name === "y") return base.i ? base[name] : fl(base[name]);
        return new Callable("vmethod", { recv: base, name });
      }
      if (base instanceof Rect2) {
        if (name === "position") return base.position;
        if (name === "size") return base.size;
        if (name === "end") return base.end;
        return new Callable("vmethod", { recv: base, name });
      }
      if (base instanceof Color) {
        if ("rgba".includes(name) && name.length === 1) return fl(base[name]);
        return new Callable("vmethod", { recv: base, name });
      }
      if (base instanceof GDObject) {
        if (base.fields.has(name)) return base.fields.get(name);
        if (base.signals[name]) return base.signals[name];
        const f = this.findFunc(base.cls, name);
        if (f) return new Callable("method", { fn: f.fn, self: base, cls: f.cls, name });
        const k = this.findConst(base.cls, name);
        if (k) return k.v;
        if (this.host.getNative) { const r = this.host.getNative(base, name, this); if (r !== undefined) return r; }
        if (["get_class", "is_inside_tree", "free", "queue_free", "has_method", "get", "set", "connect", "emit_signal", "has_signal", "duplicate", "to_string", "get_instance_id"].includes(name))
          return new Callable("vmethod", { recv: base, name });
        fail('Invalid access to property or key "' + name + '" on a base object of type "' + typeName(base) + '".', line);
      }
      if (base instanceof GDClass) {
        if (name === "new") return new Callable("new", { cls: base, name: "new" });
        const k = this.findConst(base, name); if (k) return k.v;
        const f = base.funcs[name];
        if (f) { if (!f.isStatic) fail('Cannot call non-static function "' + name + '()" on the class "' + base.name + '" directly.', line); return new Callable("method", { fn: f, self: null, cls: base, name }); }
        fail('Cannot find member "' + name + '" in base "' + (base.name || "script") + '".', line);
      }
      if (base instanceof Map) {
        const k = mapFindKey(base, name);
        if (k !== undefined) return base.get(k);
        return new Callable("vmethod", { recv: base, name });
      }
      if (base instanceof GDSignal || base instanceof Callable || Array.isArray(base) || typeof base === "string" || isNum(base) || typeof base === "boolean")
        return new Callable("vmethod", { recv: base, name });
      if (base && base.__native) {
        if (this.host.getNative) { const r = this.host.getNative(base, name, this); if (r !== undefined) return r; }
        if (name in base) { const v = base[name]; return typeof v === "function" ? new Callable("jsfn", { fn: v.bind(base), name }) : v; }
        if (base.__statics && name in base.__statics) return base.__statics[name];
        fail('Invalid access to property or key "' + name + '" on a base object of type "' + base.__native + '".', line);
      }
      fail('Invalid access to property "' + name + '" on a base of type "' + typeName(base) + '".', line);
    }

    *evalCall(e, scope) {
      const args = [];
      for (const a of e.args) args.push(yield* this.eval(a, scope));
      const fn = e.fn;
      // super.method() / super()
      if (fn.t === "Attr" && fn.e.t === "Super") {
        const self = this.selfOf(scope); const cls = this.clsOf(scope);
        const base = cls && cls.base;
        const f = base && this.findFunc(base, fn.name);
        if (f) return this.invoke(f.fn, self, args, f.cls, e.line);
        if (this.host.callNative) { const r = this.host.callNative(self, fn.name, args, this, e.line, true); if (r !== undefined) return r; }
        return null;
      }
      if (fn.t === "Super") {
        const self = this.selfOf(scope); const cls = this.clsOf(scope);
        const f = cls.base && this.findFunc(cls.base, "_init");
        return f ? this.invoke(f.fn, self, args, f.cls, e.line) : null;
      }
      if (fn.t === "Name") {
        const name = fn.name;
        const local = scope.find(name);
        if (local) return this.callValue(local.vars.get(name), args, e.line, name);
        let cl = scope; let inClosure = null;
        while (cl) { if (cl.closure) { const cs = cl.closure.find(name); if (cs) { inClosure = cs; break; } } cl = cl.parent; }
        if (inClosure) return this.callValue(inClosure.vars.get(name), args, e.line, name);
        const self = this.selfOf(scope);
        const cls = this.clsOf(scope);
        // Virtual: a method called on self is looked up from self's own class
        // down, so a subclass's speak() wins inside the base class's describe().
        const f = (self instanceof GDObject ? this.findFunc(self.cls, name) : null) || this.findFunc(cls, name);
        if (f) {
          if (!f.fn.isStatic && !self) fail('Cannot call non-static function "' + name + '()" from a static function.', e.line);
          return this.invoke(f.fn, f.fn.isStatic ? null : self, args, f.cls, e.line);
        }
        if (self instanceof GDObject && self.fields.has(name)) return this.callValue(self.fields.get(name), args, e.line, name);
        if (TYPE_CTORS[name]) return TYPE_CTORS[name](args, e.line, this);
        if (BUILTIN_FUNCS[name]) return BUILTIN_FUNCS[name].call(this, args, e.line);
        if (self && this.host.callNative) { const r = this.host.callNative(self, name, args, this, e.line); if (r !== undefined) return r; }
        if (this.host.globalFuncs && this.host.globalFuncs[name]) return this.host.globalFuncs[name](args, e.line, this);
        const inner = this.findConst(cls, name);
        if (inner && inner.v instanceof GDClass) fail('Use "' + name + '.new()" to make an instance of a class.', e.line);
        fail('Function "' + name + '()" not found in base self.', e.line);
      }
      if (fn.t === "Attr") {
        const recv = yield* this.eval(fn.e, scope);
        return this.callMethod(recv, fn.name, args, e.line);
      }
      const callee = yield* this.eval(fn, scope);
      return this.callValue(callee, args, e.line);
    }
    callValue(v, args, line, name) {
      if (v instanceof Callable) return this.callCallable(v, args, line);
      fail('"' + (name || str(v)) + '" is not a function (it is a ' + typeName(v) + '). Use .call() on a Callable.', line);
    }
    callCallable(c, args, line) {
      switch (c.kind) {
        case "method": return this.invoke(c.fn, c.self, (c.binds ? args.concat(c.binds) : args), c.cls, line);
        case "lambda": return this.invoke(c.fn, c.self, (c.binds ? args.concat(c.binds) : args), c.cls, line, c.closure);
        case "builtin": return (TYPE_CTORS[c.name] || BUILTIN_FUNCS[c.name]).call(this, args, line, this);
        case "vmethod": return this.callMethod(c.recv, c.name, c.binds ? args.concat(c.binds) : args, line);
        case "new": return this.instantiate(c.cls, args, line);
        case "jsfn": return c.fn(...args);
      }
      fail("Invalid call.", line);
    }
    callMethodSync(obj, name, args) {
      const f = this.findFunc(obj.cls, name);
      const r = this.invoke(f.fn, obj, args, f.cls, 0);
      return r instanceof Pending ? null : r;
    }

    callMethod(recv, name, args, line) {
      if (recv === null || recv === undefined) fail('Cannot call method "' + name + '" on a null value.', line);
      if (recv instanceof GDObject) {
        const f = this.findFunc(recv.cls, name);
        if (f) return this.invoke(f.fn, recv, args, f.cls, line);
        if (recv.fields.has(name)) return this.callValue(recv.fields.get(name), args, line, name);
        if (this.host.callNative) { const r = this.host.callNative(recv, name, args, this, line); if (r !== undefined) return r; }
        return this.objectMethod(recv, name, args, line);
      }
      if (recv instanceof GDClass) {
        if (name === "new") return this.instantiate(recv, args, line);
        const f = recv.funcs[name];
        if (f) { if (!f.isStatic) fail('Cannot call non-static function "' + name + '()" on the class directly.', line); return this.invoke(f, null, args, recv, line); }
        fail('Static function "' + name + '()" not found in base "' + (recv.name || "script") + '".', line);
      }
      if (recv instanceof Callable) {
        if (name === "call") return this.callCallable(recv, args, line);
        if (name === "callv") return this.callCallable(recv, args[0], line);
        if (name === "bind") return new Callable(recv.kind, Object.assign({}, recv, { binds: (recv.binds || []).concat(args) }));
        if (name === "is_valid") return true;
        if (name === "get_method") return recv.name || "";
        fail('Invalid call. Nonexistent function "' + name + '" in base "Callable".', line);
      }
      if (recv instanceof GDSignal) {
        if (name === "connect") {
          const c = args[0]; if (!(c instanceof Callable)) fail("Signal.connect() needs a Callable – pass the function name without ().", line);
          if (recv.conns.some((x) => eq(x.callable, c))) fail('Signal "' + recv.name + '" is already connected to that function.', line);
          recv.conns.push({ callable: c, oneShot: args[1] === 4 }); return 0;
        }
        if (name === "disconnect") { const i = recv.conns.findIndex((x) => eq(x.callable, args[0])); if (i >= 0) recv.conns.splice(i, 1); return null; }
        if (name === "is_connected") return recv.conns.some((x) => eq(x.callable, args[0]));
        if (name === "emit") { this.emit(recv, args); return null; }
        if (name === "get_connections") return recv.conns.map((c) => new Map([["callable", c.callable]]));
        if (name === "get_name") return recv.name;
        fail('Invalid call. Nonexistent function "' + name + '" in base "Signal".', line);
      }
      if (recv && recv.__native) {
        if (this.host.callNative) { const r = this.host.callNative(recv, name, args, this, line); if (r !== undefined) return r; }
        if (typeof recv[name] === "function") return recv[name](...args);
        fail('Invalid call. Nonexistent function "' + name + '" in base "' + recv.__native + '".', line);
      }
      const m = methodsFor(recv);
      if (m && m[name]) return m[name].call(this, recv, args, line);
      fail('Invalid call. Nonexistent function "' + name + '" in base "' + typeName(recv) + '".', line);
    }
    objectMethod(o, name, args, line) {
      switch (name) {
        case "get_class": return o.cls.nativeBase;
        case "has_method": return !!this.findFunc(o.cls, args[0]);
        case "has_signal": return !!o.signals[args[0]];
        case "get": return o.fields.has(args[0]) ? o.fields.get(args[0]) : null;
        case "set": o.fields.set(args[0], args[1]); return null;
        case "emit_signal": { const s = o.signals[args[0]]; if (!s) fail('Signal "' + args[0] + '" not found.', line); this.emit(s, args.slice(1)); return null; }
        case "connect": { const s = o.signals[args[0]]; if (!s) fail('Signal "' + args[0] + '" not found.', line); return this.callMethod(s, "connect", [args[1]], line); }
        case "free": case "queue_free": o.freed = true; return null;
        case "is_inside_tree": return false;
        case "to_string": return str(o);
        case "get_instance_id": return o.id;
      }
      fail('Invalid call. Nonexistent function "' + name + '" in base "' + typeName(o) + '".', line);
    }

    binop(op, l, r, line) {
      const bad = () => fail('Invalid operands "' + typeName(l) + '" and "' + typeName(r) + '" in operator "' + op + '".', line);
      if (op === "==") return eq(l, r);
      if (op === "!=") return !eq(l, r);
      if (isNum(l) && isNum(r)) {
        const a = num(l), b = num(r), ints = isInt(l) && isInt(r);
        switch (op) {
          case "+": return ints ? a + b : fl(a + b);
          case "-": return ints ? a - b : fl(a - b);
          case "*": return ints ? a * b : fl(a * b);
          case "/":
            if (ints) { if (b === 0) fail("Division by zero error in operator '/'.", line); return toInt(a / b); }
            return fl(a / b);
          case "%":
            if (ints) { if (b === 0) fail("Modulo by zero error in operator '%'.", line); return a % b; }
            fail('Invalid operands "float" and "' + typeName(r) + '" in operator "%". Use fmod() for floats.', line);
          case "**": return ints && b >= 0 ? Math.pow(a, b) : fl(Math.pow(a, b));
          case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b;
          case "&": return ints ? a & b : bad(); case "|": return ints ? a | b : bad(); case "^": return ints ? a ^ b : bad();
          case "<<": return ints ? a << b : bad(); case ">>": return ints ? a >> b : bad();
        }
      }
      if (typeof l === "string" && typeof r === "string") {
        if (op === "+") return l + r;
        if (op === "<") return l < r; if (op === ">") return l > r; if (op === "<=") return l <= r; if (op === ">=") return l >= r;
      }
      if (typeof l === "string" && op === "%") return formatPercent(l, r, line);
      if (Array.isArray(l) && Array.isArray(r) && op === "+") return l.concat(r);
      if (l instanceof Vec2) {
        const I = l.i && (r instanceof Vec2 ? r.i : isInt(r));
        const mk = (x, y) => new Vec2(I ? toInt(x) : x, I ? toInt(y) : y, I);
        if (r instanceof Vec2) {
          switch (op) {
            case "+": return mk(l.x + r.x, l.y + r.y); case "-": return mk(l.x - r.x, l.y - r.y);
            case "*": return mk(l.x * r.x, l.y * r.y); case "/": return mk(l.x / r.x, l.y / r.y);
          }
        } else if (isNum(r)) {
          const b = num(r);
          if (op === "*") return mk(l.x * b, l.y * b);
          if (op === "/") { if (b === 0 && I) fail("Division by zero.", line); return mk(l.x / b, l.y / b); }
        }
      }
      if (isNum(l) && r instanceof Vec2 && op === "*") return new Vec2(num(l) * r.x, num(l) * r.y, r.i && isInt(l));
      if (l instanceof Color && r instanceof Color) {
        if (op === "*") return new Color(l.r * r.r, l.g * r.g, l.b * r.b, l.a * r.a);
        if (op === "+") return new Color(l.r + r.r, l.g + r.g, l.b + r.b, l.a + r.a);
        if (op === "-") return new Color(l.r - r.r, l.g - r.g, l.b - r.b, l.a - r.a);
      }
      if (l instanceof Color && isNum(r) && op === "*") { const b = num(r); return new Color(l.r * b, l.g * b, l.b * b, l.a * b); }
      if (typeof l === "string" && op === "+") fail('Invalid operands "String" and "' + typeName(r) + '" in operator "+". Use str() to turn the other side into text first.', line);
      if (typeof r === "string" && op === "+") fail('Invalid operands "' + typeName(l) + '" and "String" in operator "+". Use str() to turn the other side into text first.', line);
      return bad();
    }
  }

  // ───────────────────────────── built-ins ─────────────────────────────
  const argN = (args, n, name, line) => { if (args.length !== n) fail('Too ' + (args.length > n ? "many" : "few") + ' arguments for "' + name + '()" call. Expected ' + n + " but received " + args.length + ".", line); };
  const needNum = (v, name, line) => { if (!isNum(v)) fail('Invalid argument for "' + name + '()": a number is required, not ' + typeName(v) + ".", line); return num(v); };
  const sameKind = (a, b, v) => (isFloat(a) || isFloat(b) ? fl(v) : v);

  const TYPE_CTORS = {
    int(args, line) {
      const v = args[0];
      if (typeof v === "string") { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; }
      if (typeof v === "boolean") return v ? 1 : 0;
      if (!isNum(v)) fail('Cannot convert "' + typeName(v) + '" to int.', line);
      return toInt(num(v));
    },
    float(args, line) {
      const v = args[0];
      if (typeof v === "string") { const n = parseFloat(v); return fl(Number.isNaN(n) ? 0 : n); }
      if (typeof v === "boolean") return fl(v ? 1 : 0);
      if (!isNum(v)) fail('Cannot convert "' + typeName(v) + '" to float.', line);
      return fl(num(v));
    },
    bool(args) { return truthy(args[0]); },
    String(args) { return args.length ? str(args[0]) : ""; },
    str(args) { return args.map((a) => str(a)).join(""); },
    Array(args) { return args.length ? [...args[0]] : []; },
    Dictionary(args) { return args.length ? new Map(args[0]) : new Map(); },
    Vector2(args, line) {
      if (args.length === 0) return new Vec2(0, 0);
      if (args.length === 1 && args[0] instanceof Vec2) return new Vec2(args[0].x, args[0].y);
      argN(args, 2, "Vector2", line);
      return new Vec2(needNum(args[0], "Vector2", line), needNum(args[1], "Vector2", line));
    },
    Vector2i(args, line) {
      if (args.length === 0) return new Vec2(0, 0, true);
      if (args.length === 1 && args[0] instanceof Vec2) return new Vec2(toInt(args[0].x), toInt(args[0].y), true);
      argN(args, 2, "Vector2i", line);
      return new Vec2(toInt(needNum(args[0], "Vector2i", line)), toInt(needNum(args[1], "Vector2i", line)), true);
    },
    Rect2(args, line) {
      if (args.length === 0) return new Rect2(new Vec2(0, 0), new Vec2(0, 0));
      if (args.length === 2) return new Rect2(args[0], args[1]);
      argN(args, 4, "Rect2", line);
      return new Rect2(new Vec2(num(args[0]), num(args[1])), new Vec2(num(args[2]), num(args[3])));
    },
    Color(args, line) {
      if (args.length === 1 && typeof args[0] === "string") return colorFromHex(args[0], line);
      if (args.length === 2 && args[0] instanceof Color) return new Color(args[0].r, args[0].g, args[0].b, num(args[1]));
      if (args.length === 2 && typeof args[0] === "string") { const c = colorFromHex(args[0], line); c.a = num(args[1]); return c; }
      if (args.length === 3 || args.length === 4) return new Color(num(args[0]), num(args[1]), num(args[2]), args.length === 4 ? num(args[3]) : 1);
      if (args.length === 0) return new Color(0, 0, 0, 1);
      fail("Invalid arguments for Color().", line);
    },
    Callable(args) { return new Callable("vmethod", { recv: args[0], name: args[1] }); },
  };

  const BUILTIN_FUNCS = {
    print(args) { this.out(args.map((a) => str(a)).join("")); return null; },
    prints(args) { this.out(args.map((a) => str(a)).join(" ")); return null; },
    printt(args) { this.out(args.map((a) => str(a)).join("\t")); return null; },
    print_rich(args) { this.out(args.map((a) => str(a)).join("").replace(/\[\/?[a-z_=#0-9 ]+\]/gi, "")); return null; },
    printerr(args) { this.out("ERROR: " + args.map((a) => str(a)).join("")); return null; },
    push_error(args) { this.out("ERROR: " + args.map((a) => str(a)).join("")); return null; },
    push_warning(args) { this.out("WARNING: " + args.map((a) => str(a)).join("")); return null; },
    print_debug(args) { this.out(args.map((a) => str(a)).join("")); return null; },
    len(args, line) {
      const v = args[0];
      if (typeof v === "string" || Array.isArray(v)) return v.length;
      if (v instanceof Map) return v.size;
      fail('Invalid argument for "len()": a String, Array or Dictionary is required, not ' + typeName(v) + ".", line);
    },
    range(args, line) {
      const n = args.map((a) => { if (!isInt(a)) fail('Invalid argument for "range()": int expected, got ' + typeName(a) + ".", line); return a; });
      let a = 0, b, s = 1;
      if (n.length === 1) b = n[0]; else if (n.length === 2) [a, b] = n; else if (n.length === 3) [a, b, s] = n; else fail("range() takes 1 to 3 arguments.", line);
      if (s === 0) fail("range() step cannot be zero.", line);
      const out = []; for (let i = a; s > 0 ? i < b : i > b; i += s) { out.push(i); if (out.length > 1e6) fail("range() is too large.", line); }
      return out;
    },
    abs(args, line) { const v = args[0]; if (v instanceof Vec2) return new Vec2(Math.abs(v.x), Math.abs(v.y), v.i); return sameKind(v, v, Math.abs(needNum(v, "abs", line))); },
    absi(args, line) { return Math.abs(toInt(needNum(args[0], "absi", line))); },
    absf(args, line) { return fl(Math.abs(needNum(args[0], "absf", line))); },
    sign(args, line) { const v = args[0]; return sameKind(v, v, Math.sign(needNum(v, "sign", line))); },
    signi(args) { return Math.sign(num(args[0])); },
    signf(args) { return fl(Math.sign(num(args[0]))); },
    min(args, line) { if (args.length < 2) fail('Too few arguments for "min()".', line); let m = args[0]; for (const a of args) if (num(a) < num(m)) m = a; return args.some(isFloat) ? fl(num(m)) : m; },
    max(args, line) { if (args.length < 2) fail('Too few arguments for "max()".', line); let m = args[0]; for (const a of args) if (num(a) > num(m)) m = a; return args.some(isFloat) ? fl(num(m)) : m; },
    mini(args) { return Math.min(...args.map((a) => toInt(num(a)))); },
    maxi(args) { return Math.max(...args.map((a) => toInt(num(a)))); },
    minf(args) { return fl(Math.min(...args.map(num))); },
    maxf(args) { return fl(Math.max(...args.map(num))); },
    clamp(args, line) { argN(args, 3, "clamp", line); const v = Math.min(Math.max(num(args[0]), num(args[1])), num(args[2])); return args.some(isFloat) ? fl(v) : v; },
    clampi(args) { return toInt(Math.min(Math.max(num(args[0]), num(args[1])), num(args[2]))); },
    clampf(args) { return fl(Math.min(Math.max(num(args[0]), num(args[1])), num(args[2]))); },
    floor(args) { const v = args[0]; return isInt(v) ? v : fl(Math.floor(num(v))); },
    ceil(args) { const v = args[0]; return isInt(v) ? v : fl(Math.ceil(num(v))); },
    round(args) { const v = args[0]; if (v instanceof Vec2) return new Vec2(Math.round(v.x), Math.round(v.y), v.i); return isInt(v) ? v : fl(Math.sign(num(v)) * Math.round(Math.abs(num(v)))); },
    floori(args) { return Math.floor(num(args[0])); },
    ceili(args) { return Math.ceil(num(args[0])); },
    roundi(args) { return Math.sign(num(args[0])) * Math.round(Math.abs(num(args[0]))); },
    floorf(args) { return fl(Math.floor(num(args[0]))); },
    ceilf(args) { return fl(Math.ceil(num(args[0]))); },
    roundf(args) { return fl(Math.sign(num(args[0])) * Math.round(Math.abs(num(args[0])))); },
    sqrt(args, line) { return fl(Math.sqrt(needNum(args[0], "sqrt", line))); },
    pow(args) { return fl(Math.pow(num(args[0]), num(args[1]))); },
    exp(args) { return fl(Math.exp(num(args[0]))); },
    log(args) { return fl(Math.log(num(args[0]))); },
    sin(args) { return fl(Math.sin(num(args[0]))); },
    cos(args) { return fl(Math.cos(num(args[0]))); },
    tan(args) { return fl(Math.tan(num(args[0]))); },
    atan(args) { return fl(Math.atan(num(args[0]))); },
    atan2(args) { return fl(Math.atan2(num(args[0]), num(args[1]))); },
    asin(args) { return fl(Math.asin(num(args[0]))); },
    acos(args) { return fl(Math.acos(num(args[0]))); },
    deg_to_rad(args) { return fl(num(args[0]) * Math.PI / 180); },
    rad_to_deg(args) { return fl(num(args[0]) * 180 / Math.PI); },
    fmod(args) { return fl(num(args[0]) % num(args[1])); },
    fposmod(args) { const b = num(args[1]); let m = num(args[0]) % b; if (m < 0 !== b < 0 && m !== 0) m += b; return fl(m); },
    posmod(args) { const b = toInt(num(args[1])); let m = toInt(num(args[0])) % b; if (m < 0 !== b < 0 && m !== 0) m += b; return m; },
    lerp(args, line) {
      argN(args, 3, "lerp", line);
      const [a, b, t] = args;
      if (a instanceof Vec2) return new Vec2(a.x + (b.x - a.x) * num(t), a.y + (b.y - a.y) * num(t));
      if (a instanceof Color) return new Color(a.r + (b.r - a.r) * num(t), a.g + (b.g - a.g) * num(t), a.b + (b.b - a.b) * num(t), a.a + (b.a - a.a) * num(t));
      return fl(num(a) + (num(b) - num(a)) * num(t));
    },
    lerpf(args) { return fl(num(args[0]) + (num(args[1]) - num(args[0])) * num(args[2])); },
    inverse_lerp(args) { return fl((num(args[2]) - num(args[0])) / (num(args[1]) - num(args[0]))); },
    remap(args) { const [v, a, b, c, d] = args.map(num); return fl(c + (d - c) * ((v - a) / (b - a))); },
    move_toward(args) { const [a, b, d] = args.map(num); return fl(Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d); },
    snapped(args) { const s = num(args[1]); const v = s === 0 ? num(args[0]) : Math.round(num(args[0]) / s) * s; return isFloat(args[0]) || isFloat(args[1]) ? fl(v) : toInt(v); },
    snappedf(args) { const s = num(args[1]); return fl(s === 0 ? num(args[0]) : Math.round(num(args[0]) / s) * s); },
    wrapi(args) { const [v, a, b] = args.map((x) => toInt(num(x))); const r = b - a; return r === 0 ? a : a + ((((v - a) % r) + r) % r); },
    wrapf(args) { const [v, a, b] = args.map(num); const r = b - a; return fl(r === 0 ? a : a + ((((v - a) % r) + r) % r)); },
    is_equal_approx(args) { return Math.abs(num(args[0]) - num(args[1])) < 1e-5; },
    is_zero_approx(args) { return Math.abs(num(args[0])) < 1e-5; },
    is_nan(args) { return Number.isNaN(num(args[0])); },
    is_inf(args) { return !Number.isFinite(num(args[0])) && !Number.isNaN(num(args[0])); },
    smoothstep(args) { const [a, b, x] = args.map(num); const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return fl(t * t * (3 - 2 * t)); },
    randi() { return Math.floor(this.rng.next() * 4294967296); },
    randf() { return fl(this.rng.next()); },
    randi_range(args) { const a = toInt(num(args[0])), b = toInt(num(args[1])); const lo = Math.min(a, b), hi = Math.max(a, b); return lo + Math.floor(this.rng.next() * (hi - lo + 1)); },
    randf_range(args) { const a = num(args[0]), b = num(args[1]); return fl(a + this.rng.next() * (b - a)); },
    randomize() { return null; },
    seed(args) { this.rng.seed(toInt(num(args[0]))); return null; },
    typeof(args) { const n = typeName(args[0]); return { Nil: 0, bool: 1, int: 2, float: 3, String: 4, Vector2: 5, Vector2i: 6, Rect2: 7, Color: 20, Callable: 25, Signal: 26, Dictionary: 27, Array: 28 }[n] ?? 24; },
    type_string(args) { return ["Nil", "bool", "int", "float", "String", "Vector2", "Vector2i", "Rect2"][toInt(num(args[0]))] || "Object"; },
    assert(args, line) { if (!truthy(args[0])) fail("Assertion failed" + (args[1] ? ": " + str(args[1]) : "."), line); return null; },
    is_instance_valid(args) { const v = args[0]; return v !== null && v !== undefined && !(v instanceof GDObject && v.freed); },
    char(args) { return String.fromCodePoint(toInt(num(args[0]))); },
    hash(args) { const s = str(args[0], true); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0; },
    var_to_str(args) { return str(args[0], true); },
    get_stack() { return []; },
    // A Node's way to the tree. With no scene there is still a clock, so
    // `await get_tree().create_timer(1.0).timeout` works in every exercise.
    get_tree() {
      if (this.host.getTree) return this.host.getTree(this);
      if (!this.tree) {
        const self = this;
        this.tree = { __native: "SceneTree", create_timer: (t) => self.makeTimer(t), quit: () => null,
          get_frame: () => 0, paused: false };
      }
      return this.tree;
    },
    weakref(args) { return args[0]; },
    instance_from_id() { return null; },
  };

  // ── methods on built-in types ──
  const STRING_METHODS = {
    length(s) { return s.length; },
    is_empty(s) { return s.length === 0; },
    to_upper(s) { return s.toUpperCase(); },
    to_lower(s) { return s.toLowerCase(); },
    capitalize(s) { return s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" "); },
    to_snake_case(s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase(); },
    to_camel_case(s) { const p = s.split(/[_\s]+/); return p[0].toLowerCase() + p.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join(""); },
    to_pascal_case(s) { return s.split(/[_\s]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : "")).join(""); },
    begins_with(s, a) { return s.startsWith(a[0]); },
    ends_with(s, a) { return s.endsWith(a[0]); },
    contains(s, a) { return s.includes(a[0]); },
    containsn(s, a) { return s.toLowerCase().includes(String(a[0]).toLowerCase()); },
    find(s, a) { return s.indexOf(a[0], a[1] ? num(a[1]) : 0); },
    findn(s, a) { return s.toLowerCase().indexOf(String(a[0]).toLowerCase()); },
    rfind(s, a) { return s.lastIndexOf(a[0]); },
    count(s, a) { if (!a[0]) return 0; return s.split(a[0]).length - 1; },
    substr(s, a) { const from = toInt(num(a[0])); const len = a.length > 1 ? toInt(num(a[1])) : -1; return len < 0 ? s.slice(from) : s.substr(from, len); },
    left(s, a) { const n = toInt(num(a[0])); return n < 0 ? s.slice(0, s.length + n) : s.slice(0, n); },
    right(s, a) { const n = toInt(num(a[0])); return n < 0 ? s.slice(-n) : s.slice(Math.max(0, s.length - n)); },
    split(s, a) {
      const sep = a.length ? a[0] : ""; const allowEmpty = a.length > 1 ? truthy(a[1]) : true;
      let parts = sep === "" ? [...s] : s.split(sep);
      if (!allowEmpty) parts = parts.filter((x) => x !== "");
      return parts;
    },
    split_floats(s, a) { return s.split(a[0]).map((x) => fl(parseFloat(x) || 0)); },
    join(s, a) { return a[0].map((x) => str(x)).join(s); },
    strip_edges(s, a) { const l = a.length ? truthy(a[0]) : true, r = a.length > 1 ? truthy(a[1]) : true; let x = s; if (l) x = x.replace(/^\s+/, ""); if (r) x = x.replace(/\s+$/, ""); return x; },
    lstrip(s, a) { let x = s; while (x.length && a[0].includes(x[0])) x = x.slice(1); return x; },
    rstrip(s, a) { let x = s; while (x.length && a[0].includes(x[x.length - 1])) x = x.slice(0, -1); return x; },
    trim_prefix(s, a) { return s.startsWith(a[0]) ? s.slice(a[0].length) : s; },
    trim_suffix(s, a) { return s.endsWith(a[0]) && a[0] ? s.slice(0, -a[0].length) : s; },
    replace(s, a) { return a[0] === "" ? s : s.split(a[0]).join(a[1]); },
    replacen(s, a) { return s.replace(new RegExp(a[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), a[1]); },
    repeat(s, a) { return s.repeat(Math.max(0, toInt(num(a[0])))); },
    reverse(s) { return [...s].reverse().join(""); },
    insert(s, a) { const i = toInt(num(a[0])); return s.slice(0, i) + a[1] + s.slice(i); },
    to_int(s) { const m = s.match(/-?\d+/); return m ? parseInt(m[0], 10) : 0; },
    to_float(s) { const n = parseFloat(s); return fl(Number.isNaN(n) ? 0 : n); },
    is_valid_int(s) { return /^[+-]?\d+$/.test(s); },
    is_valid_float(s) { return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s); },
    is_valid_identifier(s) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s); },
    pad_zeros(s, a) { const n = toInt(num(a[0])); const neg = s.startsWith("-"); const body = neg ? s.slice(1) : s; const [i, d] = body.split("."); return (neg ? "-" : "") + i.padStart(n, "0") + (d !== undefined ? "." + d : ""); },
    pad_decimals(s, a) { const n = toInt(num(a[0])); const v = parseFloat(s); return v.toFixed(n); },
    lpad(s, a) { return s.padStart(toInt(num(a[0])), a.length > 1 ? a[1] : " "); },
    rpad(s, a) { return s.padEnd(toInt(num(a[0])), a.length > 1 ? a[1] : " "); },
    unicode_at(s, a) { return s.codePointAt(toInt(num(a[0]))); },
    get_slice(s, a) { return s.split(a[0])[toInt(num(a[1]))] || ""; },
    get_slice_count(s, a) { return s.split(a[0]).length; },
    format(s, a) {
      const d = a[0];
      if (d instanceof Map) { let x = s; for (const [k, v] of d) x = x.split("{" + str(k) + "}").join(str(v)); return x; }
      if (Array.isArray(d)) { let x = s; d.forEach((v, i) => { x = x.split("{" + i + "}").join(str(v)); }); return x; }
      return s;
    },
    c_escape(s) { return JSON.stringify(s).slice(1, -1); },
    md5_text(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(16).padStart(8, "0"); },
    to_utf8_buffer(s) { return [...new TextEncoder().encode(s)]; },
    hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h >>> 0; },
    similarity(s, a) { const t = a[0]; if (s === t) return fl(1); const bi = (x) => { const o = []; for (let i = 0; i < x.length - 1; i++) o.push(x.substr(i, 2)); return o; }; const A = bi(s), B = bi(t); if (!A.length || !B.length) return fl(0); let m = 0; const Bc = [...B]; for (const p of A) { const i = Bc.indexOf(p); if (i >= 0) { m++; Bc.splice(i, 1); } } return fl((2 * m) / (A.length + B.length)); },
  };
  function callSorted(interp, arr, fn, line) {
    // insertion of a JS comparator that asks the GDScript callable "a before b?"
    return arr.sort((a, b) => {
      if (truthy(interp.callCallable(fn, [a, b], line))) return -1;
      if (truthy(interp.callCallable(fn, [b, a], line))) return 1;
      return 0;
    });
  }
  function natCompare(a, b) {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (isNum(a)) return num(a) - num(b);
    if (typeof a === "string") return a < b ? -1 : a > b ? 1 : 0;
    return 0;
  }
  function rank(v) { return v === null ? 0 : typeof v === "boolean" ? 1 : isNum(v) ? 2 : typeof v === "string" ? 3 : 4; }

  const ARRAY_METHODS = {
    size(a) { return a.length; },
    is_empty(a) { return a.length === 0; },
    append(a, x) { a.push(x[0]); return null; },
    push_back(a, x) { a.push(x[0]); return null; },
    push_front(a, x) { a.unshift(x[0]); return null; },
    append_array(a, x) { a.push(...x[0]); return null; },
    insert(a, x) { a.splice(toInt(num(x[0])), 0, x[1]); return 0; },
    remove_at(a, x, line) { const i = toInt(num(x[0])); if (i < 0 || i >= a.length) fail("Index p_index = " + i + " is out of bounds (size() = " + a.length + ").", line); a.splice(i, 1); return null; },
    erase(a, x) { const i = a.findIndex((v) => eq(v, x[0])); if (i >= 0) a.splice(i, 1); return null; },
    pop_back(a) { return a.length ? a.pop() : null; },
    pop_front(a) { return a.length ? a.shift() : null; },
    pop_at(a, x) { const i = toInt(num(x[0])); return a.splice(i < 0 ? a.length + i : i, 1)[0] ?? null; },
    front(a, x, line) { if (!a.length) fail("Can't take value from empty array.", line); return a[0]; },
    back(a, x, line) { if (!a.length) fail("Can't take value from empty array.", line); return a[a.length - 1]; },
    has(a, x) { return a.some((v) => eq(v, x[0])); },
    find(a, x) { const from = x.length > 1 ? toInt(num(x[1])) : 0; for (let i = from; i < a.length; i++) if (eq(a[i], x[0])) return i; return -1; },
    rfind(a, x) { for (let i = a.length - 1; i >= 0; i--) if (eq(a[i], x[0])) return i; return -1; },
    count(a, x) { return a.filter((v) => eq(v, x[0])).length; },
    clear(a) { a.length = 0; return null; },
    sort(a) { a.sort(natCompare); return null; },
    sort_custom(a, x, line) { callSorted(this, a, x[0], line); return null; },
    reverse(a) { a.reverse(); return null; },
    duplicate(a, x) { return x.length && truthy(x[0]) ? deepCopy(a) : [...a]; },
    slice(a, x) { const b = toInt(num(x[0])); const e = x.length > 1 ? toInt(num(x[1])) : a.length; return a.slice(b, e); },
    filter(a, x, line) { return a.filter((v) => truthy(this.callCallable(x[0], [v], line))); },
    map(a, x, line) { return a.map((v) => this.callCallable(x[0], [v], line)); },
    reduce(a, x, line) {
      let acc, start = 0;
      if (x.length > 1) acc = x[1]; else { if (!a.length) return null; acc = a[0]; start = 1; }
      for (let i = start; i < a.length; i++) acc = this.callCallable(x[0], [acc, a[i]], line);
      return acc;
    },
    any(a, x, line) { return a.some((v) => truthy(this.callCallable(x[0], [v], line))); },
    all(a, x, line) { return a.every((v) => truthy(this.callCallable(x[0], [v], line))); },
    max(a) { if (!a.length) return null; let m = a[0]; for (const v of a) if (natCompare(v, m) > 0) m = v; return m; },
    min(a) { if (!a.length) return null; let m = a[0]; for (const v of a) if (natCompare(v, m) < 0) m = v; return m; },
    pick_random(a) { return a.length ? a[Math.floor(this.rng.next() * a.length)] : null; },
    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return null; },
    resize(a, x) { const n = toInt(num(x[0])); while (a.length < n) a.push(null); a.length = n; return 0; },
    fill(a, x) { a.fill(x[0]); return null; },
    bsearch(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (natCompare(a[m], x[0]) < 0) lo = m + 1; else hi = m; } return lo; },
    hash(a) { return BUILTIN_FUNCS.hash.call(this, [a]); },
  };
  const DICT_METHODS = {
    size(d) { return d.size; },
    is_empty(d) { return d.size === 0; },
    has(d, x) { return mapFindKey(d, x[0]) !== undefined; },
    has_all(d, x) { return x[0].every((k) => mapFindKey(d, k) !== undefined); },
    get(d, x) { const k = mapFindKey(d, x[0]); return k !== undefined ? d.get(k) : (x.length > 1 ? x[1] : null); },
    get_or_add(d, x) { const k = mapFindKey(d, x[0]); if (k !== undefined) return d.get(k); d.set(x[0], x[1] ?? null); return x[1] ?? null; },
    keys(d) { return [...d.keys()]; },
    values(d) { return [...d.values()]; },
    erase(d, x) { const k = mapFindKey(d, x[0]); if (k === undefined) return false; d.delete(k); return true; },
    clear(d) { d.clear(); return null; },
    merge(d, x) { const over = x.length > 1 && truthy(x[1]); for (const [k, v] of x[0]) { const ek = mapFindKey(d, k); if (ek === undefined) d.set(k, v); else if (over) d.set(ek, v); } return null; },
    merged(d, x) { const m = new Map(d); DICT_METHODS.merge(m, x); return m; },
    duplicate(d, x) { return x.length && truthy(x[0]) ? deepCopy(d) : new Map(d); },
    find_key(d, x) { for (const [k, v] of d) if (eq(v, x[0])) return k; return null; },
    hash(d) { return BUILTIN_FUNCS.hash.call(this, [d]); },
  };
  const VEC_METHODS = {
    length(v) { return fl(Math.hypot(v.x, v.y)); },
    length_squared(v) { return fl(v.x * v.x + v.y * v.y); },
    normalized(v) { const l = Math.hypot(v.x, v.y); return l === 0 ? new Vec2(0, 0) : new Vec2(v.x / l, v.y / l); },
    is_normalized(v) { return Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-5; },
    distance_to(v, a) { return fl(Math.hypot(a[0].x - v.x, a[0].y - v.y)); },
    distance_squared_to(v, a) { return fl((a[0].x - v.x) ** 2 + (a[0].y - v.y) ** 2); },
    direction_to(v, a) { return VEC_METHODS.normalized(new Vec2(a[0].x - v.x, a[0].y - v.y)); },
    angle(v) { return fl(Math.atan2(v.y, v.x)); },
    angle_to_point(v, a) { return fl(Math.atan2(a[0].y - v.y, a[0].x - v.x)); },
    dot(v, a) { return fl(v.x * a[0].x + v.y * a[0].y); },
    cross(v, a) { return fl(v.x * a[0].y - v.y * a[0].x); },
    rotated(v, a) { const t = num(a[0]); const c = Math.cos(t), s = Math.sin(t); return new Vec2(v.x * c - v.y * s, v.x * s + v.y * c); },
    lerp(v, a) { const t = num(a[1]); return new Vec2(v.x + (a[0].x - v.x) * t, v.y + (a[0].y - v.y) * t); },
    move_toward(v, a) { const d = num(a[1]); const dx = a[0].x - v.x, dy = a[0].y - v.y; const l = Math.hypot(dx, dy); if (l <= d || l === 0) return a[0]; return new Vec2(v.x + dx / l * d, v.y + dy / l * d); },
    limit_length(v, a) { const m = a.length ? num(a[0]) : 1; const l = Math.hypot(v.x, v.y); return l > m && l > 0 ? new Vec2(v.x / l * m, v.y / l * m) : v; },
    clamp(v, a) { return new Vec2(Math.min(Math.max(v.x, a[0].x), a[1].x), Math.min(Math.max(v.y, a[0].y), a[1].y), v.i); },
    abs(v) { return new Vec2(Math.abs(v.x), Math.abs(v.y), v.i); },
    round(v) { return new Vec2(Math.round(v.x), Math.round(v.y), v.i); },
    floor(v) { return new Vec2(Math.floor(v.x), Math.floor(v.y), v.i); },
    ceil(v) { return new Vec2(Math.ceil(v.x), Math.ceil(v.y), v.i); },
    sign(v) { return new Vec2(Math.sign(v.x), Math.sign(v.y), v.i); },
    snapped(v, a) { const s = a[0]; return new Vec2(s.x ? Math.round(v.x / s.x) * s.x : v.x, s.y ? Math.round(v.y / s.y) * s.y : v.y, v.i); },
    is_equal_approx(v, a) { return Math.abs(v.x - a[0].x) < 1e-5 && Math.abs(v.y - a[0].y) < 1e-5; },
    is_zero_approx(v) { return Math.abs(v.x) < 1e-5 && Math.abs(v.y) < 1e-5; },
    orthogonal(v) { return new Vec2(v.y, -v.x, v.i); },
    aspect(v) { return fl(v.x / v.y); },
    min(v, a) { return new Vec2(Math.min(v.x, a[0].x), Math.min(v.y, a[0].y), v.i); },
    max(v, a) { return new Vec2(Math.max(v.x, a[0].x), Math.max(v.y, a[0].y), v.i); },
  };
  const RECT_METHODS = {
    has_point(r, a) { const p = a[0]; return p.x >= r.position.x && p.y >= r.position.y && p.x < r.position.x + r.size.x && p.y < r.position.y + r.size.y; },
    intersects(r, a) { const o = a[0]; return r.position.x < o.position.x + o.size.x && o.position.x < r.position.x + r.size.x && r.position.y < o.position.y + o.size.y && o.position.y < r.position.y + r.size.y; },
    encloses(r, a) { const o = a[0]; return o.position.x >= r.position.x && o.position.y >= r.position.y && o.position.x + o.size.x <= r.position.x + r.size.x && o.position.y + o.size.y <= r.position.y + r.size.y; },
    get_center(r) { return new Vec2(r.position.x + r.size.x / 2, r.position.y + r.size.y / 2); },
    get_area(r) { return fl(r.size.x * r.size.y); },
    grow(r, a) { const g = num(a[0]); return new Rect2(new Vec2(r.position.x - g, r.position.y - g), new Vec2(r.size.x + 2 * g, r.size.y + 2 * g)); },
    merge(r, a) { const o = a[0]; const x0 = Math.min(r.position.x, o.position.x), y0 = Math.min(r.position.y, o.position.y); const x1 = Math.max(r.position.x + r.size.x, o.position.x + o.size.x), y1 = Math.max(r.position.y + r.size.y, o.position.y + o.size.y); return new Rect2(new Vec2(x0, y0), new Vec2(x1 - x0, y1 - y0)); },
    intersection(r, a) { const o = a[0]; const x0 = Math.max(r.position.x, o.position.x), y0 = Math.max(r.position.y, o.position.y); const x1 = Math.min(r.position.x + r.size.x, o.position.x + o.size.x), y1 = Math.min(r.position.y + r.size.y, o.position.y + o.size.y); return x1 <= x0 || y1 <= y0 ? new Rect2(new Vec2(0, 0), new Vec2(0, 0)) : new Rect2(new Vec2(x0, y0), new Vec2(x1 - x0, y1 - y0)); },
    expand(r, a) { return RECT_METHODS.merge(r, [new Rect2(a[0], new Vec2(0, 0))]); },
    abs(r) { return r; },
    has_area(r) { return r.size.x > 0 && r.size.y > 0; },
  };
  const COLOR_METHODS = {
    darkened(c, a) { const k = 1 - num(a[0]); return new Color(c.r * k, c.g * k, c.b * k, c.a); },
    lightened(c, a) { const k = num(a[0]); return new Color(c.r + (1 - c.r) * k, c.g + (1 - c.g) * k, c.b + (1 - c.b) * k, c.a); },
    lerp(c, a) { const o = a[0], t = num(a[1]); return new Color(c.r + (o.r - c.r) * t, c.g + (o.g - c.g) * t, c.b + (o.b - c.b) * t, c.a + (o.a - c.a) * t); },
    to_html(c, a) { const q = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0"); return q(c.r) + q(c.g) + q(c.b) + (a.length && !truthy(a[0]) ? "" : q(c.a)); },
    inverted(c) { return new Color(1 - c.r, 1 - c.g, 1 - c.b, c.a); },
    get_luminance(c) { return fl(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b); },
    is_equal_approx(c, a) { const o = a[0]; return ["r", "g", "b", "a"].every((k) => Math.abs(c[k] - o[k]) < 1e-5); },
  };
  const NUM_METHODS = {};
  function methodsFor(v) {
    if (typeof v === "string") return STRING_METHODS_WRAPPED;
    if (Array.isArray(v)) return ARRAY_METHODS;
    if (v instanceof Map) return DICT_METHODS;
    if (v instanceof Vec2) return VEC_METHODS;
    if (v instanceof Rect2) return RECT_METHODS;
    if (v instanceof Color) return COLOR_METHODS;
    if (isNum(v)) return NUM_METHODS;
    return null;
  }
  const STRING_METHODS_WRAPPED = {};
  for (const k of Object.keys(STRING_METHODS)) STRING_METHODS_WRAPPED[k] = function (s, a, line) { return STRING_METHODS[k].call(this, s, a, line); };

  // ── global singletons and constants ──
  const COLOR_NS = { __native: "Color", __statics: {} };
  for (const [k, c] of Object.entries(NAMED_COLORS)) COLOR_NS.__statics[k] = new Color(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);
  const JSON_NS = {
    __native: "JSON",
    stringify(v, indent) {
      const conv = (x) => {
        if (x instanceof F) return x.v;
        if (x instanceof Map) { const o = {}; for (const [k, y] of x) o[str(k)] = conv(y); return o; }
        if (Array.isArray(x)) return x.map(conv);
        if (x instanceof Vec2) return str(x);
        if (x instanceof Color) return str(x);
        return x;
      };
      return JSON.stringify(conv(v), null, indent ? (typeof indent === "string" ? indent : num(indent)) : undefined);
    },
    parse_string(s) {
      let o; try { o = JSON.parse(s); } catch (e) { return null; }
      const conv = (x) => {
        if (typeof x === "number") return fl(x); // JSON numbers come back as float, as in Godot
        if (Array.isArray(x)) return x.map(conv);
        if (x && typeof x === "object") { const m = new Map(); for (const k of Object.keys(x)) m.set(k, conv(x[k])); return m; }
        return x;
      };
      return conv(o);
    },
  };
  const VECTOR2_NS = { __native: "Vector2", __statics: { ZERO: new Vec2(0, 0), ONE: new Vec2(1, 1), UP: new Vec2(0, -1), DOWN: new Vec2(0, 1), LEFT: new Vec2(-1, 0), RIGHT: new Vec2(1, 0), INF: new Vec2(Infinity, Infinity) } };
  const VECTOR2I_NS = { __native: "Vector2i", __statics: { ZERO: new Vec2(0, 0, true), ONE: new Vec2(1, 1, true), UP: new Vec2(0, -1, true), DOWN: new Vec2(0, 1, true), LEFT: new Vec2(-1, 0, true), RIGHT: new Vec2(1, 0, true) } };
  const GLOBALS = {
    PI: fl(Math.PI), TAU: fl(Math.PI * 2), INF: fl(Infinity), NAN: fl(NaN),
    JSON: JSON_NS,
    OK: 0, FAILED: 1, ERR_FILE_NOT_FOUND: 7,
    CONNECT_ONE_SHOT: 4, CONNECT_DEFERRED: 1,
    TYPE_NIL: 0, TYPE_BOOL: 1, TYPE_INT: 2, TYPE_FLOAT: 3, TYPE_STRING: 4, TYPE_VECTOR2: 5, TYPE_DICTIONARY: 27, TYPE_ARRAY: 28,
    HORIZONTAL_ALIGNMENT_LEFT: 0, HORIZONTAL_ALIGNMENT_CENTER: 1, HORIZONTAL_ALIGNMENT_RIGHT: 2,
    KEY_LEFT: 4194319, KEY_UP: 4194320, KEY_RIGHT: 4194321, KEY_DOWN: 4194322, KEY_SPACE: 32, KEY_ENTER: 4194309, KEY_ESCAPE: 4194305,
    MOUSE_BUTTON_LEFT: 1, MOUSE_BUTTON_RIGHT: 2,
  };
  // Type names used as values (Vector2.ZERO, Color.RED) resolve through these.
  const TYPE_NAMESPACES = { Vector2: VECTOR2_NS, Vector2i: VECTOR2I_NS, Color: COLOR_NS };

  // the interpreter's lookup of a Name that is a constructor used as a namespace
  const origLookup = Interp.prototype.lookup;
  Interp.prototype.lookup = function (name, scope, line) {
    if (TYPE_NAMESPACES[name] && !scope.find(name)) {
      const self = this.selfOf(scope);
      if (!(self instanceof GDObject && self.fields.has(name))) return TYPE_NAMESPACES[name];
    }
    return origLookup.call(this, name, scope, line);
  };
  const origCallValue = Interp.prototype.callValue;
  Interp.prototype.callValue = function (v, args, line, name) {
    if (v && v.__native && TYPE_CTORS[v.__native]) return TYPE_CTORS[v.__native](args, line, this);
    return origCallValue.call(this, v, args, line, name);
  };

  // ───────────────────────────── public API ─────────────────────────────
  /**
   * Compile and instantiate a script. Returns {interp, obj, cls} or throws GDError.
   * opts.output(line) receives print() output; opts.host extends the runtime.
   */
  function load(source, opts) {
    opts = opts || {};
    const interp = new Interp(opts);
    return attach(interp, source);
  }

  /**
   * One more script in an interpreter that already has some: how the workshop
   * gives every node in a scene its own script while their signals, $paths
   * and timers all live in one world. `native` is handed to host.makeNative.
   */
  function attach(interp, source, native) {
    const decl = parse(source);
    const first = interp.mainClass;
    const cls = interp.buildClass(decl, null, decl.className || "");
    if (!decl.ext) cls.nativeBase = "RefCounted";
    // While it is built, this script is "the" script: its own class_name and
    // constants resolve first. Afterwards the first script keeps that place.
    interp.mainClass = cls;
    interp.pendingNative = native;
    try {
      const obj = interp.instantiate(cls, [], 0);
      return { interp, obj, cls };
    } finally {
      interp.mainClass = first || cls;
      interp.pendingNative = undefined;
    }
  }

  /** Call a function on a loaded script; awaits are run to completion with virtual time. */
  function call(loaded, name, args) {
    const f = loaded.interp.findFunc(loaded.cls, name);
    if (!f) fail('Function "' + name + '()" is not defined in your script.', 0);
    const r = loaded.interp.invoke(f.fn, f.fn.isStatic ? null : loaded.obj, args || [], f.cls, 0);
    return r;
  }

  /** Evaluate a GDScript expression in the context of a loaded script. */
  function evaluate(loaded, exprSource) {
    const decl = parse("func __expr():\n\treturn " + exprSource + "\n");
    const fn = decl.items[0];
    const r = loaded.interp.invoke(fn, loaded.obj, [], loaded.cls, 0);
    if (r instanceof Pending) { loaded.interp.drainTimers(); return r.task.done ? r.task.value : null; }
    return r;
  }

  /**
   * Run a script the way a scene's root would: build it, run _ready(), then let
   * any timers it started fire. Returns {output, error, loaded}.
   */
  function run(source, opts) {
    opts = opts || {};
    const lines = [];
    const out = (s) => { lines.push(s); if (opts.output) opts.output(s); };
    let loaded = null;
    try {
      loaded = load(source, Object.assign({}, opts, { output: out }));
      loaded.interp.runOnready(loaded.obj);
      if (loaded.interp.findFunc(loaded.cls, "_ready")) call(loaded, "_ready", []);
      if (opts.drain !== false) loaded.interp.drainTimers(opts.maxTime);
      return { output: lines, error: null, loaded };
    } catch (e) {
      if (e instanceof GDError) return { output: lines, error: e, loaded };
      throw e;
    }
  }

  const api = {
    lex, parse, load, attach, run, call, evaluate, str, typeName, eq, truthy, num,
    GDError, F, Vec2, Rect2, Color, Callable, GDSignal, GDObject, GDClass, Pending,
    fl, isInt, isFloat, isNum, formatPercent, colorFromHex,
    _BUILTIN_FUNCS: BUILTIN_FUNCS, _TYPE_CTORS: TYPE_CTORS, _GLOBALS: GLOBALS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GD = api;
})(typeof window !== "undefined" ? window : globalThis);
