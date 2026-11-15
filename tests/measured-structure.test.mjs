import test from "node:test";
import assert from "node:assert/strict";
import { measuredStructureGeometry } from "../shared/measured-structure.mjs";

const base = {
  anchor: [100, 200], bearingDegrees: 0, pivot: [1, 2],
  dimensions: { width: 8, depth: 5, cutoutWidth: 3, cutoutDepth: 2 },
  height: 4,
};
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((point, i) => point.forEach((v, j) =>
    assert.ok(Math.abs(v - expected[i][j]) < 1e-9, `${i},${j}: ${v} != ${expected[i][j]}`)));
};

test("asymmetric footprint preserves width, depth and off-centre pivot at north", () => {
  const result = measuredStructureGeometry(base);
  close(result.footprint, [[99,202],[107,202],[107,199],[104,199],[104,197],[99,197]]);
  assert.equal(result.height, 4);
});

test("bearing is clockwise from north and pivot remains at anchor", () => {
  const east = measuredStructureGeometry({ ...base, bearingDegrees: 90 });
  close(east.footprint, [[98,199],[98,207],[101,207],[101,204],[103,204],[103,199]]);
  const wrapped = measuredStructureGeometry({ ...base, bearingDegrees: -270 });
  close(wrapped.footprint, east.footprint);
  const corner = measuredStructureGeometry({ ...base, pivot: [0,0], bearingDegrees: 90 });
  close([corner.footprint[0]], [[100,200]]);
});

test("unknown height is flat and measured zero is not accepted", () => {
  assert.equal(measuredStructureGeometry({ ...base, height: null }).height, null);
  assert.throws(() => measuredStructureGeometry({ ...base, height: 0 }), /height/i);
  assert.throws(() => measuredStructureGeometry({ ...base, height: undefined }), /height/i);
});

test("invalid coordinates and degenerate dimensions fail closed", () => {
  for (const change of [
    { anchor: [NaN, 1] }, { bearingDegrees: Infinity }, { pivot: [1] },
    { dimensions: { ...base.dimensions, cutoutWidth: 8 } },
    { dimensions: { ...base.dimensions, cutoutDepth: 0 } },
    { dimensions: { ...base.dimensions, width: -1 } },
  ]) assert.throws(() => measuredStructureGeometry({ ...base, ...change }), TypeError);
});

import { readFile } from "node:fs/promises";
import { planToGeographic } from "../shared/geography.mjs";
import { preparePublicStructure, createStructureMeshGeometry } from "../shared/measured-structure.mjs";

const layout = JSON.parse(await readFile("tests/fixtures/second-site/layout.json", "utf8"));
const geo = ([x, y]) => {
  const { lon, lat } = planToGeographic({ x, y }, layout);
  return [lon, lat];
};
const outer = [[10,10],[30,10],[30,18],[22,18],[22,30],[10,30],[10,10]];
const hole = [[12,12],[16,12],[16,16],[12,16],[12,12]];
const publicRecord = {
  id: "synthetic", kind: "structure", published: {
    title: "Synthetic",
    footprint: { outer: outer.map(geo), holes: [hole.map(geo)] },
    frame: { physicalAnchor: planToGeographic({ x: 13, y: 15 }, layout), headingDegrees: 90, units: "metres", modelAxes: "right-up-forward", worldAxes: "east-up-south", pivot: [2, 1, -3] },
    height: null, model: null,
  },
};
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-5, `${a} != ${b}`);

test("public geographic footprint and hole preserve position independently of frame", () => {
  const before = structuredClone(publicRecord);
  const result = preparePublicStructure(publicRecord, layout);
  assert.equal(result.height, null);
  assert.equal(result.rings.length, 2);
  for (const [ring, expected] of [[result.rings[0], outer], [result.rings[1], hole]]) {
    assert.equal(ring.length, expected.length - 1);
    ring.forEach((point, i) => { near(point[0], expected[i][0]); near(point[1], expected[i][1]); });
  }
  const changed = structuredClone(publicRecord);
  changed.published.frame.headingDegrees = 13;
  changed.published.frame.pivot = [9, 5, 4];
  assert.deepEqual(preparePublicStructure(changed, layout).rings, result.rings);
  assert.deepEqual(publicRecord, before);
});

