// Unit tests for the detection rules the hooks share.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULTS,
  commandParts,
  editedPaths,
  editsFromInput,
  exitCodeFrom,
  globToRegExp,
  hasNotVerifiedSection,
  hasProofBlock,
  isCheckCommand,
  isCodeFile,
  isTestFile,
  lineDiff,
  outputShowsFailure,
  parseApplyPatch,
  pruneSessions,
  relPath,
  sessionKey,
  shellCommandOf,
  splitShell,
  stripCommand,
  stripHeredocs,
  suggestedChecks,
} from "../plugin/hooks/lib.mjs";
import { analyseTestEdit, deletedPaths, guard, shellWrittenPaths } from "../plugin/hooks/guard-tests.mjs";
import { codeOf, scanAdded } from "../plugin/hooks/shortcut-check.mjs";
import { sumNumstat } from "../plugin/hooks/diff-budget.mjs";

const tempDir = () => mkdtempSync(join(tmpdir(), "prove-it-lib-"));

const cfg = { ...DEFAULTS, disable: [] };
const nowhere = "/nonexistent-prove-it-dir";

test("relPath: POSIX, Windows, mixed separators and drive-letter case", () => {
  assert.equal(relPath("/home/a/proj/src/x.js", "/home/a/proj"), "src/x.js");
  assert.equal(relPath("C:\\Users\\a\\proj\\src\\x.js", "C:\\Users\\a\\proj"), "src/x.js");
  assert.equal(relPath("c:/users/a/proj/src/x.js", "C:\\Users\\a\\proj\\"), "src/x.js");
  assert.equal(relPath("./src/x.js", "/whatever"), "src/x.js");
  assert.equal(relPath("D:\\other\\x.js", "C:\\proj"), "D:/other/x.js");
});

test("globs: **, *, braces, and name-only patterns", () => {
  assert.ok(globToRegExp("**/*.test.*").test("src/a/b.test.ts"));
  assert.ok(globToRegExp("**/*.test.*").test("b.test.js"));
  assert.ok(globToRegExp("src/**/*.{js,ts}").test("src/x.ts"));
  assert.ok(!globToRegExp("src/*.js").test("src/a/x.js"));
  assert.ok(globToRegExp("**/node_modules/**").test("node_modules/x/y.js"));
});

test("code files vs docs, config and generated files", () => {
  for (const f of ["src/a.js", "app/x.py", "cmd/main.go", "src/App.vue", "lib/x.rs", "src/a.tsx"]) assert.ok(isCodeFile(f, cfg), f);
  for (const f of ["README.md", "package.json", "package-lock.json", "a.yaml", "src/types.d.ts", "node_modules/x/a.js", "dist/a.js", "a.min.js", "styles.css"])
    assert.ok(!isCodeFile(f, cfg), f);
});

test("test files by the default globs", () => {
  for (const f of ["test/a.js", "src/a.test.ts", "src/__tests__/a.tsx", "tests/test_tax.py", "pkg/x_test.go", "src/A.spec.js", "spec/models/user_spec.rb"])
    assert.ok(isTestFile(f, cfg), f);
  for (const f of ["src/a.js", "src/testing-utils.js", "test/fixtures/data.json"]) assert.ok(!isTestFile(f, cfg), f);
});

test("codeGlobs never un-guard tests: test files outside them are still test files", () => {
  const narrow = { ...cfg, codeGlobs: ["src/**/*.js"] };
  assert.ok(!isCodeFile("test/a.test.js", narrow), "not code for the Stop hook");
  assert.ok(isTestFile("test/a.test.js", narrow), "still guarded");
  assert.ok(isTestFile("e2e/login.feature", { ...narrow, testGlobs: ["e2e/**"], codeGlobs: ["**/*.feature"] }), "codeGlobs can widen");
  assert.ok(!isTestFile("test/fixtures/data.json", narrow));
  assert.ok(!isTestFile("node_modules/x/a.test.js", narrow), "ignoreGlobs still win");
});

