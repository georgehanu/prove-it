// Builds the GitHub Pages site in docs/ from lessons/*.md.
// Usage: npm install && npm run site

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";

const REPO = "https://github.com/georgehanu/prove-it";
const X = "https://x.com/georgehanu";
const HUB = "https://georgehanu.github.io/";
const SITE = "https://georgehanu.github.io/prove-it/";
// The share image is built by the hub from its guide data, so every guide's link preview uses the
// same template. The index and every lesson use it.
const OG_IMAGE = "https://georgehanu.github.io/og/guides/prove-it.png";
const OG_IMAGE_ALT =
  "Prove It: your coding agent says it's done. Make it prove it. Coding with AI, by George Hanu.";
const INSTALL = ["/plugin marketplace add georgehanu/prove-it", "/plugin install prove-it@prove-it"];

const root = new URL("../", import.meta.url);
const out = new URL("docs/", root);
mkdirSync(out, { recursive: true });

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

const lessons = readdirSync(new URL("lessons/", root))
  .filter((file) => file.endsWith(".md"))
  .sort()
  .map((file) => {
    const raw = readFileSync(new URL(`lessons/${file}`, root), "utf8").replace(/\r\n/g, "\n");
    const [, front, body] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const meta = Object.fromEntries(
      front.split("\n").map((line) => {
        const [key, ...rest] = line.split(":");
        return [key.trim(), rest.join(":").trim().replace(/^"|"$/g, "")];
      }),
    );
    return { file, slug: file.replace(/\.md$/, ""), ...meta, body };
  });

const summaries = {
  1: "The agent can't finish after editing code until a check has passed, and its reply has to end with a Proof block.",
  2: "Edits that weaken a test wait for you. Red before green, and a mutation check.",
  3: "Checkpoint, reproduce, one hypothesis at a time, prove the cause. Stop after three tries.",
  4: "Empty catches, @ts-ignore, test-only branches and faked returns, flagged with file:line.",
  5: "A diff budget, a brief that says what to read first, and a reviewer with fresh eyes.",
  6: "Skill, hook, AGENTS.md or CLAUDE.md? Write your own hook in 20 lines. Read before you install.",
  7: "Run the test suite, try the demo tasks with and without, tune it, turn pieces off.",
};

const attr = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Lesson links become pages; links into the repo (../plugin/..., ../demo/...) go to GitHub.
function rewriteLinks(html) {
  return html
    .replace(/href="(\d\d-[a-z-]+)\.md(#[^"]*)?"/g, (_, slug, hash = "") => `href="${slug}.html${hash}"`)
    .replace(/href="\.\.\/([^"]*)"/g, (_, path) => {
      const isFile = /\.[a-z]+$|\.snippet$/i.test(path.replace(/#.*$/, "")) && !path.endsWith("/");
      return `href="${REPO}/${isFile ? "blob" : "tree"}/main/${path.replace(/\/$/, "")}"`;
    });
}

