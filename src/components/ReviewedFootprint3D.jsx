import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { createFootprint3D } from "../../shared/footprint3d.mjs";

// Mount inside a React Three Fiber Canvas. Pass the reviewed/public access
// payload (or null) and the source layout. onSelect receives that access.
// The present access schema has no height, so this draws only its outline.
export default function ReviewedFootprint3D({ access, layout, onSelect }) {
  const geometry = useMemo(() => {
    const model = createFootprint3D(access, layout);
    if (!model) return null;
    const points = model.rings.flatMap((ring) =>
      ring.flatMap((point, i) => [
        new THREE.Vector3(...point),
        new THREE.Vector3(...ring[(i + 1) % ring.length]),
      ]),
    );
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [access, layout]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <lineSegments
      geometry={geometry}
      position={[0, 0.7, 0]}
      onClick={
        onSelect
          ? (event) => {
              if (event.delta > 5) return;
              event.stopPropagation();
              onSelect(access);
            }
          : undefined
      }
      raycast={onSelect ? undefined : () => null}
    >
      <lineBasicMaterial color="#b88927" />
    </lineSegments>
  );
}
