import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanRelease } from "../scripts/release-preflight.mjs";

const fakeToken = ["gh", "p_", "A".repeat(36)].join("");
const fakeKey = ["-----BEGIN ", "PRIVATE KEY", "-----"].join("");
const cli = fileURLToPath(
  new URL("../scripts/release-preflight.mjs", import.meta.url),
);

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "shubh-preflight-"));
  const git = (...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "core.hooksPath=" + join(root, "disabled-hooks"),
        "-c",
        "user.name=Synthetic Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, "Synthetic git fixture command failed");
    return result.stdout;
  };
  const put = async (path, content) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  try {
    git("init", "--quiet");
    await run({ root, git, put });
  } finally {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir()) + "/") ||
        resolve(root).startsWith(resolve(tmpdir()) + "\\"),
    );
    await rm(root, { recursive: true, force: true });
  }
}

test("clean tracked source passes without reading untracked runtime or changing the checkout", async () => {
  await fixture(async ({ root, git, put }) => {
    await put("app.mjs", "export const answer = 42;\n");
    await put(".env.example", "EXAMPLE_TOKEN=replace-me\n");
    git("add", "app.mjs", ".env.example");
    git("commit", "--quiet", "-m", "Synthetic clean fixture");
    await put(".local/private.txt", fakeToken);
    await put(".env", fakeKey);
    const before = git("status", "--porcelain=v1", "--untracked-files=all");
    const report = await scanRelease({ cwd: root });
    assert.equal(report.exitCode, 0);
    assert.equal(report.tracked.files, 2);
    assert.equal(report.history.commits, 1);
    assert.deepEqual(report.tracked.secretLocations, []);
    assert.equal(
      git("status", "--porcelain=v1", "--untracked-files=all"),
      before,
    );
    assert.equal(
      await readFile(join(root, "app.mjs"), "utf8"),
      "export const answer = 42;\n",
    );
  });
});

test("forbidden tracked paths fail and their contents are excluded", async () => {
  await fixture(async ({ root, git, put }) => {
    const forbidden = [
      ".env",
      ".env.production",
      ".local/data.txt",
      "node_modules/pkg/index.js",
      "research/notes.md",
      "paper/draft.txt",
      "src/manuscript.tex",
      "dist/app.js",
    ];
    for (const path of forbidden) await put(path, fakeToken);
    await put(".env.example", "EXAMPLE_TOKEN=replace-me\n");
    git("add", "--all");
    const report = await scanRelease({ cwd: root });
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.tracked.forbiddenPaths, [...forbidden].sort());
    assert.deepEqual(report.tracked.secretLocations, []);
    assert.equal(report.tracked.excludedContent, forbidden.length);
  });
});

test("token and private-key matches report paths and lines without matched content", async () => {
  await fixture(async ({ root, git, put }) => {
    await put(
      "config.txt",
      "Synthetic fixture\n" + fakeToken + "\n" + fakeKey + "\n",
    );
    git("add", "config.txt");
    const report = await scanRelease({ cwd: root });
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.tracked.secretLocations, [
      { path: "config.txt", line: 2 },
      { path: "config.txt", line: 3 },
    ]);
    const output = JSON.stringify(report);
    assert.ok(!output.includes(fakeToken));
    assert.ok(!output.includes(fakeKey));
    const result = spawnSync(process.execPath, [cli, root], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), report);
    assert.equal(result.stderr, "");
  });
});

test("reachable history detects removed tokens and forbidden runtime paths", async () => {
  await fixture(async ({ root, git, put }) => {
    await put("old-config.txt", fakeToken + "\n");
    await put(".local/runtime.txt", fakeKey);
    git("add", "--all");
    git("commit", "--quiet", "-m", "Synthetic historical fixture");
    git("rm", "--quiet", "old-config.txt", ".local/runtime.txt");
    await put("app.mjs", "export const answer = 42;\n");
    git("add", "app.mjs");
    git("commit", "--quiet", "-m", "Synthetic removal fixture");
    const report = await scanRelease({ cwd: root });
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.tracked.secretLocations, []);
    assert.equal(report.history.commits, 2);
    assert.deepEqual(report.history.secretLocations, [
      { path: "old-config.txt", line: 1 },
    ]);
    assert.deepEqual(report.history.forbiddenPaths, [".local/runtime.txt"]);
    assert.ok(!JSON.stringify(report).includes(fakeToken));
    assert.ok(!JSON.stringify(report).includes(fakeKey));
  });
});

test("history limits fail closed rather than reporting an incomplete clean scan", async () => {
  await fixture(async ({ root, git, put }) => {
    await put("app.mjs", "export const answer = 1;\n");
    git("add", "app.mjs");
    git("commit", "--quiet", "-m", "Synthetic first revision");
    await put("app.mjs", "export const answer = 2;\n");
    git("add", "app.mjs");
    git("commit", "--quiet", "-m", "Synthetic second revision");
    const report = await scanRelease({ cwd: root, maxCommits: 1 });
    assert.equal(report.exitCode, 2);
    assert.deepEqual(report.history.errorPaths, [".git"]);
  });
});

test("allowed example files are scanned and oversized text fails closed", async () => {
  await fixture(async ({ root, git, put }) => {
    await put(".env.example", "EXAMPLE_TOKEN=" + fakeToken + "\n");
    await put("large.txt", "Synthetic text fixture\n");
    git("add", ".env.example", "large.txt");
    const report = await scanRelease({ cwd: root });
    assert.equal(report.exitCode, 1);
    assert.deepEqual(report.tracked.forbiddenPaths, []);
    assert.deepEqual(report.tracked.secretLocations, [
      { path: ".env.example", line: 1 },
    ]);
    const limited = await scanRelease({ cwd: root, maxTextBytes: 10 });
    assert.equal(limited.exitCode, 2);
    assert.deepEqual(limited.tracked.errorPaths, [".env.example", "large.txt"]);
  });
});

test("Git failures return only error paths without emitting Git diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "shubh-preflight-notgit-"));
  try {
    const result = spawnSync(process.execPath, [cli, root], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.tracked.errorPaths, [".git"]);
    assert.deepEqual(report.history.errorPaths, [".git"]);
  } finally {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir()) + "/") ||
        resolve(root).startsWith(resolve(tmpdir()) + "\\"),
    );
    await rm(root, { recursive: true, force: true });
  }
});
