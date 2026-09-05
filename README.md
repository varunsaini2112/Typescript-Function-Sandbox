# TS Sandbox

A local, browser-based scratchpad for writing TypeScript methods, keeping a library of them,
running them against ad-hoc inputs, and building up test cases — all from the UI.

```bash
npm install
npm run dev
```

Then open http://localhost:5180.

## What it does

**Library (left).** Every method you write is saved to a list in `localStorage`, so it survives a
reload. Search across names, descriptions and source; duplicate or delete from the row.

**Editor (middle).** Monaco with real TypeScript language support — type errors show as squiggles
as you type. The `entry` box says which function gets called; it is auto-detected from the code and
only needs filling in if the guess is wrong (e.g. several functions in one snippet).

**Run (right).** Arguments are a JavaScript array expression, so you are not limited to JSON — you
can pass `new Date(0)`, a regex, or an inline callback. Running shows the return value, anything
sent to `console.*`, and how long it took. `⌘/Ctrl + Enter` runs.

**Tests (right).** Test cases live with the method. Each one has its own arguments and a matcher:

| Matcher  | Passes when                                                            |
| -------- | ---------------------------------------------------------------------- |
| `equals` | the return value deep-equals the expected expression                   |
| `throws` | it throws, and the message contains the given text                     |
| `truthy` | the return value is truthy                                             |
| `runs`   | nothing throws                                                         |

Run one case, all cases for a method, or every case in the workspace from the top bar. Failures show
expected against received. The fastest way to build a suite is to run the method, check the output,
and press **Save as test case** — that captures the current result as the expectation.

`equals` compares structurally: `NaN` equals `NaN`, `-0` is distinct from `0`, and Dates, RegExps,
Maps and Sets compare by content rather than identity.

**Export / Import.** Writes the whole workspace to a JSON file and reads it back, for moving methods
between machines or committing them somewhere. **Reset** restores the bundled examples.

## How it runs your code

TypeScript is transpiled in the browser with `ts.transpileModule` (types are erased, not checked —
so a type error will not block a run) and executed in a **Web Worker**. Each run gets a fresh worker
that is terminated after 2s, so an infinite loop costs you one run, not the tab. Nothing leaks
between runs, and nothing is sent anywhere: no server, no network calls.

Because sandboxed code is transpiled standalone, `import` statements from npm packages will not
resolve. Everything the browser provides (`Math`, `JSON`, `fetch`, `setTimeout`, …) is available.

## Layout

```
src/
  App.tsx                  workspace state, persistence, orchestration
  components/
    Sidebar.tsx            method library
    RunPanel.tsx           ad-hoc invocation
    TestsPanel.tsx         test case editing and results
    ResultView.tsx         shared rendering of a run result
  lib/
    compile.ts             TS -> JS, entry-point and parameter detection
    runner.ts              worker lifecycle and timeouts
    sandbox.worker.ts      executes code, evaluates expectations
    inspect.ts             value formatting and deep equality
    storage.ts             localStorage, import/export, seed examples
```
