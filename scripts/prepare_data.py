"""Rebuild illustrative geometry. Python: pip install shapely pyproj matplotlib"""
from pathlib import Path
import xml.etree.ElementTree as ET
import json,re,math,collections
from shapely.geometry import Polygon,LineString,Point,mapping
from shapely.ops import transform,split,unary_union
from pyproj import Transformer
ROOT=Path(__file__).resolve().parents[1]
ns={'k':'http://www.opengis.net/kml/2.2'}
r=ET.parse(ROOT/'source-data/Shubh_Mangal_Full_Layout.kml')
f=r.findall('.//k:Folder',ns)
to_m=Transformer.from_crs(4326,32643,always_xy=True).transform
to_ll=Transformer.from_crs(32643,4326,always_xy=True).transform

def coords(node):return [tuple(map(float,v.split(',')[:2])) for v in (node.text or '').split()]
def polygons(pm):
 out=[]
 for g in pm.findall('.//k:Polygon',ns):
  c=g.find('k:outerBoundaryIs/k:LinearRing/k:coordinates',ns)
  holes=[coords(x) for x in g.findall('k:innerBoundaryIs/k:LinearRing/k:coordinates',ns)]
  if c is not None:
   p=transform(to_m,Polygon(coords(c),holes)); p=p if p.is_valid else p.buffer(0)
   if not p.is_empty:out.append(p)
 return out

def lines(pm):return [transform(to_m,LineString(coords(x))) for x in pm.findall('.//k:LineString/k:coordinates',ns)]
def name(pm):return pm.findtext('k:name','',ns)
labels=[]
for p in f[2].findall('k:Placemark',ns):
 gs=polygons(p)
 if gs:
  geom=unary_union(gs); c=geom.centroid
  labels.append({'text':name(p),'point':c,'geometry':geom})
all_shapes=[]
for pm in f[0].findall('k:Placemark',ns):
 for p in polygons(pm):
  if p.geom_type=='Polygon':all_shapes.append((name(pm),p))
xs=[p.bounds[0] for _,p in all_shapes];ys=[p.bounds[1] for _,p in all_shapes]
ox=min(xs);oy=min(ys)
maxy=max(p.bounds[3] for _,p in all_shapes)
# Local SVG units are metres; y increases southward.
def local(p):return transform(lambda x,y,z=None:(x-ox,maxy-y),p)
def svgpath(p):
 p=local(p)
 if p.geom_type=='MultiPolygon':return ' '.join(svgpath_from_local(x) for x in p.geoms)
 return svgpath_from_local(p)
def svgpath_from_local(p):
 rings=[p.exterior,*p.interiors]
 return ' '.join('M'+' L'.join(f'{x:.3f},{y:.3f}' for x,y in ring.coords)+' Z' for ring in rings)
line_lookup={name(p):lines(p) for p in f[1].findall('k:Placemark',ns)}
plots=[];review=[];plot_geo=[]
for block,poly in all_shapes:
 if not re.fullmatch(r'PLO[TY] \d+',block):continue
 parts=[poly]
 for line in line_lookup.get(block+' dividers',[]):
  c=list(line.coords)
  if len(c)<2:continue
  # Extend the drawn divider past the boundary to bridge sub-metre drafting gaps.
  def extend(a,b):
   dx=a[0]-b[0];dy=a[1]-b[1];d=math.hypot(dx,dy)
   return (a[0]+dx/d*2,a[1]+dy/d*2) if d else a
  cutter=LineString([extend(c[0],c[1]),*c[1:-1],extend(c[-1],c[-2])])
  nxt=[]
  for piece in parts:
   try:nxt.extend(x for x in split(piece,cutter).geoms if x.area>1)
   except ValueError:nxt.append(piece)
  parts=nxt
 for i,p in enumerate(parts):
  matches=[v for v in labels if re.fullmatch(r'[ABC]?\s*\d+',v['text'],re.I) and p.buffer(.1).contains(v['point'])]
  valid=len(matches)==1
  label=matches[0]['text'] if valid else f'{block} cell {i+1}'
  pid=re.sub(r'[^a-z0-9]+','-',f'{block}-{label}-cell-{i+1}'.lower())
  simple=p.simplify(.12,preserve_topology=True)
  cc=list(simple.exterior.coords)
  edges=[]
  for a,b in zip(cc,cc[1:]):
   d=math.dist(a,b)
   if d>.5:edges.append({'a':[round(a[0]-ox,3),round(maxy-a[1],3)],'b':[round(b[0]-ox,3),round(maxy-b[1],3)],'metres':round(d,2),'feet':round(d/0.3048,2)})
  c=local(p.representative_point())
  rec={'id':pid,'label':label,'block':block,'path':svgpath(p),'center':[round(c.x,3),round(c.y,3)],'bounds':list(local(p).bounds),'areaSqMApprox':round(p.area,2),'edges':edges,'identityReviewRequired':not valid,'labelCandidates':[m['text'] for m in matches],'status':'unverified','verifiedDimensions':None,'geometrySource':'KML divider reconstruction; owner review required'}
  plots.append(rec)
  plot_geo.append({'type':'Feature','properties':{'id':pid,'label':label,'block':block,'reviewRequired':True},'geometry':mapping(transform(to_ll,p))})
  if not valid:review.append({'id':pid,'reason':'ambiguous or absent label','candidates':rec['labelCandidates']})
