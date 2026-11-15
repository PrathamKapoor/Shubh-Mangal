import React, { useState } from "react";

// Geographic evidence and model frame are separate from illustrative scale.
export default function StructureFields({ value, onChange }) {
  const [coordinates, setCoordinates] = useState(() => JSON.stringify({ outer: value.footprint.outer, holes: value.footprint.holes }, null, 2));
  const [error, setError] = useState("");
  const frame = (patch) => onChange({ ...value, frame: { ...value.frame, ...patch } });
  const number = (text) => text === "" ? null : Number(text);
  const pivot = (index, text) => frame({ pivot: value.frame.pivot.map((point, i) => i === index ? number(text) : point) });
  function applyCoordinates() {
    try {
      const parsed = JSON.parse(coordinates);
      if (!Array.isArray(parsed.outer) || !Array.isArray(parsed.holes)) throw Error();
      onChange({ ...value, footprint: { ...value.footprint, outer: parsed.outer, holes: parsed.holes } });
      setError("");
    } catch {
      setError("Enter a JSON object with outer and holes arrays of WGS84 longitude/latitude pairs.");
    }
  }
  return <section aria-label="Measured structure evidence">
    <p>Footprint coordinates are WGS84 longitude, latitude. Anchor and pivot are explicit; unknown height remains unknown. Placement is not field-verified by this editor.</p>
    <label>Footprint WGS84 coordinates<textarea rows={7} value={coordinates} onChange={(event) => setCoordinates(event.target.value)} /></label>
    <button type="button" onClick={applyCoordinates}>Apply footprint coordinates</button>
    {error && <p role="alert">{error}</p>}
    <label>Footprint source<input value={value.footprint.source} onChange={(event) => onChange({ ...value, footprint: { ...value.footprint, source: event.target.value } })} /></label>
    <label>Footprint source revision<input value={value.footprint.sourceRevision} onChange={(event) => onChange({ ...value, footprint: { ...value.footprint, sourceRevision: event.target.value } })} /></label>
    {[['lat', 'Physical anchor latitude'], ['lon', 'Physical anchor longitude']].map(([axis, label]) => <label key={axis}>{label}<input type="number" step="any" value={value.frame.physicalAnchor[axis] ?? ""} onChange={(event) => frame({ physicalAnchor: { ...value.frame.physicalAnchor, [axis]: number(event.target.value) } })} /></label>)}
    <label>Bearing clockwise from north (degrees)<input type="number" min="0" max="359.999" step="any" value={value.frame.headingDegrees ?? ""} onChange={(event) => frame({ headingDegrees: number(event.target.value) })} /></label>
    {['right', 'up', 'forward'].map((axis, index) => <label key={axis}>Model pivot {axis} (m)<input type="number" step="any" value={value.frame.pivot[index] ?? ""} onChange={(event) => pivot(index, event.target.value)} /></label>)}
    <label>Measured height (m, optional)<input type="number" min="0" step="any" value={value.height?.metres ?? ""} onChange={(event) => onChange({ ...value, height: event.target.value === "" ? null : { metres: number(event.target.value), source: value.height?.source || "", sourceRevision: value.height?.sourceRevision || "" } })} /></label>
    {value.height && <><label>Height source<input value={value.height.source} onChange={(event) => onChange({ ...value, height: { ...value.height, source: event.target.value } })} /></label><label>Height source revision<input value={value.height.sourceRevision} onChange={(event) => onChange({ ...value, height: { ...value.height, sourceRevision: event.target.value } })} /></label></>}
    <label>Procedural model<select value={value.model?.assetId ?? ""} onChange={(event) => onChange({ ...value, model: event.target.value ? { assetId: "synthetic-building", revision: "v1", rights: "", correspondence: "", dimensions: { width: null, depth: null, cutoutWidth: null, cutoutDepth: null, source: "", sourceRevision: "" } } : null })}><option value="">No model (footprint only)</option><option value="synthetic-building">Synthetic asymmetric building v1</option></select></label>
    {value.model && <>
      <p>This procedural fixture is illustrative. Its complete footprint must match the reviewed outline within 1 mm of coordinate conversion precision; no height is inferred.</p>
      <label>Model rights and source<input value={value.model.rights} onChange={(event) => onChange({ ...value, model: { ...value.model, rights: event.target.value } })} /></label>
      <label>Model correspondence evidence<input value={value.model.correspondence} onChange={(event) => onChange({ ...value, model: { ...value.model, correspondence: event.target.value } })} /></label>
      {[["width", "Model width (m)"], ["depth", "Model depth (m)"], ["cutoutWidth", "Model cutout width (m)"], ["cutoutDepth", "Model cutout depth (m)"]].map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" value={value.model.dimensions?.[key] ?? ""} onChange={(event) => onChange({ ...value, model: { ...value.model, dimensions: { ...value.model.dimensions, [key]: number(event.target.value) } } })} /></label>)}
      {[["source", "Model dimensions source"], ["sourceRevision", "Model dimensions source revision"]].map(([key, label]) => <label key={key}>{label}<input value={value.model.dimensions?.[key] ?? ""} onChange={(event) => onChange({ ...value, model: { ...value.model, dimensions: { ...value.model.dimensions, [key]: event.target.value } } })} /></label>)}
    </>}
    <p>Model axes: right, up, forward. World axes: east, up, south. Units: metres.</p>
  </section>;
}

// The route-access destination remains a separate field on the same entrance.
export function GateModelFields({ value, onChange }) {
  const number = (text) => text === "" ? null : Number(text);
  const update = (patch) => onChange({...value,...patch});
  return <section aria-label="Synthetic gate model evidence">
    <label>Gate model<select value={value?.assetId ?? ""} onChange={(event) => onChange(event.target.value ? {assetId:"synthetic-gate",revision:"v1",pivot:[0,0,0],rights:"",correspondence:"",dimensions:{width:null,depth:null,leftPostWidth:null,rightPostWidth:null,source:"",sourceRevision:""},height:null} : null)}><option value="">No gate model</option><option value="synthetic-gate">Synthetic asymmetric gate v1</option></select></label>
    {value && <>
      <p>Illustrative synthetic model: its opening is between unequal posts. The physical anchor and bearing are set on this entrance; the route destination is separate.</p>
      <label>Gate model rights and source<input value={value.rights} onChange={(event)=>update({rights:event.target.value})}/></label>
      <label>Gate model correspondence evidence<input value={value.correspondence} onChange={(event)=>update({correspondence:event.target.value})}/></label>
      {["right","up","forward"].map((axis,index)=><label key={axis}>Gate model pivot {axis} (m)<input type="number" step="any" value={value.pivot[index] ?? ""} onChange={(event)=>update({pivot:value.pivot.map((v,i)=>i===index?number(event.target.value):v)})}/></label>)}
      {[["width","Gate width (m)"],["depth","Gate depth (m)"],["leftPostWidth","Left gatepost width (m)"],["rightPostWidth","Right gatepost width (m)"]].map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="any" value={value.dimensions[key] ?? ""} onChange={(event)=>update({dimensions:{...value.dimensions,[key]:number(event.target.value)}})}/></label>)}
      {[["source","Gate dimensions source"],["sourceRevision","Gate dimensions source revision"]].map(([key,label])=><label key={key}>{label}<input value={value.dimensions[key]} onChange={(event)=>update({dimensions:{...value.dimensions,[key]:event.target.value}})}/></label>)}
      <label>Gate measured height (m, optional)<input type="number" min="0" step="any" value={value.height?.metres ?? ""} onChange={(event)=>update({height:event.target.value === "" ? null : {metres:number(event.target.value),source:value.height?.source || "",sourceRevision:value.height?.sourceRevision || ""}})}/></label>
      {value.height && <>{[["source","Gate height source"],["sourceRevision","Gate height source revision"]].map(([key,label])=><label key={key}>{label}<input value={value.height[key]} onChange={(event)=>update({height:{...value.height,[key]:event.target.value}})}/></label>)}</>}
    </>}
  </section>;
}
