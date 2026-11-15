import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { measuredStructureGeometry, preparePublicStructure, createStructureMeshGeometry, createModelFrontGeometry } from "../../shared/measured-structure.mjs";

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