function page({ title, description, body, current }) {
  const url = current === "index" ? SITE : `${SITE}${current}.html`;
  const social = `<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(OG_IMAGE_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:creator" content="@georgehanu">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<meta name="twitter:image:alt" content="${attr(OG_IMAGE_ALT)}">`;
  const nav = lessons
    .map((l) => `<a href="${l.slug}.html"${l.slug === current ? ' aria-current="page"' : ""}><span>${l.lesson}</span>${l.title}</a>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${attr(title)}</title>
<meta name="description" content="${attr(description)}">
${social}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%2315803d'/><path d='M27 52l15 15 32-34' fill='none' stroke='white' stroke-width='11' stroke-linecap='round' stroke-linejoin='round'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="index.html"><span class="loop">&#10003;</span> Prove It</a>
  <nav class="top-links">
    <a href="${HUB}">All guides</a>
    <a href="${REPO}">GitHub</a>
    <a class="follow" href="${X}">Follow @georgehanu</a>
  </nav>
</header>
${
  current === "index"
    ? body
    : `<div class="layout">
  <aside class="side"><div class="side-title">Lessons</div>${nav}</aside>
  <main class="lesson">${body}</main>
</div>`
}
<footer class="foot">
  <p>Written by <a href="${X}">George Hanu</a>. I teach developers to build software with AI: small examples, explained clearly.</p>
  <p><a href="${HUB}">More free guides</a> · <a href="${X}">Follow on X</a> · <a href="${REPO}">Source on GitHub</a> · MIT licensed</p>
</footer>
<script>
// Some browsers and embedded views refuse the async clipboard API, so fall back to the classic copy
// command, and if that fails too, select the command so Ctrl+C / Cmd+C works.
function copyWithCommand(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  area.remove();
  return ok;
}
function selectCommand(button) {
  const code = button.parentElement.querySelector("code");
  if (!code) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = button.getAttribute("data-copy");
    let ok = copyWithCommand(text);
    if (!ok && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {}
    }
    if (ok) {
      button.textContent = "Copied";
    } else {
      selectCommand(button);
      button.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (button.textContent = "Copy"), 2000);
  });
});
</script>
</body>
</html>
`;
}

lessons.forEach((lesson, i) => {
  const prev = lessons[i - 1];
  const next = lessons[i + 1];
  const meta = `<div class="meta">${
    lesson.task ? `<span>Demo</span><a class="task" href="${REPO}/blob/main/${lesson.task}">${lesson.task.split("/").pop()}</a>` : ""
  }${lesson.code ? `<a href="${REPO}/blob/main/${lesson.code}">View the code &rarr;</a>` : ""}</div>`;
  const pager = `<nav class="pager">${
    prev ? `<a href="${prev.slug}.html"><small>&larr; Lesson ${prev.lesson}</small>${prev.title}</a>` : "<span></span>"
  }${next ? `<a class="next" href="${next.slug}.html"><small>Lesson ${next.lesson} &rarr;</small>${next.title}</a>` : ""}</nav>`;
  const cta = `<aside class="cta"><strong>Found this useful?</strong> I post small, practical AI coding examples most days.
  <a href="${X}">Follow @georgehanu on X</a></aside>`;

  writeFileSync(
    new URL(`${lesson.slug}.html`, out),
    page({
      title: `Lesson ${lesson.lesson}: ${lesson.title} · Prove It`,
      description: `${lesson.title}. ${summaries[lesson.lesson] ?? ""} Part of Prove It: your coding agent says it's done, make it prove it.`,
      body: `${meta}${rewriteLinks(marked.parse(lesson.body))}${cta}${pager}`,
      current: lesson.slug,
    }),
  );
});

const cards = lessons
  .map(
    (l) => `<a class="card" href="${l.slug}.html">
      <span class="num">${l.lesson}</span>
      <span class="card-title">${l.title}</span>
      <span class="card-sub">${summaries[l.lesson] ?? ""}</span>
    </a>`,
  )
  .join("\n");

const installBox = INSTALL.map(
  (cmd) => `<div class="cmd"><code>${attr(cmd)}</code><button class="copy" type="button" data-copy="${attr(cmd)}" aria-label="Copy: ${attr(cmd)}">Copy</button></div>`,
).join("\n");

const changes = [
  ["It can't stop without running the checks.", "Edit code, then try to finish with no test, lint or build run since? The Stop hook sends it back with the files and the commands it found. Checks green but no Proof block? Sent back for that too."],
  ["It can't quietly weaken a test.", "Removed assertions, .skip, expect(true).toBe(true), a changed expected value: the edit waits for your approval."],
  ["It looks for the cause before it patches.", "Checkpoint, reproduce, test one hypothesis at a time, prove the cause. After three failed fixes it stops and reports."],
  ["It's told about the shortcuts it just took.", "Empty catch, @ts-ignore, test-only branches, faked returns: flagged with file:line right after the edit."],
  ["It hands over a diff you can review.", "A budget for diff size, a brief that says which lines to read first, and an independent reviewer that needs evidence for every finding."],
]
  .map(([head, text], i) => `<li><span class="n">${i + 1}</span><div><strong>${head}</strong><span class="d">${attr(text)}</span></div></li>`)
  .join("\n");

const home = `
<main class="home">
  <section class="hero">
    <p class="eyebrow">Free · Claude Code plugin + 7 lessons · Works with Codex</p>
    <h1>Your coding agent says it's done.<br><em>Make it prove it.</em></h1>
    <p class="lead">Four skills and six small hooks that make the agent run the checks before it finishes, leave your tests alone,
      find the cause before it patches, own up to shortcuts, and hand you a diff you can review. Install it in two commands
      and keep working.</p>
    <div class="install">
      <p class="install-label">In Claude Code</p>
      ${installBox}
      <p class="install-note">Then <code>/reload-plugins</code>. Codex or another agent? Copy the skills, and for Codex the hooks: <a href="${REPO}#install">install notes</a>.</p>
    </div>
    <div class="actions">
      <a class="btn primary" href="${lessons[0].slug}.html">Start lesson 1</a>
      <a class="btn" href="${REPO}">Read the code first</a>
    </div>
  </section>

  <section>
    <h2>What changes</h2>
    <ol class="changes">${changes}</ol>
  </section>

  <section class="terminal" aria-label="Example: the Stop hook sends the agent back">
    <div class="bar"><i></i><i></i><i></i><span>claude with Prove It · example, shortened</span></div>
<pre><span class="t-you">you</span>    Make paginate() also return from and to. Keep it quick.

<span class="t-cyan">agent</span>  [edits src/paginate.js]
<span class="t-cyan">agent</span>  Done! paginate() now returns from and to.
<span class="t-yel">hook</span>   Prove It: you changed src/paginate.js and no check has
       run since the last edit. Run the project's checks
       (found: npm test) and show the result.
<span class="t-cyan">agent</span>  [runs npm test]  <span class="t-green"># pass 17  # fail 0</span>
<span class="t-cyan">agent</span>  ## Proof
       - from/to returned -> edited src/paginate.js; existing tests pass
       - Checks: npm test exit 0 (17 passed, 0 failed)
       <span class="t-red">Not verified:</span> the from/to values, no test asserts them yet</pre>
  </section>

  <section class="points">
    <div><h3>Hooks, not hopes</h3><p>A rule in CLAUDE.md is text the model may skip. A hook runs on every tool call, outside the model. The rules that code can check are hooks.</p></div>
    <div><h3>Short enough to read</h3><p>Skills are prompts with your agent's permissions. Each of ours is under 120 lines, and the hooks are plain Node with no dependencies. Read them before you install.</p></div>
    <div><h3>Tested, not claimed</h3><p><code>npm test</code> runs every hook against more than a hundred inputs shaped like the real ones, Windows paths and Codex patches included.</p></div>
  </section>

  <section>
    <h2>The lessons</h2>
    <div class="cards">${cards}</div>
  </section>

  <section class="start">
    <h2>Check it yourself in a minute</h2>
<pre><code>git clone ${REPO}.git
cd prove-it
npm test</code></pre>
    <p>Node.js 22 or newer, no install step. Then try the <a href="${REPO}/tree/main/tasks">demo tasks</a> with and without the plugin.</p>
  </section>

  <section class="author">
    <div>
      <h2>Hi, I'm George.</h2>
      <p>I'm a senior web developer. I teach developers to build software with AI, from useful scripts to app features.
        Small examples, explained clearly. This is part 2 of <em>Working with coding agents</em>: <a href="https://georgehanu.github.io/beyond-it-works/">Beyond "It Works"</a>
        is the workflow, and Prove It puts that workflow into the tool. If it helped, the best thanks is a follow.</p>
      <a class="btn primary" href="${X}">Follow @georgehanu on X</a>
    </div>
  </section>
</main>`;

writeFileSync(
  new URL("index.html", out),
  page({
    title: "Prove It · Your coding agent says it's done. Make it prove it.",
    description:
      "A free Claude Code plugin and seven short lessons: the agent runs the checks before it finishes, can't quietly weaken tests, finds root causes, owns up to shortcuts and hands you a reviewable diff. By George Hanu.",
    body: home,
    current: "index",
  }),
);

writeFileSync(new URL(".nojekyll", out), "");
writeFileSync(new URL("style.css", out), readFileSync(new URL("scripts/site.css", root), "utf8"));
console.log(`Built ${lessons.length + 1} pages in docs/`);