test("flat and measured extrusion retain the hole and dispose geometry", () => {
  for (const height of [null, { metres: 4.5 }]) {
    const result = preparePublicStructure({ ...publicRecord, published: { ...publicRecord.published, height } }, layout);
    const geometry = createStructureMeshGeometry(result);
    geometry.computeBoundingBox();
    near(geometry.boundingBox.min.z, 0);
    near(geometry.boundingBox.max.z, height?.metres ?? 0);
    const p = geometry.getAttribute("position"), index = geometry.getIndex();
    const ids = index ? Array.from(index.array) : Array.from({length:p.count}, (_,i) => i);
    let capArea = 0;
    for (let i=0; i<ids.length; i+=3) {
      const pts = ids.slice(i,i+3).map(n => [p.getX(n),p.getY(n),p.getZ(n)]);
      if (!pts.every(q => Math.abs(q[2]) < 1e-6)) continue;
      capArea += Math.abs((pts[1][0]-pts[0][0])*(pts[2][1]-pts[0][1])-(pts[1][1]-pts[0][1])*(pts[2][0]-pts[0][0]))/2;
    }
    near(capArea, 288); // (20*20 - 8*12) - 4*4
    let disposed = false;
    geometry.addEventListener("dispose", () => { disposed = true; });
    geometry.dispose();
    assert.equal(disposed, true);
  }
});

test("unpublished, hidden, malformed or out-of-bounds structures fail closed", () => {
  const variants = [
    { ...publicRecord, published: null },
    { ...publicRecord, kind: "amenity" },
    { ...publicRecord, published: { ...publicRecord.published, customerVisible: false } },
    { ...publicRecord, published: { ...publicRecord.published, frame: { ...publicRecord.published.frame, units: "feet" } } },
    { ...publicRecord, published: { ...publicRecord.published, height: { metres: 0 } } },
    { ...publicRecord, published: { ...publicRecord.published, height: { metres: 4, source: "private" } } },
    { ...publicRecord, published: { ...publicRecord.published, model: { assetId: "unsupported" } } },
    { ...publicRecord, published: { ...publicRecord.published, footprint: { ...publicRecord.published.footprint, holes: [publicRecord.published.footprint.outer] } } },
    { ...publicRecord, published: { ...publicRecord.published, frame: { ...publicRecord.published.frame, physicalAnchor: {lon: 74.91, lat: 24.47} } } },
  ];
  for (const item of variants) assert.equal(preparePublicStructure(item, layout), null);
  assert.equal(preparePublicStructure(publicRecord, {}), null);
});

test("structure component creates and cleans up meshes on replacement and unmount", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: ["src/components/MeasuredStructure.jsx"], bundle: true, write: false,
    platform: "node", format: "cjs",
    plugins: [{ name: "hook-harness", setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "test-react" }));
      build.onLoad({ filter: /.*/, namespace: "test-react" }, () => ({ contents: `
        const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
        export default React;
        export const useMemo = (factory) => factory();
        export const useEffect = (effect) => { globalThis.__structureCleanup = effect(); };
      `, loader: "js" }));
    }}],
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(module, module.exports, (await import("node:module")).createRequire(import.meta.url));
  const Component = module.exports.default;
  try {
    const flat = Component({ record: publicRecord, layout });
    assert.equal(flat.type, "mesh");
    let flatDisposed = false;
    flat.props.geometry.addEventListener("dispose", () => { flatDisposed = true; });
    const cleanupFlat = globalThis.__structureCleanup;
    const raised = Component({ record: { ...publicRecord, published: { ...publicRecord.published, height: { metres: 3 } } }, layout });
    cleanupFlat();
    assert.equal(flatDisposed, true);
    raised.props.geometry.computeBoundingBox();
    near(raised.props.geometry.boundingBox.max.z, 3);
    let raisedDisposed = false;
    raised.props.geometry.addEventListener("dispose", () => { raisedDisposed = true; });
    globalThis.__structureCleanup();
    assert.equal(raisedDisposed, true);
    assert.equal(Component({ record: { ...publicRecord, published: null }, layout }), null);
  } finally { delete globalThis.__structureCleanup; }
});


