import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
const excluded = new Set([
  "node_modules",
  ".git",
  ".agents",
  ".aws",
  ".codex",
  ".local",
  "reports",
  "test-results",
  "playwright-report",
  ".openai",
]);
async function walk(dir = ".") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      excluded.has(entry.name) ||
      (entry.name.startsWith(".env") && entry.name !== ".env.example") ||
      entry.name.endsWith(".log")
    )
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile() && path !== "docs/FILE_MANIFEST.json")
      out.push(path);
  }
  return out;
}
const list = [];
for (const path of (await walk()).sort()) {
  const bytes = await readFile(path);
  list.push({
    path,
    bytes: (await stat(path)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  "docs/FILE_MANIFEST.json",
  JSON.stringify(list, null, 2) + "\n",
);
console.info(
  `Manifest records ${list.length} source/generated files; excludes runtime/private/test output and itself.`,
);