test("check commands that count", () => {
  for (const c of [
    "npm test",
    "npm t",
    "npm run lint",
    "npm run test:unit -- --watch=false",
    "pnpm typecheck",
    "yarn build",
    "bun test",
    "cd demo && npm test",
    "node --test",
    "node --test test/",
    "npx vitest run",
    "npx tsc --noEmit",
    "npx eslint src",
    "./node_modules/.bin/jest",
    "CI=1 jest --ci",
    "pytest -q",
    "python -m pytest tests/test_tax.py",
    "uv run pytest",
    "ruff check .",
    "mypy app",
    "go test ./...",
    "cargo test",
    "cargo clippy",
    "./gradlew test",
    "dotnet test",
    "make test",
    "deno test",
    // in command position after cd, env vars, runners and wrappers
    "npm run test:unit",
    "cd pkg && npm test",
    "CI=1 npx vitest run",
    "pnpm -r test",
    "python -m pytest -q",
    "mvn -q test",
    "bundle exec rspec",
    "vendor/bin/phpunit",
    'npm test; "exit=$LASTEXITCODE"',
    "npm --prefix demo test",
    "yarn workspace web test",
    "(cd demo && npm test)",
    "npm test 2>&1 | tail -20",
    'git commit -m "wip" && npm test',
    'bash -c "cd demo && npm test"',
    "./gradlew :app:test",
    "python manage.py test",
    String.raw`.\gradlew.bat test`,
    String.raw`node_modules\.bin\vitest run`,
  ])
    assert.ok(isCheckCommand(c, nowhere, cfg), c);
});

test("commands that do not count", () => {
  for (const c of [
    "ls",
    "cat eslint.config.js",
    "git status",
    "npm install",
    "npm ci",
    "npm run dev",
    "node src/server.js",
    "echo done",
    "git checkout main",
    "npm run checkout",
    // the check tool is not in command position, or the run checks nothing
    "echo npm test",
    'grep "npm test" README.md',
    'grep -n "npm test" README.md',
    'git commit -m "npm test"',
    'git commit -m "npm test passes"',
    "git commit -m 'go test ./... is green'",
    "npm test --help",
    "npx jest --listTests",
    "pytest --collect-only",
    "cat .rspec",
    "ls src/tsc",
    'node -e "console.log(1)" --eval "npm test"',
    "cat > notes.md <<'EOF'\nnpm test\nEOF",
  ])
    assert.ok(!isCheckCommand(c, nowhere, cfg), c);
});

test("stripCommand and commandParts: quoted text, -m/-e arguments and heredoc bodies are not commands", () => {
  assert.equal(stripCommand('git commit -m "npm test" && npm test').replace(/\s+/g, " ").trim(), "git commit && npm test");
  assert.deepEqual(commandParts("CI=1 npx vitest run && ./node_modules/.bin/jest | tee log"), ["vitest run", "jest", "tee log"]);
  assert.deepEqual(commandParts("python -m pytest -q"), ["pytest -q"], "python -m names the module, it is not a message");
  assert.equal(shellCommandOf({ command: ["bash", "-lc", "npm test"] }), "npm test", "an argv array is reduced to its script");
  assert.equal(shellCommandOf({ command: "npm test" }), "npm test");
  assert.deepEqual(splitShell('echo "a; b" && npm test 2>&1 | tail'), ['echo "a; b"', "npm test 2>&1", "tail"]);
});

test(".prove-it.json checks run against the stripped command and each part of it", () => {
  const custom = { ...cfg, checks: ["^make verify\\b", "\\bnpm (run )?test\\b"] };
  assert.ok(isCheckCommand("cd api && make verify", nowhere, custom), "^ anchors to each part");
  assert.ok(isCheckCommand("npm test", nowhere, custom));
  assert.ok(!isCheckCommand('git commit -m "npm test passes"', nowhere, custom), "quoted text is gone");
  assert.ok(!isCheckCommand("pytest", nowhere, custom), "custom checks replace the built-in list");
});

