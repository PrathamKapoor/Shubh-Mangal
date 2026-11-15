import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { measuredStructureGeometry, preparePublicStructure, createStructureMeshGeometry, createModelFrontGeometry, preparePublicGate } from "../../shared/measured-structure.mjs";

// Independent, procedural visual only. The caller supplies all measurements;
// this component does not assert provenance, review, or live-site status.
export default function MeasuredStructure({ record, layout, anchor, bearingDegrees, pivot, dimensions, height, color = "#9ca99b" }) {
  const geometry = useMemo(() => {
    if (record !== undefined) {
      const model = preparePublicStructure(record, layout);
      return model ? createStructureMeshGeometry(model.model ? { rings: [model.model.footprint], height: model.model.height } : model) : null;
    }
    const model = measuredStructureGeometry({ anchor, bearingDegrees, pivot, dimensions, height });
    return createStructureMeshGeometry({ rings: [model.footprint], height: model.height });
  }, [record, layout, anchor, bearingDegrees, pivot, dimensions, height]);
  const front = useMemo(() => {
    if (record === undefined) return null;
    const model = preparePublicStructure(record, layout)?.model;
    return model ? createModelFrontGeometry(model) : null;
  }, [record, layout]);
  useEffect(() => () => { geometry?.dispose(); front?.dispose(); }, [geometry, front]);
  if (!geometry) return null;
  const body = (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={1} />
    </mesh>
  );
  if (!front) return body;
  return <group>{body}<mesh geometry={front}><meshBasicMaterial color="#45382c" side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} /></mesh></group>;
}

// Separate unequal posts preserve the opening; the reviewed route point is not a pivot.
export function MeasuredGate({ access, layout, onSelect }) {
  const geometries = useMemo(() => {
    const gate = preparePublicGate(access, layout);
    return gate?.height == null ? [] : gate.posts.map((ring) => createStructureMeshGeometry({rings:[ring],height:gate.height}));
  }, [access, layout]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  return <group>{geometries.map((geometry,index) => <mesh key={index} geometry={geometry} rotation={[-Math.PI/2,0,0]} onClick={(event) => { if (event.delta > 5) return; event.stopPropagation(); onSelect?.(access); }}><meshStandardMaterial color={index === 0 ? "#8a725d" : "#5a4740"} roughness={1} side={THREE.DoubleSide} /></mesh>)}</group>;
}