counts=collections.Counter((p['block'],p['label']) for p in plots if not p['identityReviewRequired'])
for p in plots:
 if counts[(p['block'],p['label'])]>1:
  p['identityReviewRequired']=True
  review.append({'id':p['id'],'reason':'same label matched multiple cells','candidates':p['labelCandidates']})
base=[]
for i,(nm,p) in enumerate(all_shapes):base.append({'id':f'area-{i}','name':nm,'path':svgpath(p),'kind':'block' if re.fullmatch(r'PLO[TY] \d+',nm) else 'road' if nm=='ROADS' else 'site' if nm=='Site base' else 'amenity'})
annotations=[]
for i,v in enumerate(labels):
 c=local(v['point']);annotations.append({'text':v['text'],'center':[c.x,c.y],'path':svgpath(v['geometry'])})
width=max(local(p).bounds[2] for _,p in all_shapes);height=max(local(p).bounds[3] for _,p in all_shapes)
geo=[]
for rec in plots:
 # original corresponding polygons retain their geographic positions through path reconstruction elsewhere
 pass
# Keep original source geometry as GeoJSON, without interpreting drawing labels as saleable plots.
for i,(nm,p) in enumerate(all_shapes):geo.append({'type':'Feature','properties':{'sourceName':nm,'sourceIndex':i,'reviewRequired':True},'geometry':mapping(transform(to_ll,p))})
data={'project':'Shubh Mangal Residency','viewBox':[-8,-8,round(width+16,3),round(height+16,3)],'origin':{'utmZone':'43N','easting':ox,'northingTop':maxy},'geographicBounds':[74.907154,24.464082,74.910999,24.468348],'plots':plots,'areas':base,'annotations':annotations,'warning':'Illustrative KML reconstruction. All identities, dimensions, and availability require owner review.'}
(ROOT/'public/data/reconstructed-cells.geojson').write_text(json.dumps({'type':'FeatureCollection','features':plot_geo}))
(ROOT/'public/data/layout.json').write_text(json.dumps(data,separators=(',',':')))
(ROOT/'public/data/source-areas.geojson').write_text(json.dumps({'type':'FeatureCollection','features':geo}))
report={'sourcePlacemarks':712,'sourceNamedPlotBlocks':26,'reconstructedCells':len(plots),'singleLabelMatches':sum(not p['identityReviewRequired'] for p in plots),'ambiguousCells':len(review),'availability':'No inventory supplied; all unverified','reviewItems':review,'method':'UTM 43N; each block split by its named dividers extended 2m at both ends; label centroid containment. Approximate edges simplified at 0.12m. Never use as legal/survey dimensions.'}
(ROOT/'docs/DATA_AUDIT.json').write_text(json.dumps(report,indent=2))
# Precise vector overview, drawn from supplied coordinates rather than AI imagery.
colors={'site':'#e8e8de','road':'#64716d','block':'#c7d7bc','amenity':'#a8c7a4'}
paths=''.join(f'<path d="{a["path"]}" fill="{colors[a["kind"]]}" fill-rule="evenodd" stroke="#476451" stroke-width=".22"/>' for a in base)
paths+=''.join(f'<path d="{p["path"]}" fill="none" stroke="#425a48" stroke-width=".19"/>' for p in plots)
paths+=''.join(f'<text x="{p["center"][0]}" y="{p["center"][1]}" text-anchor="middle" dominant-baseline="central" font-size="1.65" fill="#173a2e">{p["label"] if not p["identityReviewRequired"] else "?"}</text>' for p in plots)
svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 {width+16} {height+16}" width="1800" height="2400"><rect x="-8" y="-8" width="{width+16}" height="{height+16}" fill="#f8f6ee"/>{paths}</svg>'
(ROOT/'public/assets/geographic-layout.svg').write_text(svg)
print(json.dumps({k:v for k,v in report.items() if k!='reviewItems'},indent=2))