test("suggestedChecks: each project type gets a command, and each suggestion counts as a check", () => {
  const projects = {
    maven: [{ "pom.xml": "<project/>" }, "mvn test"],
    "maven wrapper": [{ "pom.xml": "<project/>", mvnw: "" }, "./mvnw test"],
    gradle: [{ "build.gradle.kts": "" }, "gradle test"],
    "gradle wrapper": [{ "build.gradle": "", gradlew: "" }, "./gradlew test"],
    dotnet: [{ "Shop.sln": "" }, "dotnet test"],
    csproj: [{ "Api.csproj": "" }, "dotnet test"],
    rspec: [{ Gemfile: "gem 'rspec-rails'\n" }, "bundle exec rspec"],
    phpunit: [{ "composer.json": '{"require-dev":{"phpunit/phpunit":"^11"}}' }, "vendor/bin/phpunit"],
    python: [{ "pyproject.toml": "" }, "pytest"],
    go: [{ "go.mod": "module x" }, "go test ./..."],
    rust: [{ "Cargo.toml": "" }, "cargo test"],
  };
  for (const [name, [files, expected]] of Object.entries(projects)) {
    const dir = tempDir();
    try {
      for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
      const found = suggestedChecks(dir, cfg);
      assert.deepEqual(found, [expected], name);
      for (const c of found) assert.ok(isCheckCommand(c, dir, cfg), `${name}: "${c}" counts as a check`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const plain = tempDir();
  try {
    writeFileSync(join(plain, "Gemfile"), "gem 'rails'\n");
    assert.deepEqual(suggestedChecks(plain, cfg), [], "a Gemfile without rspec suggests nothing");
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test("a pipe can hide a failure; the output gives it away", () => {
  assert.ok(outputShowsFailure("npm test | tail", "# pass 3\n# fail 1"));
  assert.ok(outputShowsFailure("npx vitest run 2>&1 | tail -3", "Tests  1 failed | 20 passed"));
  assert.ok(outputShowsFailure("pytest; echo done", "== 2 failed, 3 passed in 0.2s =="));
  assert.ok(outputShowsFailure("go test ./... | cat", "--- FAIL: TestTotal (0.00s)"));
  assert.ok(!outputShowsFailure("npm test | tail", "# pass 4\n# fail 0"));
  assert.ok(!outputShowsFailure("npm test", "# fail 1"), "without a pipe the exit code is trusted");
  assert.ok(!outputShowsFailure('npm test -- --grep "a|b"', "# fail 1"), "a | inside quotes is not a pipe");
});

test("exit codes from unknown tool_response shapes", () => {
  assert.equal(exitCodeFrom({ exit_code: 2 }), 2);
  assert.equal(exitCodeFrom({ exitCode: 0 }), 0);
  assert.equal(exitCodeFrom("Process exited with code 1"), 1);
  assert.equal(exitCodeFrom({ stdout: "x" }), null);
});

test("'Not verified:' escape hatch", () => {
  assert.ok(hasNotVerifiedSection("Done.\n\nNot verified: the email template, no SMTP here."));
  assert.ok(hasNotVerifiedSection("## Proof\n- a -> npm test, exit 0\n- **Not verified:** mobile layout"));
  assert.ok(hasNotVerifiedSection("### Not verified\n- the CSV export"));
  assert.ok(!hasNotVerifiedSection("Not verified: none"));
  assert.ok(!hasNotVerifiedSection("Not verified: N/A."));
  assert.ok(!hasNotVerifiedSection("Everything was verified."));
  assert.ok(!hasNotVerifiedSection(undefined));
});

test("Proof block: a heading named Proof at any level, or **Proof** alone on its line", () => {
  assert.ok(hasProofBlock("Done.\n\n## Proof\n- a -> npm test exit 0"));
  assert.ok(hasProofBlock("# proof"));
  assert.ok(hasProofBlock("Done.\r\n###### PROOF:\r\n- x"));
  assert.ok(hasProofBlock("  ## Proof ##"));
  assert.ok(hasProofBlock("Done.\n**Proof**\n- x"));
  assert.ok(hasProofBlock("**Proof:**"));
  assert.ok(hasProofBlock("__proof__"));
  assert.ok(!hasProofBlock("Here is proof that it works."));
  assert.ok(!hasProofBlock("## Proof of concept"));
  assert.ok(!hasProofBlock("**Proof**: the tests pass"));
  assert.ok(!hasProofBlock("#Proof"));
  assert.ok(!hasProofBlock(undefined));
});

test("Proof block and Not verified: a heading inside a code block does not count", () => {
  assert.ok(!hasProofBlock("Use this format:\n```\n## Proof\n- x\n```"));
  assert.ok(!hasProofBlock("~~~md\n## Proof\n~~~"));
  assert.ok(!hasProofBlock("````\n```\n## Proof\n```\n````"), "a longer fence closes only on its own length");
  assert.ok(!hasProofBlock("```\n## Proof"), "an unclosed fence runs to the end");
  assert.ok(hasProofBlock("Example:\n```\ncode\n```\n\n## Proof\n- x"), "a real heading after a code block counts");
  assert.ok(!hasNotVerifiedSection("```\nNot verified: the CSV export\n```"));
  assert.ok(hasNotVerifiedSection("```\ncode\n```\nNot verified: the CSV export"));
});

test("session key: session_id first, else the transcript path, else the project folder", () => {
  assert.equal(sessionKey({ session_id: "abc" }), "abc");
  const a = sessionKey({ transcript_path: "/t/a.jsonl", cwd: "/p" });
  const b = sessionKey({ transcript_path: "/t/b.jsonl", cwd: "/p" });
  assert.notEqual(a, b);
  assert.equal(a, sessionKey({ transcript_path: "/t/a.jsonl", cwd: "/other" }), "stable for one transcript");
  assert.notEqual(sessionKey({ cwd: "/p" }), sessionKey({ cwd: "/q" }));
  assert.notEqual(a, "default");
});

test("pruneSessions: deletes session files older than 7 days, at most once a day", () => {
  const dir = tempDir();
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const age = (file, days) => utimesSync(join(dir, file), (now - days * day) / 1000, (now - days * day) / 1000);
  try {
    for (const f of ["old.events.jsonl", "old.budget.json", "new.events.jsonl"]) writeFileSync(join(dir, f), "x");
    age("old.events.jsonl", 8);
    age("old.budget.json", 30);
    age("new.events.jsonl", 2);
    assert.equal(pruneSessions(dir, now), 2);
    assert.deepEqual(readdirSync(dir).filter((f) => !f.startsWith(".")).sort(), ["new.events.jsonl"]);
    writeFileSync(join(dir, "later.events.jsonl"), "x");
    age("later.events.jsonl", 9);
    assert.equal(pruneSessions(dir, now + 60_000), 0, "already pruned today");
    assert.equal(pruneSessions(dir, now + day + 60_000), 1, "a day later it runs again");
    assert.equal(pruneSessions(join(dir, "missing")), 0, "no state folder yet: nothing to do");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard-tests and track decide on the path before reading any file", () => {
  const dir = tempDir();
  const reads = [];
  const original = fs.readFileSync;
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "big.js"), "x\n".repeat(1000));
    const edit = { tool_name: "Edit", cwd: dir, tool_input: { file_path: join(dir, "src", "big.js"), old_string: "x", new_string: "y" } };
    const write = { tool_name: "Write", cwd: dir, tool_input: { file_path: join(dir, "src", "big.js"), content: "y" } };
    fs.readFileSync = function (path, ...rest) {
      if (String(path).includes("big.js")) reads.push(String(path));
      return original.call(this, path, ...rest);
    };
    syncBuiltinESMExports();
    assert.equal(guard(edit, { cwd: dir, config: cfg }), null);
    assert.equal(guard(write, { cwd: dir, config: cfg }), null);
    assert.deepEqual(editedPaths(write), [join(dir, "src", "big.js")]);
    assert.deepEqual(editsFromInput(write, () => false), []);
    assert.deepEqual(reads, [], "a non-test file is never read");
    assert.equal(editsFromInput(write).length, 1);
    assert.equal(reads.length, 1, "without a filter the Write's old text is read (the probe works)");
  } finally {
    fs.readFileSync = original;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shell writes: heredoc bodies are content, cd moves the base folder", () => {
  const cmd = "cd demo && cat > test/fees.test.js <<'EOF'\nconst f = () => 1;\nassert.ok(total > 0);\nEOF\nnpm test";
  assert.equal(stripHeredocs(cmd), "cd demo && cat > test/fees.test.js <<'EOF'\nnpm test");
  const written = shellWrittenPaths(cmd, "/p");
  assert.equal(written.length, 1);
  assert.equal(written[0].path, "test/fees.test.js");
  assert.match(written[0].dir.replace(/\\/g, "/"), /\/p\/demo$/);
  assert.deepEqual(
    shellWrittenPaths("@'\nx > y\n'@ | Set-Content -Path .\\test\\a.test.js").map((w) => w.path),
    [".\\test\\a.test.js"],
  );
  assert.deepEqual(shellWrittenPaths("sed -i 's/1/2/' test/a.test.js").map((w) => [w.path, w.inPlace]), [["test/a.test.js", true]]);
  assert.deepEqual(shellWrittenPaths("npm test 2>&1 | tee out.log").map((w) => w.path), ["out.log"]);
});

test("lineDiff finds added and removed lines with numbers", () => {
  const ops = lineDiff("a\nb\nc\n", "a\nB\nc\nd\n");
  assert.deepEqual(
    ops.filter((o) => o.op !== " ").map((o) => `${o.op}${o.text}@${o.op === "+" ? o.newNo : o.oldNo}`),
    ["-b@2", "+B@2", "+d@4"],
  );
});

test("parseApplyPatch reads Codex patches", () => {
  const files = parseApplyPatch("*** Begin Patch\n*** Add File: a.js\n+x\n*** Update File: b.js\n@@\n ctx\n-old\n+new\n*** Delete File: c.js\n*** End Patch");
  assert.deepEqual(files.map((f) => [f.op, f.path]), [["add", "a.js"], ["update", "b.js"], ["delete", "c.js"]]);
  assert.equal(files[1].oldText, "ctx\nold");
  assert.equal(files[1].newText, "ctx\nnew");
});

test("analyseTestEdit: adding a test with assertions is clean", () => {
  assert.deepEqual(analyseTestEdit("", "test('x', () => {\n  expect(f(1)).toBe(2);\n});"), []);
});

test("analyseTestEdit: unchanged count but weaker matcher is not caught (a known limit)", () => {
  assert.deepEqual(analyseTestEdit("expect(total).toBe(1999);", "expect(total).toBeGreaterThan(0);"), []);
});

test("deletedPaths parses rm, git rm, del, Remove-Item", () => {
  assert.deepEqual(deletedPaths("rm -f a.test.js b.js && npm test"), ["a.test.js", "b.js"]);
  assert.deepEqual(deletedPaths("git rm -r tests"), ["tests"]);
  assert.deepEqual(deletedPaths("git rm -r --cached tests"), [], "--cached only untracks");
  assert.deepEqual(deletedPaths('echo "cleanup; rm test/a.test.js"'), [], "a ; inside quotes is text");
  assert.deepEqual(deletedPaths("Remove-Item -Recurse 'test\\x.test.js'"), ["test\\x.test.js"]);
  assert.deepEqual(deletedPaths("ls test"), []);
});

test("scanAdded: findings carry line numbers", () => {
  const found = scanAdded(
    [
      { no: 4, text: "// @ts-ignore" },
      { no: 5, text: "const x = y as any;" },
      { no: 9, text: "return a + b;" },
    ],
    "src/a.ts",
  );
  assert.deepEqual(found.map((f) => f.no), [4, 5]);
});

test("codeOf: trailing comments and string contents are not code", () => {
  assert.equal(codeOf("const a = 1; // treat it as any other", "a.ts").code.trim(), "const a = 1;");
  assert.equal(codeOf("const u = 'http://x'; // c", "a.ts").code.trim(), "const u = 'http://x';");
  assert.equal(codeOf("x = 1  # noqa", "a.py").code.trim(), "x = 1");
  assert.equal(codeOf("this.#count = 1;", "a.js").code, "this.#count = 1;", "# is not a comment in JS");
  assert.equal(codeOf("try { f() } catch { /* ignore */ }", "a.js").bare.replace(/\s+/g, " "), "try { f() } catch { }");
  assert.equal(codeOf(" * an empty catch {} here", "a.js").code, "", "inside a /* */ block");
  assert.equal(codeOf('log("as any")', "a.ts").bare, 'log("      ")');
  const found = scanAdded(
    [
      { no: 1, text: "// treat it as any other" },
      { no: 2, text: "const s = 'console.log(x)';" },
      { no: 3, text: "const v = x as any; // cast" },
      { no: 4, text: "// TODO: rounding" },
      { no: 5, text: "f(); // eslint-disable-line" },
    ],
    "src/a.ts",
  );
  assert.deepEqual(found.map((f) => f.no), [3, 4, 5]);
});

test("sumNumstat adds insertions and deletions and skips binary files", () => {
  assert.equal(sumNumstat("3\t1\tsrc/a.js\n-\t-\timg.png\n10\t0\tb.js\n"), 14);
});

test("expectedStart finds where the expected value begins", async () => {
  const { expectedStart } = await import("../plugin/hooks/guard-tests.mjs");
  const a = "expect(total(cart)).toBe(1999);";
  assert.equal(a.slice(expectedStart(a)).startsWith(").toBe("), true);
  const b = "assert.equal(lineTotal({ qty: 2, cents: 100 }), 200);";
  assert.equal(b.slice(expectedStart(b)), ", 200);");
  const c = "    assert tax(100) == 20";
  assert.equal(c.slice(expectedStart(c)), "== 20");
  assert.equal(expectedStart("const x = 1;"), -1);
});
