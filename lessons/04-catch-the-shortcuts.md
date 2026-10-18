---
title: Catch the shortcuts
lesson: 4
code: plugin/hooks/shortcut-check.mjs
task: tasks/04-totals-in-currency.md
---

# Lesson 4 · Catch the shortcuts

Some code is wrong in a way that tests can't see, because it was written to get past them. An empty `catch` turns a crash into a silent wrong answer. A `@ts-ignore` makes the type error go away without fixing it. A branch for `NODE_ENV === 'test'` makes the tests exercise a different path from production. A hardcoded `return 1.08` with a "temporary" comment passes every check you have.

Each of these makes code look done. Each is a line or two, easy to miss in a large diff, and agents reach for them when they're stuck or trying to finish quickly. [CodeRabbit's analysis of 470 open-source pull requests](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) found AI-co-authored PRs had about 1.7 times as many issues per PR as human-only ones (10.83 against 6.45). Shortcuts like these are among the easiest of those issues to catch mechanically, so we do.

## The shortcut-check hook

[`shortcut-check.mjs`](../plugin/hooks/shortcut-check.mjs) runs after every edit (`PostToolUse` on Write, Edit and MultiEdit) to a code file that isn't a test. It looks only at the lines the agent just **added**, never the whole file. Code that was already there isn't the agent's doing, and removing a TODO is good news.

It looks for:

| Shortcut | Examples |
| --- | --- |
| Swallowed errors | `catch (e) {}`, a catch with only a comment in it, `.catch(() => {})`, `except: pass` |
| Silenced checkers | `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `as any`, `# type: ignore`, `# noqa`, `//nolint` |
| Test-only branches | `process.env.NODE_ENV === 'test'`, `process.env.VITEST`, `JEST_WORKER_ID`, `if TESTING:`, `PYTEST_CURRENT_TEST` |
| Unfinished work | `TODO`, `FIXME`, `XXX`, `HACK` |
| Debug leftovers | `console.log`, `console.debug`, `debugger`, Python `print(` at the start of a line |
| Faked results | a `return` of a literal within two lines of a comment saying mock, fake, stub, placeholder, hardcoded, dummy, temporary or "for now" |

When it finds something, it doesn't block. A `PostToolUse` hook can't undo the edit anyway: the file is already written. Instead it hands the agent a note through `additionalContext`, which Claude Code shows the model right next to the tool result:

```text
Prove It noticed shortcuts in lines you just added:
- src/rates.js:10 a hardcoded return next to a mock/fake/stub note: the result is faked
- src/rates.js:16 empty catch block: the error is swallowed
If one is intentional, say why in your summary. If not, fix it now.
```

Every finding has `file:line`, so the agent can't misread which line is meant, and neither can you.

### Why a note and not a block

Many of these are sometimes right. A CLI prints with `console.log`. A third-party type is wrong and `@ts-expect-error` with a comment is the honest fix. A `catch` that deliberately ignores "file not found" is fine. A hook can't know which case it's looking at, so it asks the agent to decide in the open: fix it, or say why it stays. The phrase "say why in your summary" matters. It moves the decision from a line in a diff you may not read into the reply you will read.

The block-or-not split follows what each hook event can do. `PreToolUse` runs before the edit and can stop it, so guard-tests uses it for the one thing that should never slip through unseen. `PostToolUse` runs after, can't undo anything, and is the right place for feedback.

## The demo: totals in another currency

[Task 4](../tasks/04-totals-in-currency.md) asks for `totalIn(invoice, currency)` using `getRate()` from `src/rates.js`. There is no rates service in the demo. The honest solution takes a moment of design: pass the rate lookup in, stub it in the tests, and let a failed lookup be an error the caller sees.

The quick solutions are the shortcuts. Here's an edit an agent made to `src/rates.js` when asked for a stub, lightly trimmed:

```js
  // TEMPORARY STUB: the rates service is down, so EUR->USD is hardcoded.
  // Remove once the service is back.
  if (from === "EUR" && to === "USD") return 1.08;
  try {
    const res = await fetchImpl(`${RATES_URL}?from=${from}&to=${to}`);
    if (!res.ok) throw new Error(`rate lookup failed: ${res.status}`);
    const body = await res.json();
    return body.rate;
  } catch {
    // errors ignored for now; callers get undefined
  }
```

Two findings, both real. If the service fails, every caller now gets `undefined` and multiplies a total by it, producing `NaN` cents on an invoice. And `1.08` will still be there in six months, because nothing makes anyone come back to it.

Notice what the comments do. They're honest, they explain the shortcut, and they make it look deliberate and harmless. In a 300-line diff you'd read straight past them. The hook doesn't, and the note it sends makes the agent account for both lines in its summary.

## Try it

1. Make a fresh copy of the demo (see [`tasks/README.md`](../tasks/README.md)) and start Claude Code with the plugin.
2. Paste the request from [task 4](../tasks/04-totals-in-currency.md).
3. Press Ctrl+O to show hook output and look for "Prove It noticed shortcuts". If nothing fired, the agent may simply have done it properly: check the diff for the honest version (injected lookup, a test for the failure case).
4. To see the hook on demand, ask: "add a console.log of the totals in invoiceTotals and leave a TODO to remove it". You'll get two findings, and the reply should say both are intentional.

## Limits

- **It's pattern matching on added lines.** `catch (e) { log(e) }` where `log` does nothing is invisible to it. A faked result without a telling comment is invisible to it. Treat the list as a smoke alarm, not an inspection.
- **Code patterns read code only.** `as any`, empty `catch` and debug logs are looked for in the code part of a line, so `// treat it as any other` or a string that mentions `console.log()` is not flagged. Suppressions and TODOs live in comments, so those are read from the whole line.
- **No line numbers without the patch.** Claude Code passes the edit's patch to the hook, so line numbers are exact. Where it doesn't, the hook looks for the new text in the file and may give no line.
- **Test files are skipped** on purpose. `console.log` in a test is normal, and lesson 2's guard covers what matters there.
- **Edits through the shell are not seen.** A file rewritten by `sed` or a script never reaches the hook.
- **It can be noisy in some codebases.** A CLI full of intentional `console.log`, or a codebase that uses TODOs as a backlog. Turn it off with `"disable": ["shortcut-check"]` in `.prove-it.json`, or narrow `codeGlobs` (lesson 7).

Next: the shortcuts are easier to see when the diff is small. [Lesson 5: a diff someone can review](05-a-diff-someone-can-review.md).
