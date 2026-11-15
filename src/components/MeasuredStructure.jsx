import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { measuredStructureGeometry, preparePublicStructure, createStructureMeshGeometry } from "../../shared/measured-structure.mjs";

// Independent, procedural visual only. The caller supplies all measurements;
// this component does not assert provenance, review, or live-site status.
export default function MeasuredStructure({ record, layout, anchor, bearingDegrees, pivot, dimensions, height, color = "#9ca99b" }) {
  const geometry = useMemo(() => {
    if (record !== undefined) {
      const model = preparePublicStructure(record, layout);
      return model ? createStructureMeshGeometry(model) : null;
    }
    const model = measuredStructureGeometry({ anchor, bearingDegrees, pivot, dimensions, height });
    return createStructureMeshGeometry({ rings: [model.footprint], height: model.height });
  }, [record, layout, anchor, bearingDegrees, pivot, dimensions, height]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={1} />
    </mesh>
  );
}
