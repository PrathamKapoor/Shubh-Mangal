"""Render exact supplied-coordinate drawings as PNG reference assets; no AI imagery."""
from pathlib import Path
import json,re,math,csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.path import Path as MPath
from matplotlib.patches import PathPatch
ROOT=Path(__file__).resolve().parents[1];d=json.loads((ROOT/'public/data/layout.json').read_text())
def patch(path,face,edge='#6c8066',lw=.35):
 vs=[];codes=[]
 for ring in path.split('M')[1:]:
  pts=[tuple(map(float,p.split(','))) for p in ring.replace('Z','').strip().split(' L')]
  vs.extend(pts);codes.extend([MPath.MOVETO]+[MPath.LINETO]*(len(pts)-1));vs.append(pts[0]);codes.append(MPath.CLOSEPOLY)
 return PathPatch(MPath(vs,codes),facecolor=face,edgecolor=edge,linewidth=lw)
def base(ax):
 colors={'site':'#e5e8d8','road':'#7f8981','block':'#d1ddc4','amenity':'#b4cba9'}
 for a in d['areas']:ax.add_patch(patch(a['path'],colors[a['kind']]))
 for p in d['plots']:ax.add_patch(patch(p['path'],'#dfd9c9' if p['identityReviewRequired'] else '#d8e3ca',lw=.23))
 ax.set_aspect('equal');ax.axis('off');ax.set_facecolor('#f6f4ec')
fig,ax=plt.subplots(figsize=(10,13),facecolor='#f6f4ec');base(ax)
for p in d['plots']:
 if not p['identityReviewRequired']:ax.text(*p['center'],p['label'],ha='center',va='center',fontsize=3,color='#23452e')
x,y,w,h=d['viewBox'];ax.set_xlim(x,x+w);ax.set_ylim(y+h,y)
fig.suptitle('SHUBH MANGAL RESIDENCY',fontsize=20,color='#1b4232',y=.97,fontweight='bold')
fig.text(.5,.938,'KML layout reference • reconstructed cells • north up',ha='center',fontsize=10,color='#677660')
fig.text(.5,.025,'Illustrative drawing. Confirm plot identities and dimensions against the authoritative plan.',ha='center',fontsize=8,color='#6c7565')
fig.savefig(ROOT/'public/assets/geographic-layout.png',dpi=240,bbox_inches='tight',facecolor=fig.get_facecolor());plt.close(fig)
p=next(p for p in d['plots'] if p['label']=='B26')
fig,ax=plt.subplots(figsize=(10,8),facecolor='#f6f4ec');base(ax);ax.add_patch(patch(p['path'],'#e2ba62',edge='#a7771c',lw=2))
x,y,x2,y2=p['bounds'];ax.set_xlim(x-6,x2+10);ax.set_ylim(y2+7,y-6)
for edge in p['edges']:
 a,b=edge['a'],edge['b'];cx=(a[0]+b[0])/2;cy=(a[1]+b[1])/2;angle=-math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]));
 if angle>90 or angle< -90:angle+=180
 ax.text(cx,cy,f"≈ {edge['feet']:.1f} ft",rotation=angle,ha='center',va='center',fontsize=11,color='#62420d',bbox={'facecolor':'#fff9e9','edgecolor':'none','pad':3})
ax.text(*p['center'],'B26',ha='center',va='center',fontsize=22,color='#3a4829',fontweight='bold')
fig.suptitle('Plot selection & edge-length reference',fontsize=19,color='#1b4232',y=.97)
fig.text(.5,.91,'Example drawn from the KML — estimates, not approved survey dimensions',ha='center',fontsize=10,color='#6c7565')
fig.text(.5,.025,'Use this image to guide Codex’s selection outline, edge labels, and unit-switching interface.',ha='center',fontsize=9,color='#6c7565')
fig.savefig(ROOT/'public/assets/plot-dimensions-example.png',dpi=200,bbox_inches='tight',facecolor=fig.get_facecolor());plt.close(fig)
with (ROOT/'docs/inventory-review-template.csv').open('w',newline='') as f:
 fields=['draftGeometryId','sourceBlock','candidatePlotNumber','identityReviewRequired','approvedPlotId','approvedPlotNumber','verifiedAreaSqFt','frontageFeet','depthFeet','surveyDocumentRevision','availability','priceINR','ownerReviewedAt','notes']
 out=csv.DictWriter(f,fieldnames=fields);out.writeheader()
 for p in d['plots']:out.writerow({'draftGeometryId':p['id'],'sourceBlock':p['block'],'candidatePlotNumber':p['label'],'identityReviewRequired':p['identityReviewRequired'],'availability':'unverified'})
with (ROOT/'docs/source-annotations.csv').open('w',newline='') as f:
 out=csv.writer(f);out.writerow(['sourceText','localXmetres','localYmetres'])
 for a in d['annotations']:out.writerow([a['text'],*a['center']])
print('Rendered geographic-layout.png, plot-dimensions-example.png, inventory-review-template.csv, source-annotations.csv')