test("published model uses its physical pivot and clockwise bearing independently of the visual outline", () => {
  const item = structuredClone(publicRecord);
  item.published.frame.physicalAnchor = planToGeographic({x:20,y:20},layout);
  item.published.frame.headingDegrees = 90;
  item.published.frame.pivot = [1,0,2];
  item.published.height = {metres:4};
  item.published.model = {assetId:"synthetic-building",revision:"v1",dimensions:{width:8,depth:5,cutoutWidth:3,cutoutDepth:2}};
  const result = preparePublicStructure(item, layout);
  assert.ok(result.model);
  result.model.footprint.forEach((point, i) => point.forEach((v,j) => near(v, [[18,19],[18,27],[21,27],[21,24],[23,24],[23,19]][i][j])));
  assert.equal(result.model.height,4);
});


test("procedural building front is visibly placed on its forward edge at the reviewed height", async () => {
  const mod = await import("../shared/measured-structure.mjs");
  assert.equal(typeof mod.createModelFrontGeometry, "function");
  const geometry = mod.createModelFrontGeometry({footprint:[[0,0],[8,0],[8,-5],[5,-5],[5,-8],[0,-8]],height:4});
  geometry.computeBoundingBox();
  near(geometry.boundingBox.min.x,1); near(geometry.boundingBox.max.x,3);
  near(geometry.boundingBox.min.y,0.8); near(geometry.boundingBox.max.y,3.2);
  near(geometry.boundingBox.min.z,0); near(geometry.boundingBox.max.z,0);
  geometry.dispose();
});


test("synthetic gate has two unequal front posts and a measured opening under clockwise bearing", async () => {
  const mod=await import("../shared/measured-structure.mjs");
  assert.equal(typeof mod.measuredGateGeometry,"function");
  const gate=mod.measuredGateGeometry({anchor:[100,200],bearingDegrees:90,pivot:[1,0],dimensions:{width:8,depth:2,leftPostWidth:1,rightPostWidth:2},height:3});
  close(gate.footprint,[[100,199],[100,207],[102,207],[102,199]]);
  assert.equal(gate.openingWidth,5);
  assert.equal(gate.posts.length,2);
  close(gate.posts[0].slice(0,2),[[100,199],[100,200]]);
});


test("published visitor gate projects the physical anchor and keeps its route destination separate", async () => {
  const mod=await import("../shared/measured-structure.mjs");
  assert.equal(typeof mod.preparePublicGate,"function");
  const access={title:"Synthetic gate",routeAccess:planToGeographic({x:40,y:40},layout),
    physicalAnchor:planToGeographic({x:20,y:20},layout),headingDegrees:90,state:"existing",source:"Synthetic evidence",sourceRevision:"1",verifiedAt:"2026-01-01T00:00:00Z",customerVisible:true,
    footprint:{outer:[[20,20],[20,28],[22,28],[22,20],[20,20]].map(geo),holes:[]},
    model:{assetId:"synthetic-gate",revision:"v1",pivot:[0,0,0],dimensions:{width:8,depth:2,leftPostWidth:1,rightPostWidth:2},height:{metres:3}}};
  const gate=mod.preparePublicGate(access,layout);
  assert.ok(gate); assert.equal(gate.openingWidth,5); assert.equal(gate.height,3);
  gate.footprint.forEach((p,i)=>p.forEach((v,j)=>near(v,[[20,20],[20,28],[22,28],[22,20]][i][j])));
  assert.notDeepEqual(access.physicalAnchor,access.routeAccess);
});
