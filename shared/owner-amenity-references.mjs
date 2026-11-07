// Owner-indicated concept locations in the supplied plan's local UTM-43N frame.
// These are adjustable reference anchors, not surveyed coordinates or evidence of construction.
export const OWNER_AMENITY_SOURCE = "Owner-provided screenshot reference";
export const ownerAmenityReferences = [
  {
    id: "owner-ref-fountain",
    title: "Fountain",
    titleHi: "फव्वारा",
    category: "fountain",
    image: "fountain-center.png",
    mapSize: [24, 24],
    imageSize: [1254, 1254],
    mapCrop: [0, 0, 1254, 1254],
    previousArtwork: {
      image: "fountain.png",
      mapSize: [23, 17.6],
      imageSize: [1536, 1024],
      mapCrop: [200, 40, 1165, 890],
    },
    mapPoint: { x: 167.26, y: 143.32 },
    areaIds: ["area-30"],
    locationNote: "Centre of the roundabout",
    visualRotation: 0,
  },
  {
    id: "owner-ref-temple",
    title: "Temple",
    titleHi: "मंदिर",
    category: "temple",
    image: "temple.png",
    mapSize: [14, 13.75],
    imageSize: [1312, 1199],
    mapCrop: [50, 0, 1220, 1199],
    foreground: {
      image: "temple-foreground.png",
      mapSize: [10.75, 16.19],
      imageSize: [1024, 1536],
      mapCrop: [0, 0, 1024, 1536],
    },
    mapPoint: { x: 286.54, y: 130.8 },
    areaIds: ["area-2", "area-40"],
    locationNote: "Shared area beside plots 357–366 and 381–390",
    visualRotation: 0,
  },
  {
    id: "owner-ref-garden",
    title: "Play Garden",
    titleHi: "खेल उद्यान",
    category: "garden",
    image: "garden.png",
    mapSize: [20.5, 13.8],
    imageSize: [1536, 1024],
    mapCrop: [55, 10, 1465, 985],
    foreground: {
      image: "playground-foreground.png",
      mapSize: [13.2, 19.8],
      imageSize: [1024, 1536],
      mapCrop: [0, 0, 1024, 1536],
    },
    mapPoint: { x: 292, y: 150 },
    areaIds: ["area-2", "area-40"],
    locationNote: "Shared area beside plots 357–366 and 381–390",
    visualRotation: 0,
  },
  {
    id: "owner-ref-clubhouse",
    title: "Clubhouse",
    titleHi: "क्लब हाउस",
    category: "clubhouse",
    image: "houseclub-no-pool.png",
    mapSize: [29, 65.5],
    imageSize: [1024, 1536],
    mapCrop: [175, 0, 680, 1536],
    foreground: {
      image: "clubhouse-foreground.png",
      mapSize: [20, 20.57],
      imageSize: [1237, 1271],
      mapCrop: [0, 0, 1237, 1271],
    },
    previousArtwork: {
      image: "club-house.png",
      mapSize: [16, 10.4],
      imageSize: [1536, 1024],
      mapCrop: [90, 50, 1380, 900],
    },
    mapPoint: { x: 63, y: 220 },
    areaIds: ["area-3"],
    locationNote: "Area below plots B1–B4 and B50–B52",
    visualRotation: -10,
  },
  {
    id: "owner-ref-pool",
    title: "Swimming pool",
    titleHi: "स्विमिंग पूल",
    category: "other",
    parentAmenityId: "owner-ref-clubhouse",
    mapNative: true,
    image: "pool-concept.png",
    imageSize: [1536, 1024],
    mapCrop: [0, 0, 1536, 1024],
    mapSize: [8, 16],
    mapPoint: { x: 65.5, y: 242 },
    areaIds: ["area-3"],
    visualRotation: -5,
    state: "planned",
    source: "Owner-provided concept direction",
    description:
      "Proposed swimming pool and deck. Illustrative concept; exact design and construction are not confirmed.",
    descriptionHi:
      "प्रस्तावित स्विमिंग पूल और डेक। यह सांकेतिक अवधारणा है; सटीक डिज़ाइन और निर्माण की पुष्टि बाकी है।",
    locationNote: "Clubhouse leisure area; exact placement is unconfirmed",
  },
  {
    id: "owner-ref-gym",
    title: "Gym",
    titleHi: "जिम",
    category: "other",
    parentAmenityId: "owner-ref-clubhouse",
    mapNative: true,
    image: "outdoor-gym-concept.png",
    imageSize: [1536, 1024],
    mapCrop: [0, 0, 1536, 1024],
    mapSize: [9, 10],
    mapPoint: { x: 67.7, y: 259.5 },
    areaIds: ["area-3"],
    visualRotation: -5,
    state: "planned",
    source: "Owner-provided concept direction",
    description:
      "Proposed outdoor fitness area. Equipment and layout are an illustrative concept; construction is not confirmed.",
    descriptionHi:
      "प्रस्तावित आउटडोर व्यायाम क्षेत्र। उपकरण और लेआउट सांकेतिक हैं; निर्माण की पुष्टि बाकी है।",
    locationNote: "Clubhouse leisure area; exact placement is unconfirmed",
  },
  {
    id: "owner-ref-entry-gate",
    title: "Entry Gate",
    titleHi: "प्रवेश द्वार",
    category: "entrance",
    image: "entry-gate-road-free.png",
    mapSize: [20, 7.7],
    imageSize: [1536, 1024],
    mapCrop: [0, 190, 1536, 590],
    previousArtwork: {
      image: "entry-gate.png",
      mapSize: [18, 12.2],
      imageSize: [1536, 1024],
      mapCrop: [30, 0, 1475, 1024],
    },
    mapPoint: { x: 107.5, y: 460 },
    areaIds: ["area-31"],
    locationNote: "Bottom approach-road area",
    visualRotation: 1.5,
  },
  {
    id: "owner-ref-temple-garden-visual",
    title: "Temple and play garden shared visual",
    titleHi: "मंदिर और खेल उद्यान का साझा चित्र",
    category: "other",
    internalVisual: true,
    image: "garden-temple.png",
    mapSize: [22, 39.3],
    imageSize: [1024, 1536],
    mapCrop: [110, 0, 860, 1536],
    mapPoint: { x: 290, y: 141 },
    areaIds: ["area-2", "area-40"],
    locationNote:
      "Shared temple and play garden area; exact placement is unconfirmed",
    visualRotation: 0,
  },
  ...[
    ["ne", "North-east", "उत्तर-पूर्व", "area-41", 184.86, 128.2, 94.3],
    ["se", "South-east", "दक्षिण-पूर्व", "area-42", 188.29, 153.25, 160.3],
    ["sw", "South-west", "दक्षिण-पश्चिम", "area-43", 144.17, 156.25, -74.2],
    ["nw", "North-west", "उत्तर-पश्चिम", "area-44", 144.19, 134.97, -25.1],
  ].map(([corner, title, titleHi, area, x, y, rotation]) => ({
    id: `owner-ref-roundabout-garden-${corner}`,
    title: `${title} roundabout garden`,
    titleHi: `${titleHi} गोलचक्कर उद्यान`,
    category: "garden",
    image: "fountain-corner.png",
    mapSize: [22, 20.6],
    imageSize: [1296, 1214],
    mapCrop: [0, 0, 1296, 1214],
    mapPoint: { x, y },
    areaIds: [area],
    locationNote: `${title} area beside the central roundabout`,
    visualRotation: rotation,
  })),
];
export function referenceFor(id) {
  return ownerAmenityReferences.find((item) => item.id === id);
}
// Apply the owner-adjustable shared temple/garden presentation transform in
// planar map coordinates. Both the 2D artwork and 3D meshes use this result;
// it is a visual placement, not a surveyed or stored geographic measurement.
export function sharedAmenityPosition(item, sharedVisual, origin) {
  const factor = sharedVisual.visualScale || 1;
  const angle = ((sharedVisual.visualRotation || 0) * Math.PI) / 180;
  const dx = (item.x - origin.x) * factor;
  const dy = (item.y - origin.y) * factor;
  return {
    x: sharedVisual.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: sharedVisual.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    rotation: (sharedVisual.visualRotation || 0) + (item.visualRotation || 0),
    scale: factor * (item.visualScale || 1),
  };
}
export function areaRing(path) {
  return [
    ...path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/g),
  ].map((m) => [Number(m[1]), Number(m[2])]);
}
// The source's two adjoining temple/garden outlines differ by a few centimetres
// at shared vertices. Bridge only their near-identical edges in the *artwork
// clip*, without changing either source polygon or the owner position rules.
export function amenityClipBridges(layout, reference) {
  if (
    !reference?.areaIds.includes("area-2") ||
    !reference.areaIds.includes("area-40")
  )
    return [];
  const outer = areaRing(
    layout.areas.find((area) => area.id === "area-2")?.path || "",
  );
  const inner = areaRing(
    layout.areas.find((area) => area.id === "area-40")?.path || "",
  );
  if (
    inner.length > 1 &&
    inner[0][0] === inner.at(-1)[0] &&
    inner[0][1] === inner.at(-1)[1]
  )
    inner.pop();
  const nearby = inner.map((point) => {
    const matches = outer.map((candidate) => ({
      candidate,
      distance: Math.hypot(candidate[0] - point[0], candidate[1] - point[1]),
    }));
    const closest = matches.sort((a, b) => a.distance - b.distance)[0];
    return closest?.distance <= 0.25 ? closest.candidate : null;
  });
  return inner.flatMap((point, i) => {
    const next = (i + 1) % inner.length;
    if (!nearby[i] || !nearby[next]) return [];
    return [
      `M${point.join(",")} L${inner[next].join(",")} L${nearby[next].join(",")} L${nearby[i].join(",")} Z`,
    ];
  });
}
export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function referenceContains(layout, reference, point) {
  return reference.areaIds.some((id) => {
    const area = layout.areas.find((candidate) => candidate.id === id);
    return area && pointInRing([point.x, point.y], areaRing(area.path));
  });
}
export function previewAmenity(reference) {
  return {
    ...reference,
    imageUrl: reference.image ? `/assets/concepts/${reference.image}` : "",
    imageKind: "concept",
    state: reference.state || "confirmation_pending",
    placementPrecision: "approximate",
    visualScale: 1,
    source: reference.source || OWNER_AMENITY_SOURCE,
    description:
      reference.description ||
      "Owner-indicated area. Exact placement and current status need confirmation.",
    descriptionHi:
      reference.descriptionHi ||
      "स्वामी द्वारा संकेतित क्षेत्र। सटीक स्थान और वर्तमान स्थिति की पुष्टि बाकी है।",
    referencePreview: true,
  };
}
