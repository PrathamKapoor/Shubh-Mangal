import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sources = {
  "source-data/MAHENDRAR JI ALL PDF NORTH.pdf":
    "b620e28e8f1e71fc8b033a6cdc8e5a33c5d3206d26ff20cf3bd3aec7094d355b",
  "source-data/Shubh_Mangal_Full_Layout.kml":
    "04bb6f3ce491388828e3802c3998b7cb6e3256900bbbb88cfda42f01de70d234",
  "public/data/layout.json":
    "fe76aa56592f85546ebefdcf1ad187a0602cb8bfc355a22d06fadc89c228fb8f",
  "public/data/reconstructed-cells.geojson":
    "120f42a6709d1d747a558697df5f779a5a46c9e8ed512a31a5ccf039e3a63230",
  "public/data/source-areas.geojson":
    "54e04cda2ca48445326939b2ce178bfdf1cc1bc28c4e95f2e783f8aaa8d175e7",
  "public/assets/colony-poster.png":
    "0749adbc06d17b04e31cad82b5e6ebba553a0b31126cd93b571398f39924aafd",
  "public/assets/survey-plan-north.png":
    "853863accaefaaa5713de34d5515c038cc36680c6709624d1ffb71ddf0b97b90",
  "public/assets/geographic-layout.svg":
    "262b112222726a58b93bb41312571b606aa79eae60008233a3339e15ac3cc5b8",
  "public/assets/geographic-layout.png":
    "23ca9ea6d66633fa608df8ba9f8618d23dba178edf8049dce028440b4d10fec7",
  "public/assets/plot-dimensions-example.png":
    "c1755a667b88337682a04288f6b41d6d0fec287f39ab11b1ef64c01500f2655b",
  "docs/inventory-review-template.csv":
    "60aca0471198ff31091724db7dea4f2ae4f9c82512642a2596a47f772a0b2754",
  "docs/source-annotations.csv":
    "05ec553388dacb3edfbd955b7ac669348c587c72039a4144629eaab7e1a9583a",
  "docs/DATA_AUDIT.json":
    "3c915539596d0fdbc3cec13380c247d8c17f48774cadf293a9f9ea82260b64c2",
};
test("original documents, assets, geometry, audit and CSV sources are byte-for-byte preserved", () => {
  for (const [file, expected] of Object.entries(sources))
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      expected,
      file,
    );
});
