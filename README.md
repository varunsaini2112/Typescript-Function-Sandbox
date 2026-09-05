# TS Sandbox

A local, browser-based scratchpad for writing TypeScript methods, keeping a library of them,
running them against ad-hoc inputs, and building up test cases — all from the UI.

```bash
npm install
npm run dev
```

Then open http://localhost:5180.

## What it does

**Library (left).** Every method is saved to `localStorage`, so it survives a reload. Search across
names, descriptions and source, or narrow by tag — `tag:strings` works in the search box too. A red
dot marks a method with type errors, so you can see what is broken without opening it. Deleting is
immediate and offers an **Undo** for a few seconds rather than a confirmation dialog.

**Editor (middle).** Monaco with real TypeScript language support — type errors appear as squiggles
as you type; hover one to read it, ⌥F8 to jump to it, ⌘. for a quick fix. The `entry` box says which
function gets called; it is auto-detected and only needs filling in when the guess is wrong.

**Methods can import each other.** `import { slugify } from "./slugify"` resolves against the
workspace by method name. Dependencies are compiled in order, and cycles or unresolved names are
reported as clear errors rather than confusing runtime failures.

**Shared preamble.** One workspace-level file of types and helpers, prepended to every method at
compile time and registered with the editor so intellisense sees it everywhere. Open it from the
bottom of the sidebar.

**Run (right).** Arguments get one input per parameter, labelled with the parameter's own name;
switch to `raw` for a plain array when you need spreads or rest parameters. Values are JavaScript
expressions, not JSON, so `new Date(0)`, a regex, or an inline callback all work. You get the return
value, `console.*` output, and timing. `⌘/Ctrl + Enter` runs.

Errors point at **your** source: stack frames are mapped back through source maps, so you see
`chunk.ts:2:24`, not a position inside generated code — and the location is clickable.

**History.** The last 10 runs per method are kept, with the arguments used and the result. Runs made
before an edit are marked *code changed*, so you can tell what is still current.

**Tests (right).** Test cases live with the method. Each has its own arguments and a matcher:

| Matcher  | Passes when                                                            |
| -------- | ---------------------------------------------------------------------- |
| `equals` | the return value deep-equals the expected expression                   |
| `throws` | it throws, and the message contains the given text                     |
| `truthy` | the return value is truthy                                             |
| `runs`   | nothing throws                                                         |

Run one case, all cases for a method, or every case in the workspace from the top bar. A failure
reports the **first differing path** (`items[2].name`) rather than dumping two big objects, and
strings get character-level highlighting of just the part that differs.

The fastest way to build a suite is to run the method, check the output, and press
**Save as test case** — that captures the current result as the expectation.

`equals` compares structurally: `NaN` equals `NaN`, `-0` is distinct from `0`, and Dates, RegExps,
Maps and Sets compare by content rather than identity.

**Export to Vitest.** The Export button in the Tests panel writes a runnable `name.test.ts`.
Arguments and expected values are already stored as source text, so they transfer verbatim; async
methods get the `await expect(...).resolves` / `.rejects` forms.

**Theme.** Light, dark, or follow the system — the button in the top bar cycles between them.

**Export / Import.** Writes the whole workspace (methods plus preamble) to JSON and reads it back.
Imported names are de-duplicated so they never collide with an existing method. **Reset** restores
the bundled examples, and is undoable.

## How it runs your code

TypeScript is transpiled in the browser with `ts.transpileModule` (types are erased, **not** checked —
a type error will not block a run unless you tick *block on type errors*) and executed in a **Web
Worker**.

One worker is reused for a whole batch of test cases, so the module graph is parsed once, but each
case instantiates fresh module state — no leakage between cases. A case that overruns the 2s timeout
has its worker terminated; the next case transparently gets a replacement, so a runaway loop costs
one worker rather than the batch.

Nothing is sent anywhere: no server, no network calls. `import` of npm packages will not resolve —
only other methods in the workspace. Everything the browser provides (`Math`, `JSON`, `fetch`,
`setTimeout`, …) is available.

## Layout

```
src/
  App.tsx                  workspace state, persistence, orchestration
  components/
    Sidebar.tsx            method library, tags, filtering
    RunPanel.tsx           per-parameter inputs, diagnostics, run history
    TestsPanel.tsx         test case editing, results, Vitest export
    ResultView.tsx         shared result rendering, difference display
    TagEditor.tsx          tag chips on a method
    Toast.tsx              notifications, including undo actions
  lib/
    compile.ts             TS -> JS + source map, entry/param/import detection
    bundle.ts              resolves cross-method imports into a module graph
    runner.ts              worker session lifecycle, reuse and timeouts
    sandbox.worker.ts      executes code, maps stacks, evaluates expectations
    sourcemap.ts           minimal source-map reader (VLQ decode, position lookup)
    inspect.ts             value formatting, deep equality, difference finding
    diagnostics.ts         pulls type errors out of Monaco's TS worker
    codegen.ts             Vitest/Jest test file generation
    storage.ts             localStorage, import/export, history, seed examples
    theme.ts               light/dark/system resolution
```

## Known limits

- The 2s timeout is a constant in `runner.ts` rather than a per-method setting.
- Entry-point and parameter detection is source-pattern based, so unusual declaration forms
  (decorated or overloaded functions) may need the `entry` override.
- Renaming a method does not rewrite `import` statements in methods that depend on it.
