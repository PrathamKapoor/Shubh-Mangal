import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  approvedBlocks,
  blockLabels,
  dimensionLabels,
  plotLabels,
} from "../../shared/domain.mjs";
import {
  presentationFitsSource,
  presentationPlot,
} from "../../shared/presentation.mjs";
import {
  amenityClipBridges,
  areaRing,
  referenceFor,
  sharedAmenityPosition,
} from "../../shared/owner-amenity-references.mjs";
import AmenityArtwork from "./AmenityArtwork";
import AmenityFigure from "./AmenityFigure";
import LeisureFacility from "./LeisureFacility";
const Colony3D = lazy(() => import("./Colony3D"));
const GoogleMapView = lazy(() => import("./GoogleMapView"));
class ThreeLoadBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="three-fallback" role="alert">
        <p>
          {this.props.hindi
            ? this.props.message
              ? "गूगल दृश्य लोड नहीं हो सका। स्थानीय प्लान खोलें।"
              : "3D लोड नहीं हो सका।"
            : this.props.message || "The 3D view could not load."}
        </p>
        <button type="button" onClick={this.props.onExit}>
          {this.props.hindi ? "2D नक्शा" : "Back to 2D map"}
        </button>
      </div>
    );
  }
}
import {
  foregroundImage,
  foregroundReference,
  preferredAmenityImage,
} from "../services/amenities";
// Decorative points are in the existing local map coordinates and are clipped
// to each area. They are presentation, not a surveyed planting plan.
const cornerPlanting = [
  [
    "ne",
    [
      [193.2, 124.6],
      [192.2, 128.6],
      [194.2, 131.6],
    ],
  ],
  [
    "se",
    [
      [195.4, 148],
      [192.4, 159],
    ],
  ],
  [
    "sw",
    [
      [136.3, 152.4],
      [136.3, 156.4],
      [153.3, 162.4],
    ],
  ],
  [
    "nw",
    [
      [141, 127.8],
      [134, 128.8],
      [134, 132.8],
      [136, 139.8],
    ],
  ],
];
function perimeterSamples(path, spacing = 18) {
  const points = areaRing(path || "");
  const result = [];
  let remaining = spacing / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!length) continue;
    let travelled = remaining;
    while (travelled < length) {
      const fraction = travelled / length;
      result.push([
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
      ]);
      travelled += spacing;
    }
    remaining = travelled - length;
  }
  return result;
}
function mapImageFor(amenity, reference, failedImages) {
  if (!reference || !amenity.imageUrl) return null;
  const preferred = preferredAmenityImage(amenity);
  if (!failedImages.has(preferred)) return preferred;
  return !failedImages.has(amenity.imageUrl) ? amenity.imageUrl : null;
}
export default function MapCanvas({
  data,
  plots: sourcePlots,
  selected,
  onSelect,
  units = "ft",
  focusRequest = 0,
  visibleIds,
  selectedBlock,
  onBlockSelect,
  mapMode,
  setMapMode,
  amenities = [],
  presentationPlacements = [],
  amenityId,
  onAmenitySelect,
  onAmenityClose,
  language = "en",
  stale = false,
}) {
  const hi = language === "hi";
  const svg = useRef(),
    panel = useRef(),
    previousFocus = useRef(),
    pointers = useRef(new Map()),
    gesture = useRef(null),
    animation = useRef(null),
    previousRoute = useRef({ block: "", selected: null }),
    viewRef = useRef(data.viewBox);
  const [view, setView] = useState(data.viewBox),
    [labels, setLabels] = useState(true),
    [dimensions, setDimensions] = useState(true),
    [boundary, setBoundary] = useState(true),
    [showAmenities, setShowAmenities] = useState(true),
    [failedImages, setFailedImages] = useState(() => new Set()),
    [size, setSize] = useState([600, 600]),
    [expanded, setExpanded] = useState(false),
    [activeAmenity, setActiveAmenity] = useState(null),
    [planImageStatus, setPlanImageStatus] = useState("loading");
  const plots = useMemo(() => {
    if (mapMode !== "colony" && mapMode !== "3d") return sourcePlots;
    const placements = new Map(
      presentationPlacements.map((item) => [item.plotId, item]),
    );
    return sourcePlots.map((item) => {
      const reviewed = placements.get(item.id);
      if (reviewed && reviewed.geometryId === item.geometryId)
        return presentationPlot(item, reviewed);
      // A small visual inset creates room for landscape between parcels. Its
      // mapping remains the original record, and all measurements stay sourced.
      const inset = {
        plotId: item.id,
        geometryId: item.geometryId,
        dx: 0,
        dy: 0,
        scale: 0.94,
        rotation: 0,
      };
      return presentationFitsSource(item, inset)
        ? presentationPlot(item, inset)
        : item;
    });
  }, [sourcePlots, presentationPlacements, mapMode]);
  const plot = plots.find((p) => p.id === selected);
  const blocks = useMemo(() => approvedBlocks(plots), [plots]);
  const plotMaskPath = useMemo(
    () => plots.map((item) => item.path).join(" "),
    [plots],
  );
  const sitePath = data.areas.find((area) => area.id === "area-0")?.path;
  const perimeterPlants = useMemo(() => perimeterSamples(sitePath), [sitePath]);
  const entranceEdge = useMemo(() => {
    const approach = data.areas.find((area) => area.id === "area-31");
    const bottom = areaRing(approach?.path || "")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    return bottom.length === 2
      ? `M${bottom[0].join(",")} L${bottom[1].join(",")}`
      : "";
  }, [data]);
  const approachExtension = useMemo(() => {
    const ring = areaRing(
      data.areas.find((area) => area.id === "area-31")?.path || "",
    );
    if (
      ring.length > 1 &&
      ring[0][0] === ring.at(-1)[0] &&
      ring[0][1] === ring.at(-1)[1]
    )
      ring.pop();
    if (ring.length !== 4) return "";
    const sorted = [...ring].sort((a, b) => a[1] - b[1]);
    const top = sorted.slice(0, 2),
      bottom = sorted.slice(2).sort((a, b) => a[0] - b[0]);
    const dx = (bottom[0][0] + bottom[1][0] - top[0][0] - top[1][0]) / 2;
    const dy = (bottom[0][1] + bottom[1][1] - top[0][1] - top[1][1]) / 2;
    const length = Math.hypot(dx, dy);
    if (!length) return "";
    const start = bottom.map(([x, y]) => [x - dx / length, y - dy / length]);
    const extension = bottom.map(([x, y]) => [
      x + (25 * dx) / length,
      y + (25 * dy) / length,
    ]);
    return `M${start[0].join(",")} L${start[1].join(",")} L${extension[1].join(",")} L${extension[0].join(",")} Z`;
  }, [data]);
  const mappedAmenities = useMemo(
    () =>
      amenities.flatMap((a) => {
        if (!a.mapPoint || a.customerVisible === false) return [];
        return [{ ...a, ...a.mapPoint }];
      }),
    [amenities],
  );
  const amenity = mappedAmenities.find((a) => a.id === activeAmenity);
  const sharedVisual = mappedAmenities.find(
    (a) => a.id === "owner-ref-temple-garden-visual",
  );
  const temple = mappedAmenities.find((a) => a.id === "owner-ref-temple");
  const garden = mappedAmenities.find((a) => a.id === "owner-ref-garden");
  // Do not replace an owner's customised image or a surveyed individual
  // position. A shared layer is shown only when all three records are visible.
  const sharedEnabled = Boolean(
    sharedVisual &&
    temple &&
    garden &&
    temple.imageUrl === "/assets/concepts/temple.png" &&
    garden.imageUrl === "/assets/concepts/garden.png" &&
    temple.placementPrecision !== "surveyed" &&
    garden.placementPrecision !== "surveyed" &&
    mapImageFor(sharedVisual, referenceFor(sharedVisual.id), failedImages),
  );
  const foregroundEnabled = Boolean(
    sharedEnabled &&
    sharedVisual.imageUrl === "/assets/concepts/garden-temple.png" &&
    foregroundImage(referenceFor(temple.id), failedImages) &&
    foregroundImage(referenceFor(garden.id), failedImages),
  );
  const shownAmenities = mappedAmenities.filter(
    (a) =>
      !referenceFor(a.id)?.internalVisual &&
      !["owner-ref-pool", "owner-ref-gym"].includes(a.id) &&
      !(
        sharedEnabled && ["owner-ref-temple", "owner-ref-garden"].includes(a.id)
      ),
  );
  const sharedLandscape = mappedAmenities.find((item) =>
    ["owner-ref-temple", "owner-ref-garden"].includes(item.id),
  );
  const landscapedAreas = new Set(
    mappedAmenities.flatMap((item) => {
      const reference = referenceFor(item.id);
      return reference &&
        !reference.internalVisual &&
        reference.category !== "entrance"
        ? reference.areaIds
        : [];
    }),
  );
  const scale = Math.min(size[0] / view[2], size[1] / view[3]);
  function sharedPosition(item) {
    return sharedAmenityPosition(
      item,
      sharedVisual,
      referenceFor(sharedVisual.id).mapPoint,
    );
  }
  const threeAmenities = mappedAmenities.map((item) => {
    if (
      !sharedEnabled ||
      !["owner-ref-temple", "owner-ref-garden"].includes(item.id)
    )
      return item;
    let position;
    if (foregroundEnabled) {
      position = sharedPosition(item);
    } else {
      const distance =
        (item.id === "owner-ref-temple" ? -0.23 : 0.27) *
        referenceFor(sharedVisual.id).mapSize[1] *
        (sharedVisual.visualScale || 1);
      const angle = ((sharedVisual.visualRotation || 0) * Math.PI) / 180;
      position = {
        x: sharedVisual.x - Math.sin(angle) * distance,
        y: sharedVisual.y + Math.cos(angle) * distance,
        rotation:
          (sharedVisual.visualRotation || 0) + (item.visualRotation || 0),
        scale: (sharedVisual.visualScale || 1) * (item.visualScale || 1),
      };
    }
    return {
      ...item,
      mapPoint: { x: position.x, y: position.y },
      visualRotation: position.rotation,
      visualScale: position.scale,
    };
  });
  function update(v) {
    if (animation.current) cancelAnimationFrame(animation.current);
    animation.current = null;
    viewRef.current = v;
    // Move the SVG camera immediately during a gesture. Recomputing hundreds
    // of labels and masks on every pointer event makes low-end touch devices
    // stutter; React catches up when the gesture finishes.
    if (gesture.current?.moved) {
      svg.current?.setAttribute("viewBox", v.join(" "));
      return;
    }
    setView(v);
  }
  function zoom(factor, point) {
    const v = viewRef.current,
      w = Math.min(data.viewBox[2] * 3, Math.max(15, v[2] * factor)),
      ratio = w / v[2],
      x = point?.x ?? v[0] + v[2] / 2,
      y = point?.y ?? v[1] + v[3] / 2;
    update([x - (x - v[0]) * ratio, y - (y - v[1]) * ratio, w, v[3] * ratio]);
  }
  function coord(e) {
    const point = svg.current.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    return point.matrixTransform(svg.current.getScreenCTM().inverse());
  }
  function fit(bounds) {
    if (!bounds) return;
    const [x, y, x2, y2] = bounds,
      w = Math.max(x2 - x, 18),
      h = Math.max(y2 - y, 18);
    const target = [x - w * 0.7, y - h * 0.7, w * 2.4, h * 2.4];
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      return update(target);
    if (animation.current) cancelAnimationFrame(animation.current);
    const start = [...viewRef.current],
      began = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - began) / 240),
        ease = 1 - (1 - progress) ** 3;
      const next = start.map((value, i) => value + (target[i] - value) * ease);
      viewRef.current = next;
      setView(next);
      animation.current = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    animation.current = requestAnimationFrame(frame);
  }
  function focus(p) {
    if (p) fit(p.bounds);
  }
  function openAmenity(id) {
    const target = mappedAmenities.find((item) => item.id === id);
    if (!target) return;
    setActiveAmenity(id);
    focusAmenity(target);
    onAmenitySelect?.(id);
  }
  function focusAmenity(target) {
    let { x, y } = target;
    if (["owner-ref-pool", "owner-ref-gym"].includes(target.id)) {
      fit([x - 15, y - 15, x + 15, y + 15]);
      return;
    }
    if (target.id === "owner-ref-clubhouse") {
      const points = areaRing(
        data.areas.find((area) => area.id === "area-3")?.path || "",
      );
      if (points.length)
        y =
          (Math.min(...points.map((p) => p[1])) +
            Math.max(...points.map((p) => p[1]))) /
          2;
    }
    if (
      foregroundEnabled &&
      ["owner-ref-temple", "owner-ref-garden"].includes(target.id)
    ) {
      ({ x, y } = sharedPosition(target));
    } else if (
      sharedEnabled &&
      ["owner-ref-temple", "owner-ref-garden"].includes(target.id)
    ) {
      const distance =
        (target.id === "owner-ref-temple" ? -0.23 : 0.27) *
        referenceFor(sharedVisual.id).mapSize[1] *
        (sharedVisual.visualScale || 1);
      const angle = ((sharedVisual.visualRotation || 0) * Math.PI) / 180;
      x = sharedVisual.x - Math.sin(angle) * distance;
      y = sharedVisual.y + Math.cos(angle) * distance;
    }
    fit([x - 20, y - 20, x + 20, y + 20]);
  }
  useEffect(() => {
    if (plot) focus(plot);
  }, [focusRequest, selected, Boolean(plot)]); // Restore a direct link after inventory loads.
  useEffect(() => {
    if (plot && window.matchMedia("(max-width: 700px)").matches)
      requestAnimationFrame(() =>
        panel.current?.scrollIntoView({ block: "start", behavior: "auto" }),
      );
  }, [selected, Boolean(plot)]);
  useEffect(() => {
    if (selected) {
      previousRoute.current.selected = selected;
      return;
    }
    const cameFromPlot = Boolean(previousRoute.current.selected);
    previousRoute.current.selected = null;
    const block = blocks.find((b) => b.name === selectedBlock);
    if (
      block &&
      (previousRoute.current.block !== selectedBlock || cameFromPlot)
    ) {
      fit(block.bounds);
      previousRoute.current.block = selectedBlock;
    } else if (
      !selectedBlock &&
      !amenityId &&
      (previousRoute.current.block || cameFromPlot)
    ) {
      update(data.viewBox);
      previousRoute.current.block = "";
    }
  }, [selectedBlock, selected, blocks, amenityId]);
  useEffect(() => {
    const a = mappedAmenities.find((item) => item.id === amenityId);
    if (a) {
      setActiveAmenity(a.id);
      focusAmenity(a);
      if (window.matchMedia("(max-width: 700px)").matches)
        requestAnimationFrame(() =>
          panel.current?.scrollIntoView({ block: "start", behavior: "auto" }),
        );
    } else {
      setActiveAmenity(null);
    }
  }, [amenityId, mappedAmenities, sharedEnabled, foregroundEnabled]);
  useEffect(() => {
    if (selected) setActiveAmenity(null);
  }, [selected]);
  useEffect(() => {
    const observer = new ResizeObserver(([e]) =>
      setSize([e.contentRect.width, e.contentRect.height]),
    );
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!showAmenities) return;
    // Some browsers do not dispatch a usable error event for SVG <image>.
    // Probe the same cacheable URLs with HTML images so the fallback is reliable.
    const urls = [
      ...shownAmenities,
      ...(sharedEnabled ? [sharedVisual] : []),
    ].map((amenity) =>
      mapImageFor(amenity, referenceFor(amenity.id), failedImages),
    );
    if (foregroundEnabled) {
      urls.push(foregroundImage(referenceFor(temple.id), failedImages));
      urls.push(foregroundImage(referenceFor(garden.id), failedImages));
    }
    const club = shownAmenities.find(
      (item) => item.id === "owner-ref-clubhouse",
    );
    const clubReference = club && referenceFor(club.id);
    if (
      clubReference &&
      club.imageUrl === `/assets/concepts/${clubReference.image}`
    )
      urls.push(foregroundImage(clubReference, failedImages));
    const probes = [...new Set(urls.filter(Boolean))].map((url) => {
      const probe = new Image();
      probe.onerror = () =>
        setFailedImages((previous) =>
          previous.has(url) ? previous : new Set([...previous, url]),
        );
      probe.src = url;
      return probe;
    });
    return () =>
      probes.forEach((probe) => {
        probe.onerror = null;
      });
  }, [
    mappedAmenities,
    showAmenities,
    failedImages,
    sharedEnabled,
    foregroundEnabled,
  ]);
  useEffect(() => {
    const el = svg.current;
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, coord(e));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    previousFocus.current = document.activeElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    svg.current?.focus();
    return () => {
      document.body.style.overflow = old;
      previousFocus.current?.focus();
    };
  }, [expanded]);
  useEffect(() => {
    function esc(e) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  function down(e) {
    if (e.button !== 0) return;
    if (animation.current) cancelAnimationFrame(animation.current);
    animation.current = null;
    svg.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      box: [...viewRef.current],
      id:
        e.target.closest("[data-plot], [data-plot-hit]")?.dataset.plot ||
        e.target.closest("[data-plot-hit]")?.dataset.plotHit,
      block: e.target.closest("[data-block]")?.dataset.block,
      amenity: e.target.closest("[data-amenity]")?.dataset.amenity,
      moved: false,
      scale: svg.current.getScreenCTM().a,
    };
    if (pointers.current.size === 2)
      gesture.current = {
        ...gesture.current,
        moved: true,
        distance: distance(),
      };
  }
  useEffect(
    () => () => {
      if (animation.current) cancelAnimationFrame(animation.current);
    },
    [],
  );
  function distance() {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function move(e) {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const d = distance();
      if (g.distance) zoom(g.distance / d);
      g.distance = d;
      g.moved = true;
      return;
    }
    if (g.distance) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) < 5 && !g.moved) return;
    g.moved = true;
    update([
      g.box[0] - dx / g.scale,
      g.box[1] - dy / g.scale,
      g.box[2],
      g.box[3],
    ]);
  }
  function up(e, cancel = false) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (svg.current.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
    if (!cancel && g && !g.moved) {
      if (g.id) onSelect(g.id);
      else if (g.block) onBlockSelect(g.block);
      else if (g.amenity) openAmenity(g.amenity);
    }
    if (!pointers.current.size) {
      if (g?.moved) setView([...viewRef.current]);
      gesture.current = null;
    }
  }
  function key(e) {
    const v = viewRef.current;
    const moves = {
      ArrowLeft: [-0.1, 0],
      ArrowRight: [0.1, 0],
      ArrowUp: [0, -0.1],
      ArrowDown: [0, 0.1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [x, y] = moves[e.key];
      update([v[0] + v[2] * x, v[1] + v[3] * y, v[2], v[3]]);
    }
    if (["+", "=", "-", "Home"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "Home") update(data.viewBox);
      else zoom(e.key === "-" ? 1.3 : 1 / 1.3);
    }
  }
  const tick =
    [1, 2, 5, 10, 20, 50, 100, 200].filter((n) => n * scale < 110).at(-1) || 1;
  const overlays =
    plot && dimensions ? dimensionLabels(plot, scale, units) : [];
  const overviewBlocks =
    blocks.length > 0 && !selectedBlock && view[2] > data.viewBox[2] * 0.6;
  const visibleLabels = plotLabels(
    plots,
    selected,
    view,
    scale,
    labels && !overviewBlocks,
    size,
  );
  const visibleBlocks = blockLabels(blocks, view, scale, size);
  const overviewAmenities = [];
  if (
    mapMode === "colony" &&
    showAmenities &&
    view[2] > data.viewBox[2] * 0.6
  ) {
    const candidates = [
      ["owner-ref-fountain", hi ? "फव्वारा" : "Fountain"],
      ["owner-ref-clubhouse", hi ? "क्लब हाउस" : "Clubhouse"],
      ["owner-ref-entry-gate", hi ? "प्रवेश" : "Entrance"],
      [
        temple ? "owner-ref-temple" : "owner-ref-garden",
        temple && garden
          ? hi
            ? "मंदिर और उद्यान"
            : "Temple & garden"
          : temple
            ? hi
              ? "मंदिर"
              : "Temple"
            : hi
              ? "उद्यान"
              : "Garden",
      ],
    ];
    const offsetX = (size[0] - view[2] * scale) / 2;
    const offsetY = (size[1] - view[3] * scale) / 2;
    const boxes = [
      ...visibleLabels.map((p) => ({
        x: offsetX + (p.x - view[0]) * scale,
        y: offsetY + (p.y - view[1]) * scale,
        w: Math.max(24, String(p.label).length * 8),
        h: 18,
      })),
      ...visibleBlocks.map((b) => ({
        x: offsetX + (b.x - view[0]) * scale,
        y: offsetY + (b.y - view[1]) * scale,
        w: `Block ${b.name}`.length * 8,
        h: 20,
      })),
    ];
    for (const [id, text] of candidates) {
      const item = mappedAmenities.find((a) => a.id === id);
      if (!item) continue;
      const point =
        foregroundEnabled &&
        ["owner-ref-temple", "owner-ref-garden"].includes(id)
          ? sharedPosition(item)
          : item;
      const y = point.y - 15 / scale;
      const xScreen = offsetX + (point.x - view[0]) * scale;
      const yScreen = offsetY + (y - view[1]) * scale;
      const box = {
        x: xScreen,
        y: yScreen,
        w: Math.max(34, [...text].length * 7),
        h: 18,
      };
      if (
        xScreen - box.w / 2 < 4 ||
        xScreen + box.w / 2 > size[0] - 4 ||
        yScreen - 9 < 4 ||
        yScreen + 9 > size[1] - 4
      )
        continue;
      if (
        (xScreen > size[0] - 65 && yScreen < 275) ||
        (xScreen < 65 && yScreen < 100)
      )
        continue;
      if (
        boxes.some(
          (other) =>
            Math.abs(other.x - box.x) < (other.w + box.w) / 2 + 3 &&
            Math.abs(other.y - box.y) < (other.h + box.h) / 2 + 3,
        )
      )
        continue;
      boxes.push(box);
      overviewAmenities.push({ id, text, x: point.x, y });
    }
  }
  return (
    <section
      ref={panel}
      className={`map-panel view-${mapMode} ${expanded ? "expanded" : ""}`}
      aria-label={hi ? "कॉलोनी का नक्शा" : "Interactive colony layout"}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      onKeyDown={(e) => {
        if (!expanded || e.key !== "Tab") return;
        const nodes = [
          ...panel.current.querySelectorAll(
            "button:not(:disabled),input:not(:disabled),[tabindex='0']:not([aria-hidden='true'])",
          ),
        ].filter((node) => node.getClientRects().length > 0);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="map-bar">
        <span>
          <b>
            {mapMode === "original"
              ? hi
                ? "मूल योजना"
                : "Original plan"
              : mapMode === "plan"
                ? hi
                  ? "कॉलोनी योजना"
                  : "Colony plan"
                : hi
                  ? "कॉलोनी दृश्य"
                  : "Colony view"}
          </b>
          <small>
            {mapMode === "original"
              ? hi
                ? "दी गई योजना · कोई नक्शा ओवरले नहीं"
                : "Supplied plan · no map overlay"
              : mapMode === "3d"
                ? hi
                  ? "घुमाने योग्य सांकेतिक 3D दृश्य"
                  : "Rotatable illustrative 3D view"
                : hi
                  ? "उत्तर ऊपर · नक्शे पर आधारित"
                  : "North up · map-derived drawing"}
          </small>
        </span>
        {mapMode !== "original" && mapMode !== "google" && (
          <div className="map-options">
            <label>
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => setLabels(e.target.checked)}
              />{" "}
              {hi ? "नंबर" : "Numbers"}
            </label>
            {mapMode !== "3d" && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={dimensions}
                    onChange={(e) => setDimensions(e.target.checked)}
                  />{" "}
                  {hi ? "माप" : "Dimensions"}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={boundary}
                    onChange={(e) => setBoundary(e.target.checked)}
                  />{" "}
                  {hi ? "सीमा" : "Boundary"}
                </label>
              </>
            )}
            {mappedAmenities.length > 0 && (
              <label>
                <input
                  type="checkbox"
                  checked={showAmenities}
                  onChange={(e) => setShowAmenities(e.target.checked)}
                />{" "}
                {hi ? "सुविधाएँ" : "Amenities"}
              </label>
            )}
          </div>
        )}
      </div>
      <div className="map-mode-bar">
        <div
          className="map-mode-toggle"
          role="group"
          aria-label={hi ? "नक्शे का दृश्य" : "Map appearance"}
        >
          <button
            aria-pressed={mapMode === "google"}
            onClick={() => setMapMode("google")}
          >
            {hi ? "गूगल नक्शा" : "Google Maps"}
          </button>
          <button
            aria-pressed={mapMode === "colony"}
            onClick={() => setMapMode("colony")}
          >
            {hi ? "सांकेतिक कॉलोनी" : "Illustrated colony"}
          </button>
          <button
            aria-pressed={mapMode === "3d"}
            onClick={() => setMapMode("3d")}
          >
            {hi ? "3D कॉलोनी" : "3D colony"}
          </button>
          <button
            aria-pressed={mapMode === "plan"}
            onClick={() => setMapMode("plan")}
          >
            {hi ? "2D योजना (मूल नक्शा)" : "2D plan (Source drawing)"}
          </button>
          <button
            aria-pressed={mapMode === "original"}
            onClick={() => setMapMode("original")}
          >
            {hi ? "मूल योजना" : "Original plan"}
          </button>
        </div>
        <span>
          {mapMode === "google"
            ? hi
              ? "भौगोलिक संदर्भ · स्रोत की पुष्टि आवश्यक"
              : "Geographic context · source alignment unverified"
            : mapMode === "original"
              ? hi
                ? "दस्तावेज़ अलग दिखाया गया है"
                : "Source document shown separately"
              : mapMode === "plan"
                ? hi
                  ? "प्लॉट पढ़ने की स्पष्ट योजना"
                  : "Clear plan for reading plots"
                : hi
                  ? "सांकेतिक नक्शा · मापानुसार नहीं"
                  : "Illustrative layout · not to scale"}
        </span>
      </div>
      <div className="map-area">
        <svg
          ref={svg}
          viewBox={view.join(" ")}
          role="img"
          tabIndex={
            mapMode === "original" || mapMode === "3d" || mapMode === "google"
              ? -1
              : 0
          }
          aria-hidden={
            mapMode === "original" ||
            mapMode === "3d" ||
            mapMode === "google" ||
            undefined
          }
          style={
            mapMode === "original" || mapMode === "3d" || mapMode === "google"
              ? { visibility: "hidden" }
              : undefined
          }
          aria-label={
            hi
              ? "कॉलोनी का नक्शा। तीर कुंजियों से खिसकाएँ, प्लस और माइनस से ज़ूम करें, होम से रीसेट करें। चयन के लिए प्लॉट सूची का उपयोग करें।"
              : "Colony drawing. Arrow keys pan, plus and minus zoom, Home resets. Use the plot results list for keyboard selection."
          }
          onKeyDown={key}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={(e) => up(e, true)}
        >
          <defs>
            <pattern
              id="review-hatch"
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
            >
              <rect width="4" height="4" fill="#e3dfd5" />
              <path d="M0 4L4 0" stroke="#aaa496" strokeWidth=".35" />
            </pattern>
            <pattern
              id="blocked-hatch"
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
            >
              <rect width="4" height="4" fill="#d4d6d3" />
              <path d="M0 4L4 0" stroke="#6b716e" strokeWidth=".6" />
            </pattern>
            <pattern
              id="illustrative-grass"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
            >
              <rect width="8" height="8" fill="#c2d7b3" />
              <path
                d="M1.1 5.7l.5-.8m4.1-2 .5-.8"
                stroke="#97b68a"
                strokeWidth=".22"
                opacity=".65"
              />
              <circle cx="4.2" cy="6.7" r=".14" fill="#a5c296" opacity=".6" />
            </pattern>
            <pattern
              id="amenity-ground"
              width="48"
              height="48"
              patternUnits="userSpaceOnUse"
            >
              <rect width="48" height="48" fill="#6f944e" />
              <image
                href="/assets/textures/plot-grass.webp"
                width="48"
                height="48"
                opacity=".35"
              />
            </pattern>
            {mapMode === "colony" && (
              <>
                <pattern
                  id="colony-surroundings"
                  width="92"
                  height="92"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="92" height="92" fill="#9fb884" />
                  <image
                    href="/assets/textures/plot-grass.webp"
                    width="92"
                    height="92"
                    opacity=".19"
                  />
                </pattern>
                <pattern
                  id="colony-site-ground"
                  width="68"
                  height="68"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="68" height="68" fill="#b3c79f" />
                  <image
                    href="/assets/textures/plot-grass.webp"
                    width="68"
                    height="68"
                    opacity=".13"
                  />
                </pattern>
                <mask
                  id="boundary-entry-opening"
                  maskUnits="userSpaceOnUse"
                  x={data.viewBox[0] - 20}
                  y={data.viewBox[1] - 20}
                  width={data.viewBox[2] + 40}
                  height={data.viewBox[3] + 40}
                >
                  <rect
                    x={data.viewBox[0] - 20}
                    y={data.viewBox[1] - 20}
                    width={data.viewBox[2] + 40}
                    height={data.viewBox[3] + 40}
                    fill="white"
                  />
                  <path
                    d={entranceEdge}
                    stroke="black"
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                </mask>
              </>
            )}
            <clipPath id="landscape-tree-clip" clipPathUnits="userSpaceOnUse">
              <circle r="1.05" />
            </clipPath>
            <g id="landscape-tree">
              <circle cx=".15" cy=".2" r="1.13" fill="#36593a" opacity=".25" />
              <circle r="1.05" fill="#668b4a" />
              <g clipPath="url(#landscape-tree-clip)">
                <svg
                  x="-1.05"
                  y="-1.05"
                  width="2.1"
                  height="2.1"
                  viewBox="230 200 260 260"
                >
                  <image
                    href="/assets/concepts/fountain-corner-map.webp"
                    width="1296"
                    height="1214"
                  />
                </svg>
              </g>
            </g>
            <g id="landscape-flowers">
              <circle cx=".1" cy=".14" r=".94" fill="#36593a" opacity=".22" />
              <circle r=".88" fill="#77944e" />
              <g clipPath="url(#landscape-tree-clip)">
                <svg
                  x="-.9"
                  y="-.9"
                  width="1.8"
                  height="1.8"
                  viewBox="245 600 190 190"
                >
                  <image
                    href="/assets/concepts/fountain-corner-map.webp"
                    width="1296"
                    height="1214"
                  />
                </svg>
              </g>
            </g>
            {mapMode === "colony" && (
              <>
                <pattern
                  id="surrounding-planting"
                  width="66"
                  height="66"
                  patternUnits="userSpaceOnUse"
                >
                  {[
                    [8, 10, 3.3],
                    [33, 5, 2.5],
                    [55, 16, 3.6],
                    [19, 33, 2.6],
                    [45, 37, 3],
                    [7, 58, 3.3],
                    [32, 59, 2.2],
                    [58, 57, 2.9],
                  ].map(([x, y, s], i) => (
                    <use
                      key={i}
                      href="#landscape-tree"
                      transform={`translate(${x} ${y}) scale(${s})`}
                    />
                  ))}
                </pattern>
                <mask
                  id="surrounding-planting-mask"
                  maskUnits="userSpaceOnUse"
                  x={data.viewBox[0] - data.viewBox[2] * 2}
                  y={data.viewBox[1] - data.viewBox[3] * 2}
                  width={data.viewBox[2] * 5}
                  height={data.viewBox[3] * 5}
                >
                  <rect
                    x={data.viewBox[0] - data.viewBox[2] * 2}
                    y={data.viewBox[1] - data.viewBox[3] * 2}
                    width={data.viewBox[2] * 5}
                    height={data.viewBox[3] * 5}
                    fill="white"
                  />
                  <path d={sitePath} fill="black" />
                  {approachExtension && (
                    <path
                      d={approachExtension}
                      fill="black"
                      stroke="black"
                      strokeWidth="3"
                    />
                  )}
                </mask>
              </>
            )}
            {mapMode === "colony" && (
              <pattern
                id="plot-hedge-texture"
                width="3.8"
                height="3.8"
                patternUnits="userSpaceOnUse"
              >
                <use
                  href="#landscape-tree"
                  transform="translate(1.9 1.9) scale(.72)"
                />
                <use
                  href="#landscape-flowers"
                  transform="translate(.35 3.35) scale(.3)"
                />
              </pattern>
            )}
            <mask
              id="amenity-ground-exclusion"
              maskUnits="userSpaceOnUse"
              x={data.viewBox[0]}
              y={data.viewBox[1]}
              width={data.viewBox[2]}
              height={data.viewBox[3]}
            >
              <rect
                x={data.viewBox[0]}
                y={data.viewBox[1]}
                width={data.viewBox[2]}
                height={data.viewBox[3]}
                fill="white"
              />
              {data.areas
                .filter((area) => area.kind === "road" || area.id === "area-31")
                .map((area) => (
                  <path
                    key={area.id}
                    d={area.path}
                    fill="black"
                    fillRule="evenodd"
                  />
                ))}
              <path d={plotMaskPath} fill="black" />
            </mask>
            {mapMode === "colony" && (
              <mask
                id="road-decoration-exclusion"
                maskUnits="userSpaceOnUse"
                x={data.viewBox[0]}
                y={data.viewBox[1]}
                width={data.viewBox[2]}
                height={data.viewBox[3]}
              >
                <rect
                  x={data.viewBox[0]}
                  y={data.viewBox[1]}
                  width={data.viewBox[2]}
                  height={data.viewBox[3]}
                  fill="white"
                />
                {data.areas
                  .filter(
                    (area) => area.kind === "road" || area.id === "area-31",
                  )
                  .map((area) => (
                    <path
                      key={area.id}
                      d={area.path}
                      fill="black"
                      fillRule="evenodd"
                    />
                  ))}
              </mask>
            )}
            {mapMode === "colony" && (
              <>
                {/* The road polygon is an even-odd compound path.  Keeping the
                    markings inside it also preserves its garden and block holes. */}
                <clipPath
                  id="illustrative-road-clip"
                  clipPathUnits="userSpaceOnUse"
                >
                  {data.areas
                    .filter(
                      (area) => area.kind === "road" || area.id === "area-31",
                    )
                    .map((area) => (
                      <path key={area.id} d={area.path} clipRule="evenodd" />
                    ))}
                  {approachExtension && <path d={approachExtension} />}
                </clipPath>
                <mask
                  id="illustrative-road-marking-exclusion"
                  maskUnits="userSpaceOnUse"
                  x={data.viewBox[0] - 40}
                  y={data.viewBox[1] - 40}
                  width={data.viewBox[2] + 80}
                  height={data.viewBox[3] + 80}
                >
                  <rect
                    x={data.viewBox[0] - 40}
                    y={data.viewBox[1] - 40}
                    width={data.viewBox[2] + 80}
                    height={data.viewBox[3] + 80}
                    fill="white"
                  />
                  <path d={plotMaskPath} fill="black" />
                  {data.areas
                    .filter(
                      (area) =>
                        area.kind === "amenity" && area.id !== "area-31",
                    )
                    .map((area) => (
                      <path
                        key={area.id}
                        d={area.path}
                        fill="black"
                        fillRule="evenodd"
                      />
                    ))}
                </mask>
              </>
            )}
            {mapMode === "colony" && (
              <>
                <filter
                  id="neutral-plot-texture"
                  colorInterpolationFilters="sRGB"
                >
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <pattern
                  id="plot-grass-texture"
                  width="36"
                  height="36"
                  patternUnits="userSpaceOnUse"
                >
                  <image
                    href="/assets/textures/plot-grass.webp"
                    width="36"
                    height="36"
                  />
                </pattern>
                <pattern
                  id="plot-neutral-texture"
                  width="36"
                  height="36"
                  patternUnits="userSpaceOnUse"
                >
                  <image
                    href="/assets/textures/plot-grass.webp"
                    width="36"
                    height="36"
                    filter="url(#neutral-plot-texture)"
                  />
                </pattern>
                <pattern
                  id="road-surface-texture"
                  width="20"
                  height="20"
                  patternUnits="userSpaceOnUse"
                >
                  {/* Crop an unmarked asphalt patch in SVG: the supplied painted
                      lines never enter the map or change the road geometry. */}
                  <svg
                    width="20"
                    height="20"
                    viewBox="150 150 240 240"
                    overflow="hidden"
                  >
                    <image
                      href="/assets/textures/road-texture.webp"
                      width="1024"
                      height="1536"
                    />
                  </svg>
                </pattern>
                {["available", "neutral"].map((kind) => (
                  <mask
                    key={kind}
                    id={`plot-texture-mask-${kind}`}
                    maskUnits="userSpaceOnUse"
                    x={data.viewBox[0]}
                    y={data.viewBox[1]}
                    width={data.viewBox[2]}
                    height={data.viewBox[3]}
                  >
                    {plots
                      .filter(
                        (p) =>
                          (p.status === "available") === (kind === "available"),
                      )
                      .map((p) => (
                        <path
                          key={p.id}
                          d={p.path}
                          fill="white"
                          opacity={
                            visibleIds &&
                            !visibleIds.has(p.id) &&
                            p.id !== selected
                              ? 0.23
                              : 1
                          }
                        />
                      ))}
                  </mask>
                ))}
              </>
            )}
            {mappedAmenities.map((a) => {
              const reference = referenceFor(a.id);
              if (!reference) return null;
              return (
                <clipPath
                  key={a.id}
                  id={`amenity-clip-${a.id}`}
                  clipPathUnits="userSpaceOnUse"
                >
                  {reference.areaIds.map((id) => {
                    const area = data.areas.find((item) => item.id === id);
                    return area ? (
                      <path key={id} d={area.path} fillRule="evenodd" />
                    ) : null;
                  })}
                  {amenityClipBridges(data, reference).map((path, i) => (
                    <path key={`bridge-${i}`} data-amenity-bridge d={path} />
                  ))}
                </clipPath>
              );
            })}
          </defs>
          {mapMode === "colony" && (
            <rect
              data-illustrative-surroundings
              aria-hidden="true"
              pointerEvents="none"
              x={data.viewBox[0] - data.viewBox[2] * 2}
              y={data.viewBox[1] - data.viewBox[3] * 2}
              width={data.viewBox[2] * 5}
              height={data.viewBox[3] * 5}
              fill="url(#colony-surroundings)"
            />
          )}
          {mapMode === "colony" && (
            <rect
              data-illustrative-surrounding-planting
              aria-hidden="true"
              pointerEvents="none"
              x={data.viewBox[0] - data.viewBox[2] * 2}
              y={data.viewBox[1] - data.viewBox[3] * 2}
              width={data.viewBox[2] * 5}
              height={data.viewBox[3] * 5}
              fill="url(#surrounding-planting)"
              mask="url(#surrounding-planting-mask)"
              opacity=".8"
            />
          )}
          {data.areas
            .filter((a) => boundary || a.kind !== "site")
            .map((a) => (
              <path
                key={a.id}
                data-area={a.id}
                d={a.path}
                className={`area ${a.kind} ${a.id === "area-31" ? "approach-reference" : ""} ${["area-2", "area-3", "area-30", "area-40"].includes(a.id) ? "concept-landscape" : ""}`}
                fillRule="evenodd"
              />
            ))}
          {mapMode === "colony" &&
            data.areas
              .filter((a) => a.kind === "road" || a.id === "area-31")
              .map((a) => (
                <path
                  key={`surface-${a.id}`}
                  data-road-texture={a.id}
                  d={a.path}
                  fill="url(#road-surface-texture)"
                  fillRule="evenodd"
                  opacity={a.id === "area-31" ? 0.18 : 0.24}
                  pointerEvents="none"
                />
              ))}
          {mapMode === "colony" && approachExtension && (
            <g
              data-illustrative-approach
              aria-hidden="true"
              pointerEvents="none"
            >
              <path d={approachExtension} fill="#818a83" />
              <path
                d={approachExtension}
                fill="url(#road-surface-texture)"
                opacity=".18"
              />
            </g>
          )}
          {mapMode === "colony" && (
            <g
              data-illustrative-road-details
              aria-hidden="true"
              pointerEvents="none"
              clipPath="url(#illustrative-road-clip)"
              mask="url(#illustrative-road-marking-exclusion)"
            >
              {/* A slim inside-edge kerb defines the street without altering the
                  underlying road or plot paths. */}
              {data.areas
                .filter((area) => area.kind === "road")
                .map((area) => (
                  <path
                    key={area.id}
                    d={area.path}
                    fill="none"
                    stroke="#d6cfb5"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                    opacity=".85"
                  />
                ))}
              {/* Short hand-drawn centre guides follow straight road sections;
                  deliberate gaps keep junctions clear. They are illustrative. */}
              <g
                fill="none"
                stroke="#eee9d8"
                strokeWidth=".32"
                strokeDasharray="2.5 3.3"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity=".7"
              >
                <path d="M116.8 20 L125.8 113 M153.8 20 L163.8 112 M190.5 21 L199.1 110 M225.1 23 L234.8 120" />
                <path d="M132 177 L139.5 244 M169.7 181 L176.9 245 M203.5 178 L211 243 M237.9 165 L245.7 239" />
                <path d="M142.8 288 L148.5 341 M178.9 284 L184.4 340 M213.5 282 L219.2 337 M108.9 390 L107.4 445 M107 457 L106.2 480" />
                <circle cx="167.25" cy="143.3" r="16.4" />
              </g>
            </g>
          )}
          {mapMode === "colony" && boundary && sitePath && (
            <g
              mask="url(#boundary-entry-opening)"
              aria-hidden="true"
              pointerEvents="none"
            >
              <g mask="url(#amenity-ground-exclusion)">
                <path
                  data-perimeter-planting
                  d={sitePath}
                  fill="none"
                  stroke="#476d3a"
                  strokeWidth="1.4"
                  strokeDasharray=".2 3.8"
                  strokeLinecap="round"
                  opacity=".7"
                />
                <path
                  d={sitePath}
                  fill="none"
                  stroke="#78974f"
                  strokeWidth=".8"
                  strokeDasharray=".2 3.8"
                  strokeDashoffset="1.9"
                  strokeLinecap="round"
                  opacity=".7"
                />
                {perimeterPlants.map(([x, y], index) => (
                  <use
                    key={index}
                    href="#landscape-tree"
                    transform={`translate(${x} ${y}) rotate(${index * 137.5}) scale(${index % 3 === 0 ? 1.35 : 1.05})`}
                  />
                ))}
              </g>
            </g>
          )}
          {showAmenities &&
            data.areas
              .filter((area) => landscapedAreas.has(area.id))
              .map((area) => (
                <path
                  key={`ground-${area.id}`}
                  data-amenity-ground={area.id}
                  d={area.path}
                  fill="url(#amenity-ground)"
                  fillRule="evenodd"
                  mask="url(#amenity-ground-exclusion)"
                  pointerEvents="none"
                  aria-hidden="true"
                />
              ))}
          {showAmenities && sharedLandscape && (
            <g
              className="illustrative-landscape"
              clipPath={`url(#amenity-clip-${sharedLandscape.id})`}
              mask="url(#amenity-ground-exclusion)"
              aria-hidden="true"
              pointerEvents="none"
            >
              {foregroundEnabled ? (
                (() => {
                  const shrine = sharedPosition(temple);
                  const play = sharedPosition(garden);
                  const forecourtY = shrine.y + 7 * shrine.scale;
                  return (
                    <>
                      <rect
                        x={shrine.x - 3.4 * shrine.scale}
                        y={forecourtY - 0.3}
                        width={6.8 * shrine.scale}
                        height={2.2 * shrine.scale}
                        rx=".6"
                        fill="#e4d8b8"
                        opacity=".8"
                      />
                      <path
                        d={`M 279 ${forecourtY + 2} Q ${shrine.x - 4} ${forecourtY + 2} ${shrine.x} ${forecourtY + 1} Q ${play.x + 5} ${forecourtY + 1} ${play.x + 4} ${play.y + 2}`}
                      />
                      <path
                        d={`M ${play.x + 4} ${play.y + 2} Q ${play.x + 3} ${play.y + 5} ${play.x} ${play.y + 6}`}
                      />
                    </>
                  );
                })()
              ) : (
                <path d="M297 128 C299 135 299.5 144 298 153 M297.5 138.5 C294.5 138.5 292 138.5 289.5 138 M298.5 148.5 L296 148.5" />
              )}
              {[
                [280.8, 131],
                [292.6, 126.8],
                [300.5, 135],
                [301.4, 143],
                [300.3, 151],
                [284, 153.5],
                [283.1, 144.5],
                [282, 139.8],
              ].map(([x, y], index) => (
                <use
                  key={index}
                  href="#landscape-tree"
                  transform={`translate(${x} ${y}) scale(1.1)`}
                />
              ))}
              {[
                [282.7, 128.7],
                [295, 130],
                [301, 139],
                [300.8, 148],
                [297.7, 154],
                [284, 149],
                [282.7, 136.8],
              ].map(([x, y], index) => (
                <use
                  key={index}
                  href="#landscape-flowers"
                  transform={`translate(${x} ${y}) scale(.85)`}
                />
              ))}
            </g>
          )}
          {showAmenities &&
            mappedAmenities.some(
              (item) => item.id === "owner-ref-clubhouse",
            ) && (
              <g
                className="illustrative-landscape"
                clipPath="url(#amenity-clip-owner-ref-clubhouse)"
                mask="url(#amenity-ground-exclusion)"
                aria-hidden="true"
                pointerEvents="none"
              >
                <path d="M51 205 C54 211 56 217 57.5 224 C59 231 60 237 61 244 C62 252 63 261 65 268 M57.5 219 L62 219 M61 241 L63 241 M63.5 259 L65 259" />
                {[
                  [72, 226],
                  [72, 236],
                  [73, 251],
                  [72, 267],
                ].map(([x, y], index) => (
                  <use
                    key={index}
                    href="#landscape-tree"
                    transform={`translate(${x} ${y}) scale(1.15)`}
                  />
                ))}
                {[
                  [59, 230],
                  [74, 242],
                  [63, 253],
                  [74, 261],
                ].map(([x, y], index) => (
                  <use
                    key={index}
                    href="#landscape-flowers"
                    transform={`translate(${x} ${y}) scale(.95)`}
                  />
                ))}
              </g>
            )}
          {showAmenities &&
            mappedAmenities
              .filter((item) =>
                ["owner-ref-pool", "owner-ref-gym"].includes(item.id),
              )
              .map((item) => (
                <g
                  key={item.id}
                  clipPath={`url(#amenity-clip-${item.id})`}
                  mask="url(#amenity-ground-exclusion)"
                >
                  <LeisureFacility
                    amenity={item}
                    active={activeAmenity === item.id}
                    hindi={hi}
                  />
                </g>
              ))}
          {showAmenities &&
            scale >= 1.8 &&
            mappedAmenities
              .filter((item) =>
                [
                  "owner-ref-clubhouse",
                  "owner-ref-pool",
                  "owner-ref-gym",
                ].includes(item.id),
              )
              .map((item) => (
                <text
                  key={`leisure-label-${item.id}`}
                  data-leisure-label={item.id}
                  x={item.x - 7}
                  y={item.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={12 / scale}
                  strokeWidth={3.5 / scale}
                  paintOrder="stroke"
                  fill="#183e31"
                  stroke="#fffdf1"
                  strokeLinejoin="round"
                  fontWeight="600"
                  pointerEvents="none"
                  aria-hidden="true"
                >
                  {hi && item.titleHi ? item.titleHi : item.title}
                </text>
              ))}
          {showAmenities &&
            cornerPlanting.map(([corner, points]) => {
              const id = `owner-ref-roundabout-garden-${corner}`;
              if (!mappedAmenities.some((item) => item.id === id)) return null;
              return (
                <g
                  key={id}
                  data-landscape-detail={id}
                  clipPath={`url(#amenity-clip-${id})`}
                  mask="url(#amenity-ground-exclusion)"
                  aria-hidden="true"
                  pointerEvents="none"
                >
                  {points.map(([x, y], index) => (
                    <use
                      key={index}
                      href="#landscape-tree"
                      transform={`translate(${x} ${y}) scale(.85)`}
                    />
                  ))}
                </g>
              );
            })}
          {showAmenities &&
            sharedEnabled &&
            (foregroundEnabled ? (
              <g
                data-shared-amenity-art="true"
                clipPath={`url(#amenity-clip-${sharedVisual.id})`}
                mask="url(#amenity-ground-exclusion)"
              >
                {[temple, garden].map((item) => {
                  const reference = referenceFor(item.id);
                  const foreground = foregroundReference(reference);
                  const position = sharedPosition(item);
                  return (
                    <g
                      key={item.id}
                      data-amenity={item.id}
                      className={`amenity-marker ${activeAmenity === item.id ? "active" : ""}`}
                    >
                      <title>
                        {hi && item.titleHi ? item.titleHi : item.title} ·
                        Approximate location
                      </title>
                      <g
                        transform={`translate(${position.x} ${position.y}) rotate(${position.rotation})`}
                      >
                        <AmenityArtwork
                          reference={foreground}
                          href={foregroundImage(reference, failedImages)}
                          originalUrl={`/assets/concepts/${foreground.image}`}
                          scale={position.scale}
                        />
                      </g>
                    </g>
                  );
                })}
              </g>
            ) : (
              <g
                data-amenity="owner-ref-temple"
                data-shared-amenity-art="true"
                className={`amenity-marker ${activeAmenity === temple.id || activeAmenity === garden.id ? "active" : ""}`}
                clipPath={`url(#amenity-clip-${sharedVisual.id})`}
                mask="url(#amenity-ground-exclusion)"
              >
                <title>Temple and play garden · Approximate locations</title>
                <g
                  transform={`translate(${sharedVisual.x} ${sharedVisual.y}) rotate(${sharedVisual.visualRotation || 0})`}
                >
                  <AmenityArtwork
                    reference={referenceFor(sharedVisual.id)}
                    href={mapImageFor(
                      sharedVisual,
                      referenceFor(sharedVisual.id),
                      failedImages,
                    )}
                    originalUrl={sharedVisual.imageUrl}
                    scale={sharedVisual.visualScale || 1}
                  />
                  <rect
                    data-amenity="owner-ref-garden"
                    fill="transparent"
                    pointerEvents="all"
                    x={
                      (-referenceFor(sharedVisual.id).mapSize[0] *
                        (sharedVisual.visualScale || 1)) /
                      2
                    }
                    y="0"
                    width={
                      referenceFor(sharedVisual.id).mapSize[0] *
                      (sharedVisual.visualScale || 1)
                    }
                    height={
                      (referenceFor(sharedVisual.id).mapSize[1] *
                        (sharedVisual.visualScale || 1)) /
                      2
                    }
                  />
                </g>
              </g>
            ))}
          {showAmenities &&
            shownAmenities.map((a) => {
              const reference = referenceFor(a.id);
              const foreground =
                a.id === "owner-ref-clubhouse" &&
                a.imageUrl === `/assets/concepts/${reference?.image}` &&
                foregroundImage(reference, failedImages);
              const imageUrl =
                foreground || mapImageFor(a, reference, failedImages);
              const artwork = foreground
                ? foregroundReference(reference)
                : reference;
              return (
                <g
                  key={a.id}
                  data-amenity={a.id}
                  className={`amenity-marker ${activeAmenity === a.id ? "active" : ""}`}
                  clipPath={
                    reference ? `url(#amenity-clip-${a.id})` : undefined
                  }
                  mask={
                    reference && reference.category !== "entrance"
                      ? "url(#amenity-ground-exclusion)"
                      : undefined
                  }
                >
                  <title>
                    {hi && a.titleHi ? a.titleHi : a.title} ·{" "}
                    {a.placementPrecision === "surveyed"
                      ? "Owner-reviewed location"
                      : "Approximate location"}
                  </title>
                  <g
                    transform={`translate(${a.x} ${a.y}) rotate(${a.visualRotation || 0})`}
                  >
                    {reference && imageUrl ? (
                      <AmenityArtwork
                        reference={artwork}
                        href={imageUrl}
                        originalUrl={
                          foreground
                            ? `/assets/concepts/${artwork.image}`
                            : a.imageUrl
                        }
                        scale={a.visualScale || 1}
                      />
                    ) : (
                      <>
                        <circle
                          r={(9 * (a.visualScale || 1)) / scale}
                          strokeWidth={2 / scale}
                        />
                        <text
                          x="0"
                          y="0"
                          fontSize={(12 * (a.visualScale || 1)) / scale}
                        >
                          {{
                            fountain: "◉",
                            temple: "✦",
                            garden: "✿",
                            clubhouse: "⌂",
                            entrance: "∩",
                          }[a.category] || "◆"}
                        </text>
                      </>
                    )}
                  </g>
                </g>
              );
            })}
          {mapMode === "colony" && (
            <path
              data-plot-landscaping
              d={plotMaskPath}
              fill="none"
              stroke="url(#plot-hedge-texture)"
              strokeWidth="1.8"
              strokeLinecap="round"
              opacity=".8"
              mask="url(#road-decoration-exclusion)"
              pointerEvents="none"
              aria-hidden="true"
            />
          )}
          {mapMode === "colony" && (
            <g
              data-plot-hit-layer
              fill="transparent"
              pointerEvents="all"
              aria-hidden="true"
            >
              {plots.map((p, index) => {
                const moved = presentationPlacements.some(
                  (item) =>
                    item.plotId === p.id && item.geometryId === p.geometryId,
                );
                return (
                  <path
                    key={p.id}
                    data-plot-hit={p.id}
                    d={moved ? p.path : sourcePlots[index].path}
                  />
                );
              })}
            </g>
          )}
          {plots.map((p) => (
            <path
              key={p.id}
              data-plot={p.id}
              d={p.path}
              className={`cell status-${p.status} ${p.identityReviewRequired ? "review" : ""} ${p.id === selected ? "selected" : ""} ${selectedBlock && p.approved && p.block === selectedBlock ? "block-active" : ""} ${visibleIds && !visibleIds.has(p.id) ? "filtered-out" : ""}`}
            >
              <title>
                {p.approved ? "Plot" : "Plan label"} {p.label} ·{" "}
                {p.approved ? "Block" : "Plan reference"} {p.block} · {p.status}
                {p.identityReviewRequired ? " · Number needs confirmation" : ""}
              </title>
            </path>
          ))}
          {mapMode === "colony" && (
            <g aria-hidden="true" pointerEvents="none" data-plot-texture-layer>
              <rect
                x={data.viewBox[0]}
                y={data.viewBox[1]}
                width={data.viewBox[2]}
                height={data.viewBox[3]}
                fill="url(#plot-neutral-texture)"
                mask="url(#plot-texture-mask-neutral)"
                opacity="0.14"
              />
              <rect
                x={data.viewBox[0]}
                y={data.viewBox[1]}
                width={data.viewBox[2]}
                height={data.viewBox[3]}
                fill="url(#plot-grass-texture)"
                mask="url(#plot-texture-mask-available)"
                opacity="0.16"
              />
              {plot && <path d={plot.path} className="selection-outline" />}
            </g>
          )}
          {boundary && (
            <path
              d={sitePath}
              className="site-outline"
              mask={
                mapMode === "colony"
                  ? "url(#boundary-entry-opening)"
                  : undefined
              }
              aria-hidden="true"
            />
          )}
          {visibleLabels.map((p) => (
            <text
              className="plot-label"
              key={p.id}
              x={p.x}
              y={p.y}
              fontSize={13 / scale}
              strokeWidth={3 / scale}
            >
              {p.label}
            </text>
          ))}
          {overviewAmenities.map((item) => (
            <text
              key={item.id}
              data-amenity-label={item.id}
              className="amenity-overview-label"
              x={item.x}
              y={item.y}
              fontSize={11 / scale}
              strokeWidth={3.5 / scale}
              aria-hidden="true"
            >
              {item.text}
            </text>
          ))}
          {!selectedBlock &&
            view[2] > data.viewBox[2] * 0.6 &&
            visibleBlocks.map((b) => (
              <text
                key={b.name}
                data-block={b.name}
                className="block-label"
                x={b.x}
                y={b.y}
                fontSize={14 / scale}
                strokeWidth={5 / scale}
              >
                Block {b.name}
              </text>
            ))}
          {overlays.map((d) => (
            <g className="dimension" key={d.edgeIndex}>
              <line
                x1={plot.edges[d.edgeIndex].a[0]}
                y1={plot.edges[d.edgeIndex].a[1]}
                x2={plot.edges[d.edgeIndex].b[0]}
                y2={plot.edges[d.edgeIndex].b[1]}
              />
              <text
                transform={`translate(${d.x} ${d.y}) rotate(${d.angle})`}
                fontSize={12 / scale}
                strokeWidth={4 / scale}
              >
                {d.label}
              </text>
            </g>
          ))}
        </svg>
        {mapMode === "google" ? (
          <div className="google-view-shell">
            <ThreeLoadBoundary
              hindi={hi}
              message="Google view could not load. Return to the local Plan."
              onExit={() => setMapMode("plan")}
            >
              <Suspense
                fallback={
                  <p role="status">
                    {hi ? "नक्शा खुल रहा है…" : "Opening geographic view…"}
                  </p>
                }
              >
                <GoogleMapView
                  data={data}
                  plots={sourcePlots}
                  selected={selected}
                  visibleIds={visibleIds}
                  onSelect={onSelect}
                  hindi={hi}
                  stale={stale}
                  onExit={() => setMapMode("plan")}
                />
              </Suspense>
            </ThreeLoadBoundary>
          </div>
        ) : mapMode === "3d" ? (
          <div className="three-view-shell">
            <ThreeLoadBoundary hindi={hi} onExit={() => setMapMode("colony")}>
              <Suspense
                fallback={
                  <div role="status" className="three-fallback">
                    {hi ? "3D नक्शा लोड हो रहा है…" : "Loading 3D view…"}
                  </div>
                }
              >
                <Colony3D
                  data={data}
                  plots={plots}
                  selected={selected}
                  selectedAmenity={activeAmenity}
                  amenities={threeAmenities}
                  showLabels={labels}
                  showAmenities={showAmenities}
                  visibleIds={visibleIds}
                  selectedBlock={selectedBlock}
                  focusRequest={focusRequest}
                  onSelect={onSelect}
                  onAmenitySelect={openAmenity}
                  onExit={() => setMapMode("colony")}
                  hindi={hi}
                />
              </Suspense>
            </ThreeLoadBoundary>
          </div>
        ) : mapMode === "original" ? (
          <div
            className="original-plan-view"
            role="region"
            tabIndex={0}
            aria-label={hi ? "मूल योजना दस्तावेज़" : "Original plan document"}
          >
            <div className="original-plan-caption">
              <p>
                {hi
                  ? "मूल दस्तावेज़; सभी माप और स्थितियों की पुष्टि आवश्यक है। चुना प्लॉट अन्य दृश्यों में बना रहेगा।"
                  : "Supplied document; measurements and availability need confirmation. Your selected plot stays selected in the map views."}
              </p>
              <a
                href="/downloads/survey-plan-north.pdf"
                target="_blank"
                rel="noreferrer"
              >
                {hi ? "मूल PDF खोलें ↗" : "Open original PDF ↗"}
              </a>
              {expanded && (
                <button type="button" onClick={() => setExpanded(false)}>
                  {hi ? "पूरा नक्शा बंद करें" : "Exit fullscreen map"}
                </button>
              )}
            </div>
            {planImageStatus === "loading" && (
              <p role="status">
                {hi ? "मूल योजना लोड हो रही है…" : "Loading original plan…"}
              </p>
            )}
            {planImageStatus === "error" && (
              <p role="alert">
                {hi
                  ? "चित्र लोड नहीं हुआ। ऊपर दिए PDF लिंक का उपयोग करें।"
                  : "The image could not load. Use the PDF link above."}
              </p>
            )}
            <img
              src="/assets/survey-plan-north.png"
              loading="lazy"
              decoding="async"
              onLoad={() => setPlanImageStatus("loaded")}
              onError={() => setPlanImageStatus("error")}
              alt={
                hi
                  ? "स्वामी द्वारा दी गई उत्तर दिशा वाली मूल योजना"
                  : "Owner-supplied north-oriented plan, shown without an interactive plot overlay"
              }
            />
          </div>
        ) : (
          <>
            <span
              className="north"
              aria-label={hi ? "उत्तर ऊपर है" : "North points up"}
            >
              N<span>↑</span>
            </span>
            <div className="map-controls">
              <button
                aria-label={hi ? "ज़ूम बढ़ाएँ" : "Zoom in"}
                onClick={() => zoom(1 / 1.4)}
              >
                +
              </button>
              <button
                aria-label={hi ? "ज़ूम घटाएँ" : "Zoom out"}
                onClick={() => zoom(1.4)}
              >
                −
              </button>
              <button
                aria-label={hi ? "पूरा नक्शा दिखाएँ" : "Reset view"}
                onClick={() => update(data.viewBox)}
              >
                ⌂
              </button>
              <button
                aria-label={hi ? "चुना प्लॉट दिखाएँ" : "Focus selected plot"}
                disabled={!plot}
                onClick={() => focus(plot)}
              >
                ⌖
              </button>
              <button
                aria-label={
                  expanded
                    ? hi
                      ? "पूरा नक्शा बंद करें"
                      : "Exit fullscreen map"
                    : hi
                      ? "पूरा नक्शा खोलें"
                      : "Fullscreen map"
                }
                aria-pressed={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                ⛶
              </button>
            </div>
            {mapMode === "plan" && (
              <div className="scale">
                <span style={{ width: tick * scale }} />
                {tick} m · {hi ? "नक्शे से अनुमानित" : "map-derived"}
              </div>
            )}
            <span className="map-hint">
              {hi
                ? "खींचें / पिंच करें · Ctrl + स्क्रॉल"
                : "Drag / pinch · Ctrl + scroll to zoom"}
            </span>
          </>
        )}
      </div>
      {amenity && (
        <div className="map-amenity-card" aria-live="polite">
          <AmenityFigure amenity={amenity} hindi={hi} compact />
          <div>
            <b>{hi && amenity.titleHi ? amenity.titleHi : amenity.title}</b>
            <span className="badge">
              {amenity.state === "confirmation_pending"
                ? hi
                  ? "पुष्टि बाकी"
                  : "Status unverified"
                : amenity.state === "planned"
                  ? hi
                    ? "प्रस्तावित"
                    : "Proposed"
                  : amenity.state.replaceAll("_", " ")}
            </span>
            {amenity.placementPrecision !== "surveyed" && (
              <p>
                <b>{hi ? "अनुमानित स्थान" : "Approximate location"}</b>
              </p>
            )}
            <p>
              {hi && amenity.descriptionHi
                ? amenity.descriptionHi
                : amenity.description}
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveAmenity(null);
                update(data.viewBox);
                onAmenityClose?.();
              }}
            >
              {hi ? "पूरा नक्शा देखें" : "Back to full map"}
            </button>
          </div>
          <button
            aria-label={hi ? "सुविधा विवरण बंद करें" : "Close amenity details"}
            onClick={() => {
              setActiveAmenity(null);
              onAmenityClose?.();
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className="legend">
        <span>
          <i /> {hi ? "पुष्टि बाकी" : "Unverified"}
        </span>
        <span>
          <i className="review-key" />{" "}
          {hi ? "जाँच आवश्यक" : "Needs confirmation"}
        </span>
        <span>
          <i className="gold" /> {hi ? "चयनित" : "Selected"}
        </span>
        <span>
          <i className="available" />{" "}
          {hi ? "उपलब्ध (पुष्टि हुई)" : "Verified available"}
        </span>
        <span>
          <i className="reserved" /> {hi ? "आरक्षित" : "Reserved"}
        </span>
        <span>
          <i className="sold" /> {hi ? "विक्रय हुआ" : "Sold"}
        </span>
        {plots.some((p) => p.status === "blocked") && (
          <span>
            <i className="blocked" /> {hi ? "अवरुद्ध" : "Blocked"}
          </span>
        )}
      </div>
      <p className="map-footnote">
        {mapMode === "original" ? (
          hi ? (
            "मूल दस्तावेज़ की जानकारी को सत्यापित करें।"
          ) : (
            "Verify the information in this original document."
          )
        ) : mapMode === "3d" ? (
          hi ? (
            "सांकेतिक 3D दृश्य मापानुसार नहीं है।"
          ) : (
            "The illustrative 3D scene is not to scale; dimensions remain in plot details."
          )
        ) : (
          <>
            {hi ? "नक्शा अनुमानित है। " : "Approximate drawing. "}
            {scale < 3
              ? hi
                ? "नंबर पढ़ने के लिए ज़ूम करें।"
                : "Zoom in to reveal readable plot numbers."
              : hi
                ? "सभी भुजाएँ प्लॉट विवरण में भी हैं।"
                : "All sides are also listed in plot details."}
            {mapMode === "colony" &&
              (hi
                ? " बाहरी रास्ता, सड़क व प्लॉट की सतह, हरियाली और सीमा सांकेतिक हैं; रंग स्थिति को अलग दिखाते हैं।"
                : " The approach extension, surfaces, landscaping and boundary are illustrative; colours show status separately.")}
            {mapMode === "plan" &&
              showAmenities &&
              landscapedAreas.size > 0 &&
              (hi
                ? " सुविधा क्षेत्र की हरियाली सांकेतिक है।"
                : " Amenity landscaping is illustrative.")}
          </>
        )}
      </p>
    </section>
  );
}
