/* checker.js – runs an exercise's checks against some code.
 *
 * Shared by the page (the Check button) and by tools/check.js, which proves
 * every solution in the book passes and every starter does not – so an
 * exercise cannot ship that nobody can solve, or that is already solved.
 */
(function (root) {
  "use strict";
  function check(spec, code, GD, CanvasHost) {
    const output = [];
    const results = [];
    const host = spec.mode === "canvas" ? CanvasHost.forCheck() : undefined;
    const r = GD.run(code, { output: (s) => output.push(s), host, drain: spec.mode !== "canvas" });
    if (r.error) return { error: r.error, results, output };
    const loaded = r.loaded;
    for (const t of spec.tests || []) {
      try {
        if (t.output !== undefined) {
          const want = [].concat(t.output);
          const ok = t.contains
            ? want.every((w) => output.some((g) => g.includes(w)))
            : output.length === want.length && output.every((g, i) => g === want[i]);
          results.push({ label: t.label || "prints " + want.map((w) => JSON.stringify(w)).join(", "), ok,
            detail: ok ? "" : "printed " + (output.length ? output.map((g) => JSON.stringify(g)).join(", ") : "nothing") });
          continue;
        }
        if (t.source !== undefined) {
          const found = new RegExp(t.source, t.flags || "m").test(code);
          const ok = t.not ? !found : found;
          results.push({ label: t.label || (t.not ? "does not use " : "uses ") + t.source, ok, detail: ok ? "" : t.why || "" });
          continue;
        }
        if (t.simulate) CanvasHost.simulate(loaded, t.simulate);
        const got = GD.evaluate(loaded, t.expr);
        const want = t.expect === undefined ? true : GD.evaluate(loaded, t.expect);
        let ok;
        if (t.approx) ok = GD.isNum(got) && Math.abs(GD.num(got) - GD.num(want)) <= (typeof t.approx === "number" ? t.approx : 0.01);
        else ok = GD.eq(got, want) && (!t.strict || GD.typeName(got) === GD.typeName(want));
        results.push({ label: t.label || t.expr + (t.expect !== undefined ? "  →  " + t.expect : ""), ok,
          detail: ok ? "" : "got " + GD.str(got, true) + (t.strict ? " (" + GD.typeName(got) + ")" : "") });
      } catch (e) {
        results.push({ label: t.label || t.expr || "check", ok: false, detail: e && e.gdLine !== undefined ? String(e) : String(e && e.message || e) });
      }
    }
    return { error: null, results, output };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { check };
  else root.BookChecker = { check };
})(typeof window !== "undefined" ? window : globalThis);
