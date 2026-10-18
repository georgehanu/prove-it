# Demo tasks

Five requests for the small invoicing module in [`demo/`](../demo/). Each is a realistic change where agents
tend to come back "almost right". Each lesson uses one of them.

| Task | Lesson |
| --- | --- |
| [01 late fee](01-late-fee.md) | 1 Done means proven |
| [02 tax per line](02-per-line-tax.md) | 2 Tests that can fail |
| [03 missing last page](03-missing-last-page.md) | 3 Find the cause |
| [04 totals in currency](04-totals-in-currency.md) | 4 Catch the shortcuts |
| [05 net 1 month](05-month-end-terms.md) | 5 A diff someone can review |

## Run a task

Work on a copy of `demo/` only, never on the folder in this repo, so you can run each task twice from the
same start.

macOS / Linux:

```bash
cp -r demo /tmp/tiny-invoice && cd /tmp/tiny-invoice
git init -q && git add -A && git commit -qm start
npm test
```

Windows PowerShell:

```powershell
Copy-Item -Recurse demo $env:TEMP\tiny-invoice; cd $env:TEMP\tiny-invoice
git init -q; git add -A; git commit -qm start
npm test
```

Then open your agent in that folder and paste only the request from the task file. Git matters: the
diff-budget hook and the review brief read `git diff`.

To compare, run the same task in a second fresh copy with Prove It off (`claude` without the plugin, or
`/plugin disable prove-it`), and with it on. For a one-off session without installing anything:

```bash
claude --plugin-dir /path/to/prove-it/plugin
```

## Why these files stay out of the copy

Each task file says what tends to go wrong and ends with "What a proven answer looks like": not the code,
the evidence a good reply shows. An agent that can read that checklist before it starts will follow it, and
the comparison stops meaning anything. The same goes for any notes about the experiment, which is why
`demo/` has nothing in it but the project.
