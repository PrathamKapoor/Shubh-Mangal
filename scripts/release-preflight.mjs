import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve, extname, isAbsolute, relative } from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenDirectories = new Set([
  ".local",
  "node_modules",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "backups",
  "logs",
  "paper",
  "papers",
  "research",
]);
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".woff",
  ".woff2",
  ".ttf",
  ".mp4",
  ".glb",
  ".wasm",
]);
const tokens =
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,})\b/;
const privateKey = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/;

function forbidden(path) {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1);
  return (
    parts.some((part) => forbiddenDirectories.has(part)) ||
    (name !== ".env.example" &&
      (name === ".env" || name.startsWith(".env."))) ||
    /\.(?:local|log|dump|bak|sqlite|sqlite3|db|tex|bib|sty|cls)$/.test(name) ||
    name.endsWith(".tar.gz")
  );
}

function git(cwd, args) {
  const result = spawnSync("git", ["--no-pager", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) throw Error("Git scan failed");
  return result.stdout;
}

function locations(content, path) {
  if (content.includes("\0")) return [];
  return content
    .split(/\r?\n/)
    .flatMap((line, index) =>
      tokens.test(line) || privateKey.test(line)
        ? [{ path, line: index + 1 }]
        : [],
    );
}

function scope() {
  return {
    files: 0,
    excludedContent: 0,
    forbiddenPaths: [],
    secretLocations: [],
    errorPaths: [],
  };
}

function finish(part) {
  part.forbiddenPaths = [...new Set(part.forbiddenPaths)].sort();
  part.errorPaths = [...new Set(part.errorPaths)].sort();
  part.secretLocations = [
    ...new Map(
      part.secretLocations.map((item) => [
        JSON.stringify([item.path, item.line]),
        item,
      ]),
    ).values(),
  ].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

// Reads tracked working files and reachable commit blobs only. It never walks runtime
// directories, reads forbidden file contents, writes reports, or changes Git state.
export async function scanRelease({
  cwd = process.cwd(),
  maxCommits = 500,
  maxHistoryEntries = 100000,
  maxTextBytes = 8 * 1024 * 1024,
} = {}) {
  cwd = resolve(cwd);
  const report = {
    exitCode: 0,
    tracked: scope(),
    history: { commits: 0, ...scope() },
  };
  try {
    // Require the repository root so a subdirectory cannot hide tracked paths.
    const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
    if (resolve(root).toLowerCase() !== cwd.toLowerCase())
      throw Error("Root required");
    const entries = git(cwd, ["ls-files", "--stage", "-z"])
      .split("\0")
      .filter(Boolean);
    for (const entry of entries) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
      if (!match) throw Error("Invalid tracked entry");
      const [, mode, , stage, path] = match;
      report.tracked.files++;
      if (forbidden(path)) {
        report.tracked.forbiddenPaths.push(path);
        report.tracked.excludedContent++;
        continue;
      }
      try {
        const fullPath = resolve(cwd, path);
        const within = relative(cwd, fullPath);
        if (
          within.startsWith("..") ||
          isAbsolute(within) ||
          stage !== "0" ||
          !["100644", "100755"].includes(mode)
        )
          throw Error("Unsafe tracked entry");
        // Reject symlinked parent directories as well as symlinked files.
        let current = cwd;
        for (const segment of path.split("/")) {
          current = resolve(current, segment);
          if ((await lstat(current)).isSymbolicLink())
            throw Error("Symlink excluded");
        }
        if (binaryExtensions.has(extname(path).toLowerCase())) {
          report.tracked.excludedContent++;
          continue;
        }
        const info = await lstat(fullPath);
        if (!info.isFile() || info.size > maxTextBytes)
          throw Error("Text scan limit");
        report.tracked.secretLocations.push(
          ...locations(await readFile(fullPath, "utf8"), path),
        );
      } catch {
        report.tracked.errorPaths.push(path);
      }
    }
  } catch {
    report.tracked.errorPaths.push(".git");
  }
  try {
    const revisions = git(cwd, [
      "rev-list",
      "--all",
      `--max-count=${maxCommits + 1}`,
    ])
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    if (revisions.length > maxCommits) throw Error("History scan limit");
    const seen = new Set();
    let entriesRead = 0;
    for (const revision of revisions) {
      report.history.commits++;
      const entries = git(cwd, ["ls-tree", "-r", "-z", revision])
        .split("\0")
        .filter(Boolean);
      entriesRead += entries.length;
      if (entriesRead > maxHistoryEntries) throw Error("History entry limit");
      for (const entry of entries) {
        const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
        if (!match) throw Error("Invalid historical entry");
        const [, mode, type, object, path] = match;
        const identity = JSON.stringify([path, object]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        report.history.files++;
        if (forbidden(path)) {
          report.history.forbiddenPaths.push(path);
          report.history.excludedContent++;
          continue;
        }
        if (type !== "blob" || !["100644", "100755"].includes(mode)) {
          report.history.errorPaths.push(path);
          continue;
        }
        if (binaryExtensions.has(extname(path).toLowerCase())) {
          report.history.excludedContent++;
          continue;
        }
        try {
          if (
            Number(git(cwd, ["cat-file", "-s", object]).trim()) > maxTextBytes
          )
            throw Error("Text scan limit");
          report.history.secretLocations.push(
            ...locations(git(cwd, ["cat-file", "blob", object]), path),
          );
        } catch {
          report.history.errorPaths.push(path);
        }
      }
    }
  } catch {
    report.history.errorPaths.push(".git");
  }
  finish(report.tracked);
  finish(report.history);
  if (report.tracked.errorPaths.length || report.history.errorPaths.length)
    report.exitCode = 2;
  else if (
    report.tracked.forbiddenPaths.length ||
    report.history.forbiddenPaths.length ||
    report.tracked.secretLocations.length ||
    report.history.secretLocations.length
  )
    report.exitCode = 1;
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = await scanRelease({ cwd: process.argv[2] || process.cwd() });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.exitCode;
}
