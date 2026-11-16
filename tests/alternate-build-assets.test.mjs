import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("alternate production build contains only selected site source assets", { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "shubh-alternate-build-"));
  try {
    const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
      env: { ...process.env, SITE_SOURCE_CONFIG: "tests/fixtures/second-site/source.json", SITE_BUILD_DIR: dir },
      encoding: "utf8", timeout: 80000,
    });
    assert.equal(build.status, 0, build.stderr);
    assert.match(await readFile(join(dir,"synthetic/schematic.svg"),"utf8"),/<svg/);
    for (const path of ["data/layout.json", "downloads/survey-plan-north.pdf", "downloads/Shubh_Mangal_Full_Layout.kml", "assets/colony-poster.png"])
      await assert.rejects(stat(join(dir,path)), {code:"ENOENT"}, path);
    assert.ok((await stat(join(dir,"downloads/inventory-review-template.csv"))).isFile());
  } finally { await rm(dir,{recursive:true,force:true}); }
});
