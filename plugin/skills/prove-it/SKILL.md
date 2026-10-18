---
name: prove-it
description: Done, finished, ready, fixed, implemented, "all tests pass" - use before you claim any coding task is complete. Runs the project's checks and ends the reply with a Proof block that maps every requirement to evidence (command, exit code, the output line) or to "not done, because...". Lists what was not verified.
license: MIT
---

# Prove it

"Done" is a claim. Back it with evidence the reader can check, or say plainly what is missing.

## When

Use this every time you are about to say a change is done, fixed, working or ready, and before you hand over a branch or a pull request.

## Steps

1. **List the requirements.** Re-read the user's request, word by word. Write each thing they asked for as one short line. Include the small ones ("and update the README", "keep the old API working"). If you split or reinterpreted something, say so.
2. **Find the checks.** Look at `package.json` scripts, `Makefile`, `pyproject.toml`, `go.mod`, `Cargo.toml`, CI config. Typical: test, lint, typecheck, build.
3. **Run them now,** after your last edit. Not from memory, not "they passed earlier". If a command fails, fix the cause and run it again. Do not stop on a red check without saying so.
4. **Prove each requirement.** A passing suite is not proof of a requirement unless a test actually covers it. For each line from step 1, point to the test, the command output, or the manual run that shows it works. If nothing shows it, run something that does (a script, a curl, a one-off `node -e`).
5. **Admit the gaps.** Anything you did not do, could not run, or only assumed goes under "Not verified:" with the reason. Never defer part of the request silently.

## Output format

End your reply with this block, as plain markdown (not inside a code block). Keep each line short.

```
## Proof
- <requirement> -> `<command>` exit <code>: "<the output line that proves it>"
- <requirement> -> not done, because <reason>
- Checks: `<command>` exit <code> (<n> passed, <n> failed)
- Not verified: <what> (<why>)
```

Rules for the block:

- Quote real output. Copy the line, do not paraphrase it. If you did not run it, it does not go in as evidence.
- One line per requirement from step 1. None may be missing.
- "Not verified:" lists real gaps. If there are truly none, leave the line out rather than writing "none".
- If a check fails and you cannot fix it, the block says so first, not last.

## Example

```
## Proof
- Free shipping from 50.00 -> `node --test test/shipping.test.js` exit 0: "ok 3 - ships free at exactly 50.00"
- Below 50.00 the flat rate stays -> `node --test test/shipping.test.js` exit 0: "ok 4 - charges 4.90 at 49.99"
- Show the threshold in the cart banner -> not done, because the banner text comes from the CMS
- Checks: `npm test` exit 0 (41 passed, 0 failed); `npm run lint` exit 0
- Not verified: carts in other currencies (no fixture for them)
```

## What not to do

- Do not write "should work", "tests pass" or "verified" without the command and its output.
- Do not run only the one test you touched and call the suite green.
- Do not count a command that was piped into `tail` or `head` as passing without reading its output; the pipe hides the exit code.
