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

**Drag a method to reorder it**, with a line showing where it will land. Reordering works while the
list is filtered — the move is computed against the full library, so it stays well defined. It is not
mouse-only: focus a method and use **Alt + ↑ / ↓**.

**Editor (middle).** Monaco with real TypeScript language support — type errors appear as squiggles
as you type; hover one to read it, ⌥F8 to jump to it, ⌘. for a quick fix. The `entry` box says which
function gets called; it is auto-detected and only needs filling in when the guess is wrong.

**Methods can import each other.** `import { slugify } from "./slugify"` resolves against the
workspace by method name. Dependencies are compiled in order, and cycles or unresolved names are
reported as clear errors rather than confusing runtime failures.

Every method is registered with the editor, not just the one on screen, so types flow across imports:
calling an imported method with the wrong argument type is reported where you make the call, and an
import that matches no method reads "Cannot find module" rather than silently degrading to `any`.

**Shared preamble.** One workspace-level file of types and helpers, prepended to every method at
compile time and registered with the editor so intellisense sees it everywhere. Open it from the
bottom of the sidebar. If you have never edited it, it is carried forward automatically when the
bundled default gains new helpers; once you edit it, it is yours and is never overwritten.

**Run (right).** Arguments get one input per parameter, labelled with the parameter's own name;
switch to `raw` for a plain array when you need spreads or rest parameters. Values are JavaScript
expressions, not JSON, so `new Date(0)`, a regex, or an inline callback all work. You get the return
value, `console.*` output, and timing. `⌘/Ctrl + Enter` runs.

Errors point at **your** source: stack frames are mapped back through source maps, so you see
`chunk.ts:2:24`, not a position inside generated code — and the location is clickable.

**History.** The last 10 runs per method are kept, with the arguments used and the result. Runs made
before an edit are marked *code changed*, so you can tell what is still current.

**Tests (right).** Test cases live with the method. Each has its own arguments and a matcher:

| Matcher    | Passes when                                          |
| ---------- | ---------------------------------------------------- |
| `equals` | the return value deep-equals the expected expression |
| `throws` | it throws, and the message contains the given text   |
| `truthy` | the return value is truthy                           |
| `runs`   | nothing throws                                       |
| `snapshot` | the formatted output matches exactly               |

Run one case, all cases for a method, or every case in the workspace from the top bar. A failure
reports the **first differing path** (`items[2].name`) rather than dumping two big objects, and
strings get character-level highlighting of just the part that differs.

The fastest way to build a suite is to run the method, check the output, and press
**Save as test case** — that captures the current result as the expectation. It picks the matcher
for you: `equals` when the displayed value is a JS expression that evaluates back to the same value,
and `snapshot` when it is not — a `Date`, a `Map`, a class instance. Snapshot compares the rendering
itself, so capture works for any return value rather than silently writing an expectation that
cannot parse.

`equals` compares structurally: `NaN` equals `NaN`, `-0` is distinct from `0`, and Dates, RegExps,
Maps and Sets compare by content rather than identity.

**Export to Vitest.** The Export button in the Tests panel writes a runnable `name.test.ts`.
Arguments and expected values are already stored as source text, so they transfer verbatim; async
methods get the `await expect(...).resolves` / `.rejects` forms.

**Top bar.** One primary action (Run all tests), an Export menu, a ⋯ menu for Import / Add examples /
Reset, and a ⚙ menu holding theme, sound and the type-error gate. Everything else lives with the
thing it affects.

**Feedback.** Autosave used to be entirely invisible; a save indicator next to the title now shows
"saving…" / "saved 2m ago" / "not saved". Results animate in, a passing chip pops and a failing one
shakes, and a whole workspace going green gets a short burst of confetti — reserved for that one
event so it keeps meaning something. Short synthesised cues play on run completion (never per
keystroke or per test case), in one of three cue sets; the ⚙ menu holds the mute and the theme. Busy indicators wait 180ms before appearing,
so the common sub-100ms run stays calm instead of flashing a progress bar.

Chrome surfaces — the top bar, sidebar, menus and toasts — are frosted glass over an ambient wash, so
the app reads as layers rather than a flat grid. Glow is used to mean something: the selected method,
a passing or failing card, the save dot, focus rings, and a sheen that sweeps the primary button on
hover. Everything here respects `prefers-reduced-motion`.

## Export and import

**Export ▾** in the top bar offers two scopes:

- **This method (`.ts`)** — a real TypeScript file. The description becomes JSDoc, the code is the
  file body, and a trailing `/* @sandbox … */` comment carries the tests, tags and argument values.
  `tsc` ignores that comment, so the file drops straight into a repo and compiles; importing it back
  here restores the method whole. `*/` appearing inside your code or test data is escaped as `*\/`,
  which JSON parses back transparently, so it cannot close the block early.
- **Whole workspace (`.json`)** — every method plus the preamble. This is your backup; everything
  otherwise lives only in `localStorage`.

**Import** accepts both, and several files at once:

- A `.json` workspace merges its methods in.
- A `.ts` file written by this app comes back complete.
- **Any other `.ts` file** imports too. The name comes from the exported function, and a plain prose
  JSDoc above it becomes the description. A comment carrying `@param`/`@returns` is real API
  documentation, so it is left in the code and not lifted. Nothing blocks the import — anything
  missing is reported in the toast and can be filled in later.

Imported names are de-duplicated (`slugify` → `slugify2`), which matters because a method's name is
also its import specifier.

**Importing never destroys your preamble.** If the file carries one, it is adopted only while yours
is still the untouched default. Otherwise yours is kept and the toast offers to swap — and that swap
is itself undoable.

**Examples** adds any bundled example your library does not already have, matched by name, leaving
everything you have written untouched. This is what to use when the app has been updated with new
examples: the seeds only apply to a brand-new workspace, so a library saved earlier would never see
them otherwise. **Reset** replaces the workspace outright with the examples, and is undoable.

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
    TopBar.tsx             primary action plus the export/more/settings menus
    Menu.tsx               shared popover with click-outside and Escape
    SaveIndicator.tsx      makes autosave visible
    Celebration.tsx        confetti burst, thrown from its source button
    CountUp.tsx            rolls a changing number
    Toast.tsx              notifications, including undo actions
  lib/
    compile.ts             TS -> JS + source map, entry/param/import detection
    bundle.ts              resolves cross-method imports into a module graph
    runner.ts              worker session lifecycle, reuse and timeouts
    sandbox.worker.ts      executes code, maps stacks, evaluates expectations
    sourcemap.ts           minimal source-map reader (VLQ decode, position lookup)
    inspect.ts             value formatting, deep equality, difference finding
    diagnostics.ts         pulls type errors out of Monaco's TS worker
    codegen.ts             .ts method files (read/write) and Vitest generation
    storage.ts             localStorage, import/export, history, seed examples
    theme.ts               light/dark/system resolution
```

## Known limits

- The 2s timeout is a constant in `runner.ts` rather than a per-method setting.
- Entry-point and parameter detection is source-pattern based, so unusual declaration forms
  (decorated or overloaded functions) may need the `entry` override.
- Renaming a method does not rewrite `import` statements in methods that depend on it.
- Whole-statement `import type` is not treated as a runtime dependency, so type-only cycles are
  allowed; inline `{ type A, b }` still counts, because `b` is a real binding.
- Snapshot cases export to Vitest as an empty `toMatchInlineSnapshot()`, since the stored rendering
  is this app's formatter rather than Vitest's — Vitest fills its own in on first run.
