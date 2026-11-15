import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import ReviewedFootprint3D from "./ReviewedFootprint3D";
import MeasuredStructure from "./MeasuredStructure";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  pointInRing,
  referenceFor,
} from "../../shared/owner-amenity-references.mjs";
import {
  classifyRings,
  ringsFromPath,
  toWorld,
} from "../../shared/scene3d.mjs";
import { approvedBlocks } from "../../shared/domain.mjs";
import { geographicToPlan } from "../../shared/geography.mjs";

// 3D is a visualisation of the same presentation records, not a source of
// dimensions. Shape geometry comes only from each supplied/published SVG path.
const colours = {
  available: "#a8d5a2",
  reserved: "#f6c58a",
  sold: "#aab0b2",
  blocked: "#aaa99f",
  unverified: "#e7e4da",
};
function shapeGeometry(path) {
  // The road is one SVG path with many even-odd holes. Keep its rings
  // separate so plots and gardens do not become accidental triangles.
  const rings = classifyRings(ringsFromPath(path));
  if (!rings.length) return null;
  function trace(contour, ring) {
    contour.moveTo(ring[0][0], -ring[0][1]);
    for (const [x, y] of ring.slice(1)) contour.lineTo(x, -y);
    contour.closePath();
    return contour;
  }
  const shapes = rings.map(({ outer, holes }) => {
    const shape = trace(new THREE.Shape(), outer);
    shape.holes = holes.map((hole) => trace(new THREE.Path(), hole));
    return shape;
  });
  return new THREE.ShapeGeometry(shapes);
}
function Surface({ path, colour, height = 0, onClick, opacity = 1 }) {
  const geometry = useMemo(() => shapeGeometry(path), [path]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, height, 0]}
      onClick={onClick}
    >
      <meshStandardMaterial
        color={colour}
        side={THREE.DoubleSide}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={1}
      />
    </mesh>
  );
}
function Outline({ path, selected, colour }) {
  const geometry = useMemo(() => {
    const points = ringsFromPath(path).flatMap((ring) =>
      ring.flatMap((point, i) => [
        new THREE.Vector3(...toWorld(point, selected ? 1.3 : 0.7)),
        new THREE.Vector3(
          ...toWorld(ring[(i + 1) % ring.length], selected ? 1.3 : 0.7),
        ),
      ]),
    );
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [path, selected]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={selected ? "#b88927" : colour || "#a8ab97"} />
    </lineSegments>
  );
}
// WebGL's basic line width is limited to one pixel on most devices. A small
// raised gold stroke makes the selected record visible independently of its
// status fill without changing the underlying parcel geometry.
function SelectedOutline({ path }) {
  const segments = useMemo(
    () =>
      ringsFromPath(path)
        .flatMap((ring) =>
          ring.map((a, i) => {
            const b = ring[(i + 1) % ring.length];
            const dx = b[0] - a[0],
              dz = b[1] - a[1];
            return {
              x: (a[0] + b[0]) / 2,
              z: (a[1] + b[1]) / 2,
              length: Math.hypot(dx, dz),
              quaternion: new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(dx, 0, dz).normalize(),
              ),
            };
          }),
        )
        .filter((segment) => segment.length > 0),
    [path],
  );
  return (
    <group raycast={() => null}>
      {segments.map((segment, index) => (
        <mesh
          key={index}
          position={[segment.x, 1.1, segment.z]}
          quaternion={segment.quaternion}
          raycast={() => null}
        >
          <cylinderGeometry args={[0.35, 0.35, segment.length, 6]} />
          <meshStandardMaterial color="#b88927" />
        </mesh>
      ))}
    </group>
  );
}
function Label({ text, position }) {
  const sprite = useRef(null);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const parentScale = useMemo(() => new THREE.Vector3(), []);
  const { camera, size } = useThree();
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.font = "bold 56px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 8;
    context.strokeStyle = "#fffdf4";
    context.strokeText(text, 256, 48, 490);
    context.fillStyle = "#183e34";
    context.fillText(text, 256, 48, 490);
    return new THREE.CanvasTexture(canvas);
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Sprites face the camera. Compute their world size from camera distance so
  // the 26px-high label (about 15px text) stays readable at every zoom.
  useFrame(() => {
    if (!sprite.current || !size.height) return;
    sprite.current.getWorldPosition(worldPosition);
    const worldHeight = camera.isPerspectiveCamera
      ? (2 *
          camera.position.distanceTo(worldPosition) *
          Math.tan((camera.fov * Math.PI) / 360) *
          26) /
        size.height
      : ((camera.top - camera.bottom) * 26) / (camera.zoom * size.height);
    sprite.current.parent?.getWorldScale(parentScale);
    const localHeight = worldHeight / (parentScale.y || 1);
    sprite.current.scale.set(localHeight * (512 / 96), localHeight, 1);
  });
  return (
    <sprite ref={sprite} position={position} raycast={() => null}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
function Plot({ plot, selected, onSelect, visible }) {
  return (
    <group>
      <Surface
        path={plot.path}
        colour={colours[plot.status] || colours.unverified}
        opacity={visible || selected ? 1 : 0.22}
        height={0.5}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta > 5) return;
          onSelect?.(plot.id);
        }}
      />
      <Outline path={plot.path} selected={selected} />
      {selected && <SelectedOutline path={plot.path} />}
    </group>
  );
}
// Project candidate labels to screen pixels and admit only readable,
// non-overlapping labels. This runs on demand when the camera renders, not on
// a continuous animation loop. Selection takes priority at every zoom.
function PlotLabels({ plots, selected, visibleIds, enabled }) {
  const { camera, size } = useThree();
  const [admitted, setAdmitted] = useState([]);
  const key = useRef("");
  const point = useMemo(() => new THREE.Vector3(), []);
  const corner = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!enabled || !size.width || !size.height) {
      if (key.current) {
        key.current = "";
        setAdmitted([]);
      }
      return;
    }
    const candidates = [...plots].sort(
      (a, b) => Number(b.id === selected) - Number(a.id === selected),
    );
    const boxes = [];
    const result = [];
    for (const plot of candidates) {
      if (
        !Array.isArray(plot.center) ||
        plot.center.length !== 2 ||
        !plot.center.every(Number.isFinite) ||
        (!visibleIds?.has(plot.id) && visibleIds && plot.id !== selected)
      )
        continue;
      point.set(...toWorld(plot.center, 3)).project(camera);
      if (
        point.z < -1 ||
        point.z > 1 ||
        Math.abs(point.x) > 1 ||
        Math.abs(point.y) > 1
      )
        continue;
      const x = ((point.x + 1) * size.width) / 2,
        y = ((1 - point.y) * size.height) / 2;
      // At broad zoom, let the selected label through but avoid a dense field.
      const distance = camera.position.distanceTo(
        new THREE.Vector3(...toWorld(plot.center)),
      );
      if (distance > 200 && plot.id !== selected) continue;
      if (
        plot.id !== selected &&
        Array.isArray(plot.bounds) &&
        plot.bounds.length === 4 &&
        plot.bounds.every(Number.isFinite)
      ) {
        const [x0, y0, x1, y1] = plot.bounds;
        const screen = [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ].map((p) => {
          corner.set(...toWorld(p, 0.5)).project(camera);
          return [(corner.x * size.width) / 2, (corner.y * size.height) / 2];
        });
        if (
          Math.max(...screen.map((p) => p[0])) -
            Math.min(...screen.map((p) => p[0])) <
            46 ||
          Math.max(...screen.map((p) => p[1])) -
            Math.min(...screen.map((p) => p[1])) <
            23
        )
          continue;
      }
      const box = [x - 36, y - 16, x + 36, y + 16];
      if (
        plot.id !== selected &&
        boxes.some(
          (b) =>
            box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
        )
      )
        continue;
      boxes.push(box);
      result.push(plot);
      if (result.length >= 80) break;
    }
    const next = result.map((p) => p.id).join("|");
    if (next !== key.current) {
      key.current = next;
      setAdmitted(result);
    }
  });
  return (
    <>
      {admitted.map((plot) => (
        <Label
          key={plot.id}
          text={plot.label}
          position={toWorld(plot.center, 3)}
        />
      ))}
    </>
  );
}
// Paths join only visible, owner-placed facilities. A candidate is omitted if
// it cannot be kept inside its indicated area and clear of actual plot/road
// shapes; it is a schematic path rather than a claim about constructed access.
function FacilityConnections({ amenities, data, plots }) {
  const segments = useMemo(() => {
    const lookup = new Map(amenities.map((item) => [item.id, item]));
    const pairs = [
      ["owner-ref-temple", "owner-ref-garden", ["area-2", "area-40"]],
      ["owner-ref-clubhouse", "owner-ref-pool", ["area-3"]],
      ["owner-ref-pool", "owner-ref-gym", ["area-3"]],
    ];
    const road = data.areas
      .filter((a) => a.kind === "road" || a.id === "area-31")
      .flatMap((a) => classifyRings(ringsFromPath(a.path)));
    const parcels = plots.flatMap((p) => classifyRings(ringsFromPath(p.path)));
    const inShape = (p, group) =>
      pointInRing(p, group.outer) &&
      !group.holes.some((h) => pointInRing(p, h));
    return pairs.flatMap(([startId, endId, areas]) => {
      const a = lookup.get(startId)?.mapPoint,
        b = lookup.get(endId)?.mapPoint;
      if (!a || !b) return [];
      const allowed = data.areas
        .filter((area) => areas.includes(area.id))
        .flatMap((area) => classifyRings(ringsFromPath(area.path)));
      const dx = b.x - a.x,
        dz = b.y - a.y,
        length = Math.hypot(dx, dz);
      if (!Number.isFinite(length) || length < 1) return [];
      for (let i = 0; i <= 30; i++) {
        const p = [a.x + (dx * i) / 30, a.y + (dz * i) / 30];
        if (
          !allowed.some((group) => inShape(p, group)) ||
          road.some((group) => inShape(p, group)) ||
          parcels.some((group) => inShape(p, group))
        )
          return [];
      }
      return [
        {
          x: (a.x + b.x) / 2,
          z: (a.y + b.y) / 2,
          length,
          quaternion: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(dx, 0, dz).normalize(),
          ),
        },
      ];
    });
  }, [amenities, data, plots]);
  return (
    <group raycast={() => null}>
      {segments.map((segment, i) => (
        <mesh
          key={i}
          position={[segment.x, 0.35, segment.z]}
          quaternion={segment.quaternion}
          raycast={() => null}
        >
          <cylinderGeometry args={[0.42, 0.42, segment.length, 6]} />
          <meshStandardMaterial color="#e8dcbb" />
        </mesh>
      ))}
    </group>
  );
}
function Facility({ item, onSelect, showLabel, data }) {
  const point = item.mapPoint;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    return null;
  const scale = Number.isFinite(item.visualScale) ? item.visualScale : 1;
  const click = (event) => {
    event.stopPropagation();
    if (event.delta > 5) return;
    onSelect?.(item.id);
  };
  const pool = item.id === "owner-ref-pool",
    gym = item.id === "owner-ref-gym";
  const fountain = item.category === "fountain",
    temple = item.category === "temple",
    playground = item.id === "owner-ref-garden",
    club = item.category === "clubhouse",
    gate = item.category === "entrance",
    corner = item.id.startsWith("owner-ref-roundabout-garden-");
  // The shared temple/garden layer is artwork metadata, not a facility.
  if (referenceFor(item.id)?.internalVisual) return null;
  const area =
    corner &&
    data.areas.find((a) => referenceFor(item.id)?.areaIds.includes(a.id));
  const ring = area && ringsFromPath(area.path)[0];
  const rotation = (-(item.visualRotation || 0) * Math.PI) / 180;
  const shrubs =
    corner && ring
      ? [
          [-3, -1],
          [0, 2],
          [3, 0],
          [1, -3],
          [-5, -3],
          [5, -3],
          [-5, 3],
          [5, 3],
          [-2, 5],
          [2, 5],
          [-2, -5],
          [2, -5],
        ].filter(([x, z]) => {
          const wx =
            point.x + scale * (x * Math.cos(rotation) + z * Math.sin(rotation));
          const wz =
            point.y +
            scale * (-x * Math.sin(rotation) + z * Math.cos(rotation));
          // Leave a margin around each shrub so it does not spill onto the road.
          return [
            [0, 0],
            [-1.5, 0],
            [1.5, 0],
            [0, -1.5],
            [0, 1.5],
          ].every(([dx, dz]) => pointInRing([wx + dx, wz + dz], ring));
        })
      : [];
  return (
    <group
      position={[point.x, 0.9, point.y]}
      rotation={[0, rotation, 0]}
      scale={[scale, scale, scale]}
      onClick={click}
    >
      {corner ? (
        <>
          {shrubs.map(([x, z], i) => (
            <mesh key={i} position={[x, 0.7, z]}>
              <sphereGeometry args={[i % 3 === 0 ? 0.7 : 1, 8, 6]} />
              <meshStandardMaterial
                color={i % 4 === 0 ? "#c77b96" : i % 2 ? "#4d7844" : "#759353"}
              />
            </mesh>
          ))}
          <mesh position={[0, 0.15, 0]} visible={false}>
            <sphereGeometry args={[2, 8, 6]} />
            <meshBasicMaterial />
          </mesh>
        </>
      ) : fountain ? (
        <>
          <mesh position={[0, 1, 0]}>
            <cylinderGeometry args={[10.6, 10.6, 2, 48]} />
            <meshStandardMaterial color="#567c3e" />
          </mesh>
          <mesh position={[0, 2.1, 0]}>
            <cylinderGeometry args={[6.6, 6.6, 0.4, 40]} />
            <meshStandardMaterial color="#e9deca" />
          </mesh>
          <mesh position={[0, 2.35, 0]}>
            <cylinderGeometry args={[5.3, 5.3, 0.2, 40]} />
            <meshStandardMaterial color="#51a8bc" />
          </mesh>
          <mesh position={[0, 3.4, 0]}>
            <cylinderGeometry args={[0.8, 1.1, 2, 16]} />
            <meshStandardMaterial color="#f2ebd6" />
          </mesh>
        </>
      ) : pool ? (
        <>
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[9.2, 0.6, 15.2]} />
            <meshStandardMaterial color="#e8ddc3" />
          </mesh>
          <mesh position={[0, 0.65, 0]}>
            <boxGeometry args={[6.5, 0.15, 12.4]} />
            <meshStandardMaterial color="#32a4bc" />
          </mesh>
        </>
      ) : gym ? (
        <>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[8.2, 0.4, 9.6]} />
            <meshStandardMaterial color="#b2baa2" />
          </mesh>
          {[-2, 2].map((x) => (
            <mesh key={x} position={[x, 1, -1]}>
              <boxGeometry args={[1.5, 1.5, 3]} />
              <meshStandardMaterial color="#e6e3d6" />
            </mesh>
          ))}
          {[-2, 2].map((x) => (
            <mesh key={`w${x}`} position={[x, 1, 2.5]}>
              <boxGeometry args={[2, 1, 0.7]} />
              <meshStandardMaterial color="#3b5147" />
            </mesh>
          ))}
          {[-2, 2].map((x) => (
            <group key={`equipment-${x}`}>
              <mesh position={[x, 2, -2.8]}>
                <boxGeometry args={[0.3, 3.2, 0.3]} />
                <meshStandardMaterial color="#315749" />
              </mesh>
              <mesh position={[x, 3.5, -2]}>
                <boxGeometry args={[1.5, 0.3, 0.3]} />
                <meshStandardMaterial color="#315749" />
              </mesh>
            </group>
          ))}
        </>
      ) : playground ? (
        <>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[10, 0.4, 12]} />
            <meshStandardMaterial color="#d4bf86" />
          </mesh>
          <mesh position={[-2.5, 2, -2]}>
            <boxGeometry args={[1, 4, 1]} />
            <meshStandardMaterial color="#df5540" />
          </mesh>
          <mesh position={[1, 1.5, -1]} rotation={[0, 0, -0.45]}>
            <boxGeometry args={[1.8, 0.5, 5]} />
            <meshStandardMaterial color="#edb34e" />
          </mesh>
          {[-2, 2].map((x) => (
            <mesh key={x} position={[x, 2.5, 3]}>
              <boxGeometry args={[0.5, 5, 0.5]} />
              <meshStandardMaterial color="#426da2" />
            </mesh>
          ))}
          <mesh position={[0, 4.8, 3]}>
            <boxGeometry args={[4.5, 0.4, 0.4]} />
            <meshStandardMaterial color="#426da2" />
          </mesh>
        </>
      ) : gate ? (
        <>
          {[-7, 7].map((x) => (
            <mesh key={x} position={[x, 4, 0]}>
              <boxGeometry args={[2, 8, 3]} />
              <meshStandardMaterial color="#ead9b4" />
            </mesh>
          ))}
          <mesh position={[0, 8.3, 0]}>
            <boxGeometry args={[16, 1.1, 3]} />
            <meshStandardMaterial color="#bf9e65" />
          </mesh>
        </>
      ) : temple || club ? (
        <>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[temple ? 8 : 13, 0.8, temple ? 8 : 11]} />
            <meshStandardMaterial color="#d7c7a6" />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <boxGeometry args={[temple ? 7 : 12, 6, temple ? 7 : 10]} />
            <meshStandardMaterial color="#ede2cd" />
          </mesh>
          <mesh position={[0, 6.6, 0]}>
            <boxGeometry args={[temple ? 8 : 13, 1.2, temple ? 8 : 11]} />
            <meshStandardMaterial color="#faf5e9" />
          </mesh>
          {temple && (
            <>
              <mesh position={[0, 8.1, 0]}>
                <boxGeometry args={[4.8, 2, 4.8]} />
                <meshStandardMaterial color="#f4e7cd" />
              </mesh>
              <mesh position={[0, 11, 0]}>
                <coneGeometry args={[3, 5, 4]} />
                <meshStandardMaterial color="#d5b482" />
              </mesh>
              <mesh position={[0, 3, 3.54]}>
                <boxGeometry args={[2, 4, 0.12]} />
                <meshStandardMaterial color="#8c6f4d" />
              </mesh>
            </>
          )}
          {club && (
            <>
              <mesh position={[0, 1.1, 5.1]}>
                <boxGeometry args={[9, 0.4, 1.1]} />
                <meshStandardMaterial color="#cbb894" />
              </mesh>
              <mesh position={[0, 3, 5.05]}>
                <boxGeometry args={[3, 4, 0.12]} />
                <meshStandardMaterial color="#8c7353" />
              </mesh>
            </>
          )}
        </>
      ) : (
        <mesh position={[0, 1.6, 0]}>
          <sphereGeometry args={[1.6, 12, 8]} />
          <meshStandardMaterial color="#d3b16a" />
        </mesh>
      )}
      {showLabel && (
        <Label text={item.title} position={[0, fountain ? 7 : 11, 0]} />
      )}
    </group>
  );
}
function CameraControls({ api, initialCenter, coarse, touchMode }) {
  const { camera, gl, invalidate } = useThree();
  const instance = useRef(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    instance.current = controls;
    controls.target.set(initialCenter[0], 0, initialCenter[1]);
    controls.enableDamping = false;
    controls.minDistance = 25;
    controls.maxDistance = 1600;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.addEventListener("change", invalidate);
    controls.listenToKeyEvents(gl.domElement);
    // A normal mouse wheel continues to scroll the page. Ctrl+wheel is an
    // intentional zoom gesture, matching the existing 2D explorer.
    const wheel = (event) => {
      if (!event.ctrlKey) event.stopImmediatePropagation();
    };
    gl.domElement.addEventListener("wheel", wheel, {
      capture: true,
      passive: true,
    });
    const setView = (tilted = false) => {
      camera.position.set(
        initialCenter[0],
        tilted ? 500 : 740,
        initialCenter[1] + (tilted ? 420 : 0.01),
      );
      camera.up.set(0, 0, -1);
      controls.target.set(initialCenter[0], 0, initialCenter[1]);
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    };
    const turn = (direction) => {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (direction * Math.PI) / 8,
      );
      camera.position.copy(controls.target).add(offset);
      controls.update();
      invalidate();
    };
    const focus = (x, z, distance) => {
      const offset = camera.position
        .clone()
        .sub(controls.target)
        .normalize()
        .multiplyScalar(distance);
      controls.target.set(x, 0, z);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      invalidate();
    };
    const zoom = (factor) => {
      const offset = camera.position
        .clone()
        .sub(controls.target)
        .multiplyScalar(factor);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      invalidate();
    };
    const changeAngle = (tilted) => {
      const distance = camera.position.distanceTo(controls.target);
      camera.position.set(
        controls.target.x,
        tilted ? distance * 0.75 : distance,
        controls.target.z + (tilted ? distance * 0.66 : 0.01),
      );
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    };
    api.current = {
      top: () => changeAngle(false),
      tilt: () => changeAngle(true),
      reset: () => setView(false),
      turn,
      focus,
      zoom,
    };
    setView(false);
    return () => {
      api.current = null;
      instance.current = null;
      gl.domElement.removeEventListener("wheel", wheel, { capture: true });
      controls.removeEventListener("change", invalidate);
      controls.dispose();
    };
  }, [camera, gl, invalidate, initialCenter, api]);
  useEffect(() => {
    if (!instance.current) return;
    instance.current.enabled = !coarse || touchMode;
    gl.domElement.style.touchAction = coarse && !touchMode ? "pan-y" : "none";
  }, [coarse, touchMode, gl]);
  return null;
}
function FocusTarget({ api, target, targetKey }) {
  useEffect(() => {
    if (target && api.current)
      api.current.focus(target.x, target.y, target.distance);
  }, [api, targetKey]); // User camera movements survive unrelated data refreshes.
  return null;
}
function WebGLGuard({ onLost }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event) => {
      event.preventDefault();
      onLost();
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onLost]);
  return null;
}
class SceneError extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function webGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
export default function Colony3D({
  data,
  plots = [],
  selected,
  selectedAmenity,
  amenities = [],
  onSelect,
  onAmenitySelect,
  onExit,
  hindi = false,
  showLabels = true,
  showAmenities = true,
  visibleIds,
  selectedBlock,
  focusRequest,
  visitorAccess,
  onAccessSelect,
  structures = [],
  selectedStructure,
}) {
  const [available, setAvailable] = useState(webGLAvailable);
  const [touchMode, setTouchMode] = useState(false);
  const [coarse] = useState(() => matchMedia("(pointer: coarse)").matches);
  const controls = useRef(null);
  const center = useMemo(
    () => [
      data.viewBox[0] + data.viewBox[2] / 2,
      data.viewBox[1] + data.viewBox[3] / 2,
    ],
    [data.viewBox],
  );
  const selectedFacility = amenities.find(
    (item) => item.id === selectedAmenity,
  );
  const selectedPlot = plots.find((plot) => plot.id === selected);
  const block = useMemo(
    () =>
      approvedBlocks(
        plots.filter(
          (p) =>
            Array.isArray(p.bounds) &&
            p.bounds.length === 4 &&
            p.bounds.every(Number.isFinite),
        ),
      ).find((entry) => entry.name === selectedBlock),
    [plots, selectedBlock],
  );
  const complex = amenities.filter(
    (item) =>
      ["owner-ref-clubhouse", "owner-ref-pool", "owner-ref-gym"].includes(
        item.id,
      ) &&
      Number.isFinite(item.mapPoint?.x) &&
      Number.isFinite(item.mapPoint?.y),
  );
  const complexX = complex.length
    ? complex.reduce((sum, item) => sum + item.mapPoint.x, 0) / complex.length
    : 0;
  const complexY = complex.length
    ? complex.reduce((sum, item) => sum + item.mapPoint.y, 0) / complex.length
    : 0;
  const structureTarget = useMemo(() => {
    const record = structures.find((item) => item.id === selectedStructure);
    if (!record?.published?.frame?.physicalAnchor) return null;
    try {
      const point = geographicToPlan(record.published.frame.physicalAnchor, data, { enforceBounds: true });
      return { x: point.x, y: point.y, distance: 40 };
    } catch { return null; }
  }, [structures, selectedStructure, data]);
  const focusTarget = structureTarget || (
    Number.isFinite(selectedFacility?.mapPoint?.x) &&
    Number.isFinite(selectedFacility?.mapPoint?.y)
      ? selectedFacility.id === "owner-ref-clubhouse"
        ? {
            x: complexX,
            y: complexY,
            distance: Math.max(
              120,
              ...complex.map(
                (item) =>
                  Math.hypot(
                    item.mapPoint.x - complexX,
                    item.mapPoint.y - complexY,
                  ) * 5,
              ),
            ),
          }
        : { ...selectedFacility.mapPoint, distance: 110 }
      : Array.isArray(selectedPlot?.center) &&
          selectedPlot.center.length === 2 &&
          selectedPlot.center.every(Number.isFinite)
        ? { x: selectedPlot.center[0], y: selectedPlot.center[1], distance: 75 }
        : block
          ? {
              x: (block.bounds[0] + block.bounds[2]) / 2,
              y: (block.bounds[1] + block.bounds[3]) / 2,
              distance: Math.max(
                80,
                (block.bounds[2] - block.bounds[0]) * 3,
                (block.bounds[3] - block.bounds[1]) * 3,
              ),
            }
          : null);
  const fallback = (
    <div role="status" className="three-fallback">
      <p>
        {hindi
          ? "3D उपलब्ध नहीं है। 2D नक्शा देखें।"
          : "3D is unavailable on this device. Use the 2D map."}
      </p>
      <button type="button" onClick={onExit}>
        {hindi ? "2D नक्शा" : "Back to 2D map"}
      </button>
    </div>
  );
  if (!available) return fallback;
  return (
    <section
      className="colony-three-view"
      aria-label={hindi ? "सांकेतिक 3D कॉलोनी" : "Illustrative 3D colony"}
      data-labels-visible={showLabels}
      data-amenities-visible={showAmenities}
      data-filtered-count={visibleIds?.size ?? plots.length}
      data-visible-plot-count={visibleIds?.size ?? plots.length}
    >
      <p>
        {hindi
          ? "सांकेतिक 3D अवधारणा · माप के अनुसार नहीं"
          : "Illustrative 3D concept · not to scale"}
      </p>
      <div className="colony-three-canvas">
        <SceneError fallback={fallback}>
          <Canvas
            frameloop="demand"
            camera={{
              fov: 42,
              near: 0.1,
              far: 4000,
              position: [center[0], 740, center[1] + 0.01],
            }}
            gl={{ antialias: true, powerPreference: "low-power" }}
          >
            <ambientLight intensity={1.5} />
            <directionalLight position={[100, 300, 50]} intensity={1.7} />
            <WebGLGuard onLost={() => setAvailable(false)} />
            <ReviewedFootprint3D access={visitorAccess} layout={data} onSelect={onAccessSelect} />
            {Array.isArray(structures) && structures.map((record) =>
              typeof record?.id === "string" && record.id.trim() ? (
                <MeasuredStructure key={record.id} record={record} layout={data} />
              ) : null,
            )}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[center[0], -1, center[1]]}
            >
              <planeGeometry args={[1800, 1800]} />
              <meshStandardMaterial color="#9cb881" />
            </mesh>
            {data.areas
              .filter((a) => a.kind === "road" || a.id === "area-31")
              .map((a) => (
                <group key={a.id}>
                  <Surface
                    path={a.path}
                    colour={a.id === "area-31" ? "#5e6b68" : "#68716e"}
                    height={0}
                  />
                  <Outline path={a.path} colour="#bbb8a5" />
                </group>
              ))}
            {data.areas
              .filter((a) => a.kind === "amenity" && a.id !== "area-31")
              .map((a) => (
                <Surface
                  key={a.id}
                  path={a.path}
                  colour="#8aa978"
                  height={0.1}
                />
              ))}
            {plots.map((plot) => (
              <Plot
                key={plot.id}
                plot={plot}
                selected={plot.id === selected}
                onSelect={onSelect}
                visible={!visibleIds || visibleIds.has(plot.id)}
              />
            ))}
            <PlotLabels
              plots={plots}
              selected={selected}
              visibleIds={visibleIds}
              enabled={showLabels}
            />
            {showAmenities && (
              <FacilityConnections
                amenities={amenities.filter((a) => a.customerVisible !== false)}
                data={data}
                plots={plots}
              />
            )}
            {showAmenities &&
              amenities
                .filter((a) => a.customerVisible !== false)
                .map((item) => (
                  <Facility
                    key={item.id}
                    item={item}
                    data={data}
                    onSelect={onAmenitySelect}
                    showLabel={
                      showLabels &&
                      (selectedAmenity === item.id ||
                        ([
                          "owner-ref-clubhouse",
                          "owner-ref-pool",
                          "owner-ref-gym",
                        ].includes(selectedAmenity) &&
                          [
                            "owner-ref-clubhouse",
                            "owner-ref-pool",
                            "owner-ref-gym",
                          ].includes(item.id)))
                    }
                  />
                ))}
            {data.areas
              .filter((area) => area.id === "area-0")
              .map((area) => (
                <Outline key={area.id} path={area.path} colour="#e6dfc8" />
              ))}
            <CameraControls
              api={controls}
              initialCenter={center}
              coarse={coarse}
              touchMode={touchMode}
            />
            <FocusTarget
              api={controls}
              target={focusTarget}
              targetKey={`${selectedStructure || selectedAmenity || selected || selectedBlock || ""}:${focusRequest || 0}`}
            />
          </Canvas>
        </SceneError>
      </div>
      <div
        className="three-controls"
        aria-label={hindi ? "3D नक्शा नियंत्रण" : "3D map controls"}
      >
        <button type="button" onClick={() => controls.current?.top()}>
          {hindi ? "ऊपर से" : "Top view"}
        </button>
        <button type="button" onClick={() => controls.current?.tilt()}>
          {hindi ? "तिरछा दृश्य" : "Tilt view"}
        </button>
        <button type="button" onClick={() => controls.current?.reset()}>
          {hindi ? "पूरी कॉलोनी" : "Full colony"}
        </button>
        <button
          type="button"
          disabled={!focusTarget}
          onClick={() =>
            focusTarget &&
            controls.current?.focus(
              focusTarget.x,
              focusTarget.y,
              focusTarget.distance,
            )
          }
        >
          {hindi ? "चयन दिखाएँ" : "Focus selected"}
        </button>
        {coarse && (
          <button
            type="button"
            aria-pressed={touchMode}
            onClick={() => setTouchMode((value) => !value)}
          >
            {touchMode
              ? hindi
                ? "पेज स्क्रॉल करें"
                : "Scroll page"
              : hindi
                ? "स्पर्श नियंत्रण"
                : "Enable touch controls"}
          </button>
        )}
        <button
          type="button"
          onClick={() => controls.current?.zoom(0.7)}
          aria-label={hindi ? "ज़ूम बढ़ाएँ" : "Zoom in 3D"}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => controls.current?.zoom(1.4)}
          aria-label={hindi ? "ज़ूम घटाएँ" : "Zoom out 3D"}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => controls.current?.turn(-1)}
          aria-label="Rotate left"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => controls.current?.turn(1)}
          aria-label="Rotate right"
        >
          ↷
        </button>
        <button type="button" onClick={onExit}>
          {hindi ? "2D नक्शा" : "Back to 2D map"}
        </button>
      </div>
      <p>
        {hindi
          ? "प्लॉट खोज और सूची 2D दृश्य में भी उपलब्ध है।"
          : "Drag to orbit; right-drag to pan; Ctrl + scroll to zoom. On touch, enable touch controls to orbit and pinch, then return to page scrolling. Buildings and amenities are illustrative forms."}
      </p>
    </section>
  );
}
