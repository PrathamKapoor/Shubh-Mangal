import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync(new URL('../public/data/layout.json',import.meta.url)));
const geo=JSON.parse(fs.readFileSync(new URL('../public/data/reconstructed-cells.geojson',import.meta.url)));
const audit=JSON.parse(fs.readFileSync(new URL('../docs/DATA_AUDIT.json',import.meta.url)));
test('each selectable cell has a unique stable ID and matching GeoJSON feature',()=>{
 assert.equal(new Set(data.plots.map(p=>p.id)).size,data.plots.length);
 const ids=new Set(geo.features.map(f=>f.properties.id));
 for(const p of data.plots)assert.ok(ids.has(p.id),p.id);
});
test('all dimensions stay approximate and no inventory is fabricated',()=>{
 for(const p of data.plots){assert.equal(p.status,'unverified');assert.equal(p.verifiedDimensions,null);assert.ok(p.areaSqMApprox>0);for(const e of p.edges){assert.ok(e.metres>0);assert.ok(Math.abs(e.feet*0.3048-e.metres)<0.01);}}
});
test('polygons have closed geographic rings within the source region',()=>{
 for(const f of geo.features){assert.equal(f.geometry.type,'Polygon');for(const ring of f.geometry.coordinates){assert.deepEqual(ring[0],ring.at(-1));for(const [lon,lat]of ring){assert.ok(lon>74.90&&lon<74.92);assert.ok(lat>24.46&&lat<24.48);}}}
});
test('duplicate labels within a block require review, never silently resolve',()=>{
 const groups=new Map();for(const p of data.plots){const k=p.block+'|'+p.label;groups.set(k,[...(groups.get(k)||[]),p]);}
 for(const group of groups.values())if(group.length>1)for(const p of group)assert.ok(p.identityReviewRequired);
 assert.equal(audit.ambiguousCells,data.plots.filter(p=>p.identityReviewRequired).length);
 assert.equal(audit.singleLabelMatches,data.plots.filter(p=>!p.identityReviewRequired).length);
});
