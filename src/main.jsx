import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { filterPlots, areaLabel, approvedBlocks } from "../shared/domain.mjs";
import { createSiteConfig } from "../shared/site-config.mjs";
import { api, loadStored, loadPublicInventory } from "./services/api";
import {
  ownerAmenityReferences,
  previewAmenity,
  referenceFor,
} from "../shared/owner-amenity-references.mjs";
import PlotDetails from "./components/PlotDetails";
import ContactForm from "./components/ContactForm";
import Compare from "./components/Compare";
import AmenityFigure from "./components/AmenityFigure";
import "./styles.css";
import {
  reviewedVisitorAccess,
  directionsUrl,
  siteAreaUrl,
} from "../shared/site-access.mjs";
const MapCanvas = lazy(() => import("./components/MapCanvas"));
const Admin = lazy(() => import("./components/Admin"));
const NETWORK_TIMEOUT_MS = 12_000;
const readRoute = () => ({
  path: location.pathname,
  params: new URLSearchParams(location.search),
});
const leisureFacilityIds = new Set(["owner-ref-pool", "owner-ref-gym"]);
const amenityStateName = (state, hindi) =>
  state === "confirmation_pending"
    ? hindi
      ? "पुष्टि बाकी"
      : "Status unverified"
    : state === "planned"
      ? hindi
        ? "प्रस्तावित"
        : "Proposed"
      : (state || "confirmation_pending").replaceAll("_", " ");
function AmenityImage({ amenity, hindi }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="amenity-art">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open
          ? hindi
            ? "चित्र बंद करें"
            : "Hide illustration"
          : hindi
            ? "चित्र देखें"
            : "View illustration"}
      </button>
      {open && <AmenityFigure amenity={amenity} hindi={hindi} />}
    </div>
  );
}
class Boundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="page">
        <h1>This view could not be opened.</h1>
        <p>Your saved shortlist is still on this device.</p>
        <button onClick={() => location.reload()}>Reload and retry</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const hasPublicData = useRef(false);
  const [route, setRoute] = useState(readRoute),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [inventory, setInventory] = useState([]),
    [mode, setMode] = useState("offline"),
    [content, setContent] = useState([]),
    [siteConfig, setSiteConfig] = useState(() => createSiteConfig()),
    [siteExtent, setSiteExtent] = useState(null),
    [siteAccessStatus, setSiteAccessStatus] = useState("unavailable"),
    [stale, setStale] = useState(false),
    [publicReady, setPublicReady] = useState(false);
  const [language, setLanguage] = useState(() =>
      loadStored("sm-language", "en"),
    ),
    [menu, setMenu] = useState(false),
    [saved, setSaved] = useState(() => {
      const s = loadStored("sm-shortlist", []);
      return Array.isArray(s) ? s.filter((x) => typeof x === "string") : [];
    }),
    [compare, setCompare] = useState(() => {
      try {
        const stored = JSON.parse(sessionStorage.getItem("sm-compare") || "[]");
        return Array.isArray(stored)
          ? [
              ...new Set(
                stored.filter(
                  (id) => typeof id === "string" && id.length <= 128,
                ),
              ),
            ].slice(0, 3)
          : [];
      } catch {
        return [];
      }
    }),
    [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({
      query: "",
      block: "",
      status: "",
      type: "",
      facing: "",
      phase: "",
      corner: "",
      minRoad: "",
      maxPrice: "",
      min: "",
      max: "",
      savedOnly: false,
    }),
    [units, setUnits] = useState("ft"),
    [areaUnit, setAreaUnit] = useState("sqft"),
    [mobileView, setMobileView] = useState("map"),
    [mapMode, setMapMode] = useState("colony"),
    [blockSearch, setBlockSearch] = useState(""),
    [tourPlot, setTourPlot] = useState(null),
    [focusRequest, setFocusRequest] = useState(0),
    [tour, setTour] = useState(null),
    [playing, setPlaying] = useState(false);
  const path = route.path,
    exploring = path === "/explore" || path.startsWith("/plots/");
  const selected =
    exploring && route.params.has("amenity")
      ? null
      : path.startsWith("/plots/")
        ? decodeURIComponent(path.slice(7))
        : route.params.get("plot");
  const routeBlock = route.params.get("block") || "";
  function navigate(url) {
    history.pushState({}, "", url);
    setRoute(readRoute());
    setMenu(false);
    if (!url.startsWith("/explore?") && !url.startsWith("/plots/"))
      window.scrollTo(0, 0);
  }
  useEffect(() => {
    const back = () => setRoute(readRoute());
    window.addEventListener("popstate", back);
    const links = (e) => {
      const a = e.target.closest("a");
      if (
        a?.origin === location.origin &&
        !a.target &&
        !a.download &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        e.button === 0 &&
        [
          "/",
          "/explore",
          "/location",
          "/amenities",
          "/gallery",
          "/documents",
          "/contact",
          "/privacy",
          "/admin",
          "/compare",
        ].some((p) => a.pathname === p || a.pathname.startsWith("/plots/"))
      ) {
        e.preventDefault();
        navigate(a.pathname + a.search + a.hash);
      }
    };
    document.addEventListener("click", links);
    return () => {
      window.removeEventListener("popstate", back);
      document.removeEventListener("click", links);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("sm-language", JSON.stringify(language));
    } catch {
      /* Language still works for this session. */
    }
  }, [language]);
  useEffect(() => {
    try {
      localStorage.setItem("sm-shortlist", JSON.stringify(saved));
    } catch {
      setNotice("This browser could not save your shortlist.");
    }
  }, [saved]);
  useEffect(() => {
    try {
      sessionStorage.setItem("sm-compare", JSON.stringify(compare));
    } catch {
      // Comparison remains usable until this tab is closed.
    }
  }, [compare]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    document.title = `${exploring ? "Plot explorer" : path === "/" ? "A thoughtful beginning" : path.slice(1).replace("-", " ")} · ${siteConfig.name}`;
  }, [path, exploring, siteConfig.name]);
  useEffect(() => {
    if (!exploring && path !== "/contact" && path !== "/compare") return;
    const controller = new AbortController();
    setError("");
    const timer = setTimeout(() => {
      controller.abort();
      setError("The colony drawing timed out. Please retry.");
    }, NETWORK_TIMEOUT_MS);
    fetch("/data/layout.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error("The colony drawing could not be loaded.");
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [retry, exploring, path === "/contact", path === "/compare"]);
  useEffect(() => {
    let active = true,
      request;
    async function refresh() {
      request?.abort();
      const current = new AbortController();
      request = current;
      const signal = current.signal;
      const timer = setTimeout(() => {
        current.abort();
        if (active && request === current) {
          setStale(true);
          if (!hasPublicData.current) setMode("offline");
          setPublicReady(true);
        }
      }, NETWORK_TIMEOUT_MS);
      try {
        const [project, result] = await Promise.all([
          api("/public/project", { signal }),
          loadPublicInventory(signal),
        ]);
        if (active && request === current) {
          setSiteConfig(createSiteConfig(project.siteConfig));
          setMode(project.mode);
          setContent(project.items);
          setSiteExtent(project.geographicBounds || null);
          setSiteAccessStatus(project.siteAccessStatus || "unavailable");
          setInventory(result);
          setStale(false);
          hasPublicData.current = true;
        }
      } catch (e) {
        if (active && request === current && e.name !== "AbortError") {
          setStale(true);
          if (!hasPublicData.current) setMode("offline");
        }
      } finally {
        clearTimeout(timer);
        if (active && request === current && !signal.aborted)
          setPublicReady(true);
      }
    }
    refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      request?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [retry, path]);
  const plots = useMemo(() => {
    if (!data) return [];
    if (mode === "connected") return inventory;
    const mapped = new Set(inventory.map((p) => p.geometryId));
    return [...inventory, ...data.plots.filter((p) => !mapped.has(p.id))];
  }, [data, inventory, mode]);
  const blocks = useMemo(() => approvedBlocks(plots), [plots]);
  const mapStructures = useMemo(
    () => stale ? [] : content.filter((item) => item.kind === "structure"),
    [content, stale],
  );
  const mapAmenities = useMemo(() => {
    const published = content
      .filter(
        (c) => c.kind === "amenity" && c.published.customerVisible !== false,
      )
      .map((c) => ({ id: c.id, ...c.published }));
    if (mode === "connected") return published;
    const ids = new Set(published.map((item) => item.id));
    return [
      ...published,
      ...ownerAmenityReferences
        .filter((item) => !ids.has(item.id))
        .map(previewAmenity),
    ];
  }, [content, mode]);
  // The shared visual is an owner-controlled layer, not a third facility.
  const amenities = useMemo(
    () => mapAmenities.filter((item) => !referenceFor(item.id)?.internalVisual),
    [mapAmenities],
  );
  const presentationPlacements = useMemo(
    () =>
      content.find(
        (item) =>
          item.id === "illustrated-layout" && item.kind === "presentation",
      )?.published.placements || [],
    [content],
  );
  const plot = plots.find((p) => p.id === selected),
    selectedBlock = plot?.approved ? plot.block : routeBlock,
    filtered = useMemo(
      () =>
        filterPlots(plots, { ...filters, approvedBlock: selectedBlock, saved }),
      [plots, filters, saved, selectedBlock],
    );
  const project = content.find((c) => c.id === "project")?.published;
  const visitorAccess = stale ? null : reviewedVisitorAccess(content);
  const visitorDirections = directionsUrl(visitorAccess);
  const areaLink = siteAreaUrl(data?.geographicBounds || siteExtent);
  const hindi = language === "hi";
  const statusName = (status) =>
    hindi
      ? {
          unverified: "पुष्टि बाकी",
          available: "उपलब्ध",
          reserved: "आरक्षित",
          sold: "विक्रय हुआ",
          blocked: "अवरुद्ध",
        }[status] || status
      : status;
  function select(id) {
    setPlaying(false);
    if (tour !== null) setTourPlot(id);
    const p = plots.find((p) => p.id === id);
    navigate(
      p?.approved
        ? `/plots/${id}?block=${encodeURIComponent(p.block)}`
        : `/explore?plot=${encodeURIComponent(id)}`,
    );
    setFocusRequest((n) => n + 1);
    setMobileView("map");
  }
  function chooseBlock(block) {
    setPlaying(false);
    setFilters((f) => ({ ...f, block: "", query: "" }));
    navigate(
      block ? `/explore?block=${encodeURIComponent(block)}` : "/explore",
    );
    setMobileView("map");
  }
  function chooseAmenity(id) {
    setPlaying(false);
    setMobileView("map");
    navigate(`/explore?amenity=${encodeURIComponent(id)}`);
  }
  function contact(kind, p) {
    navigate(
      `/contact?type=${kind}${p ? `&plot=${encodeURIComponent(p.id)}` : ""}`,
    );
  }
  function toggleCompare(id) {
    setCompare((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      if (c.length === 3) {
        setNotice("Compare up to three plots. Remove one to add another.");
        return c;
      }
      return [...c, id];
    });
  }
  const tourSteps = [
    [
      "The whole colony",
      "Explore the plan. Plot numbers and measurements still need confirmation.",
      "/explore",
    ],
    [
      "Entrance & access",
      "The source extent is known. The visitor entrance still needs owner confirmation.",
      "/location",
    ],
    [
      "Everyday amenities",
      "Review the source references and the confirmation status of each facility.",
      "/amenities",
    ],
    [
      "Find your plot",
      "Search a label, select its shape and read its approximate sides.",
      "/explore",
    ],
    [
      "Your selected plot",
      tourPlot
        ? "See the selected outline and read the measurements in its details."
        : "Choose a plot to see its outline and details, or continue the tour.",
      tourPlot ? `/explore?plot=${encodeURIComponent(tourPlot)}` : "/explore",
    ],
    [
      "Nearby places",
      "No nearby distances are claimed until the owner verifies their source and method.",
      "/location",
    ],
    [
      "Plan a conversation",
      "Request a visit. A team member must confirm your chosen slot.",
      "/contact?type=visit",
    ],
  ];
  useEffect(() => {
    if (
      !playing ||
      tour == null ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      path === "/contact"
    )
      return;
    const timer = setTimeout(() => {
      const next = tour + 1;
      if (next >= tourSteps.length) {
        setPlaying(false);
        return;
      }
      setTour(next);
      navigate(tourSteps[next][2]);
    }, 7000);
    return () => clearTimeout(timer);
  }, [playing, tour, path]);
  function moveTour(i) {
    setPlaying(false);
    setTour(i);
    navigate(tourSteps[i][2]);
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="top">
        <a href="/" className="brand" aria-label={`${siteConfig.name} home`}>
          <span className="brand-mark">
            शु<span>SM</span>
          </span>
          <span>
            SHUBH MANGAL<small>R E S I D E N C Y</small>
          </span>
        </a>
        <button
          className="menu-button"
          aria-expanded={menu}
          aria-controls="main-nav"
          onClick={() => setMenu(!menu)}
        >
          ☰ Menu
        </button>
        <nav
          id="main-nav"
          className={menu ? "open" : ""}
          aria-label="Main navigation"
        >
          {[
            ["/explore", hindi ? "प्लॉट देखें" : "Explore plots"],
            ["/location", hindi ? "स्थान" : "Location"],
            ["/amenities", hindi ? "सुविधाएँ" : "Amenities"],
            ["/documents", hindi ? "मूल योजनाएँ" : "Original plans"],
          ].map(([url, label]) => (
            <a
              href={url}
              aria-current={path === url ? "page" : undefined}
              key={url}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="language"
            onClick={() => setLanguage(hindi ? "en" : "hi")}
            aria-label={hindi ? "Switch to English" : "Switch to Hindi"}
          >
            {hindi ? "EN" : "हिन्दी"}
          </button>
          <a className="button primary visit-link" href="/contact?type=visit">
            {hindi ? "भ्रमण अनुरोध" : "Request a visit"} ↗
          </a>
        </div>
      </header>
      {path === "/" ? (
        <main id="main">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">
                शुभ मंगल रेजिडेंसी · A THOUGHTFUL BEGINNING
              </span>
              <h1>
                {hindi ? (
                  <>
                    आपकी ज़मीन।
                    <br />
                    <em>आपकी नई शुरुआत।</em>
                  </>
                ) : (
                  <>
                    Your space.
                    <br />
                    Your plans.
                    <br />
                    <em>A new beginning.</em>
                  </>
                )}
              </h1>
              <p>
                {hindi
                  ? "पूरी कॉलोनी को समझें, प्लॉट की आकृति देखें और स्पष्ट जानकारी के साथ अगला कदम लें।"
                  : project?.tagline ||
                    "Get to know the colony, explore the shape of each plot, and take your next step with a clearer picture."}
              </p>
              <div className="hero-actions">
                <a className="button primary" href="/explore">
                  {hindi ? "प्लॉट देखें" : "Explore the colony"} <span>↗</span>
                </a>
                <a className="button secondary" href="/contact?type=visit">
                  {hindi ? "भ्रमण का अनुरोध" : "Schedule a visit"} →
                </a>
              </div>
              <div className="hero-note">
                <span className="dot" />A plan you can explore.
                <small>
                  Plan reference · dimensions and availability await owner
                  review.
                </small>
              </div>
            </div>
            <a
              className="hero-plan"
              href="/explore"
              aria-label="Open the interactive colony plan"
            >
              <div className="plan-caption">
                <span>THE COLONY, AT A GLANCE</span>
                <span>N ↑</span>
              </div>
              <img
                src="/assets/geographic-layout.svg"
                alt="North-up schematic of the supplied colony geometry; approximate boundaries"
                fetchPriority="high"
              />
              <div className="plan-bottom">
                <span>
                  Explore the real source drawing
                  <small>
                    Illustrative plan · not a surveyed site photograph
                  </small>
                </span>
                <span className="round-arrow">↗</span>
              </div>
            </a>
          </section>
          <div className="principles">
            <div>
              <span>01</span>
              <h2>See the bigger picture.</h2>
              <p>Explore the full plan, then get closer to the details.</p>
            </div>
            <div>
              <span>02</span>
              <h2>Know what you’re seeing.</h2>
              <p>
                Clear labels distinguish estimates from reviewed information.
              </p>
            </div>
            <div>
              <span>03</span>
              <h2>Make room for your plans.</h2>
              <p>
                Shortlist, compare and request a conversation with the team.
              </p>
            </div>
          </div>
          <section className="home-intro">
            <div>
              <span className="eyebrow">EXPLORE WITH CLARITY</span>
              <h2>
                Start with the plan.
                <br />
                <em>Take it at your pace.</em>
              </h2>
            </div>
            <div>
              <p>
                From the overall layout to an individual boundary, the colony
                explorer keeps the source drawing at the centre of the
                conversation.
              </p>
              <button className="text-button" onClick={() => moveTour(0)}>
                Take a guided look →
              </button>
              <a href="/documents">View the original sources ↗</a>
            </div>
          </section>
          <section className="home-amenities">
            <div>
              <span className="eyebrow">A PICTURE OF EVERYDAY LIFE</span>
              <h2>Facilities, with the facts.</h2>
              <p>
                Roads, water, electricity and landscaped spaces appear in the
                supplied sources. Their current condition and completion await
                confirmation.
              </p>
              <a className="button" href="/amenities">
                View amenity status ↗
              </a>
            </div>
            <div className="amenity-grid">
              {(amenities.length
                ? amenities.slice(0, 4)
                : [
                    "Road network",
                    "Water supply",
                    "Electricity",
                    "Landscaping",
                  ].map((title) => ({ title, state: "confirmation_pending" }))
              ).map((s, i) => (
                <article key={s.title}>
                  <span className="line-icon">{["↔", "◉", "ϟ", "♧"][i]}</span>
                  <h3>{hindi && s.titleHi ? s.titleHi : s.title}</h3>
                  <span className="badge">
                    {amenityStateName(s.state, hindi)}
                  </span>
                </article>
              ))}
            </div>
          </section>
          <section className="location-strip">
            <span className="eyebrow">VISIT WITH CONFIDENCE</span>
            <h2>A place is more than a plan.</h2>
            <p>
              See the geographic context and ask the team to confirm the
              entrance before travelling.
            </p>
            <a className="button secondary" href="/location">
              Explore location →
            </a>
          </section>
        </main>
      ) : path === "/admin" ? (
        <main id="main" className="admin-page">
          <Suspense fallback={<p>Opening owner workspace…</p>}>
            <Admin />
          </Suspense>
        </main>
      ) : (
        <main id="main">
          {exploring ? (
            <>
              <div className="explorer-intro">
                <div>
                  <span className="eyebrow">THE COLONY EXPLORER</span>
                  <h1>
                    {hindi
                      ? "हर प्लॉट, एक स्पष्ट नज़र से।"
                      : "A closer look. A clearer choice."}
                  </h1>
                  <p>
                    {mode === "connected"
                      ? hindi
                        ? "मालिक द्वारा जाँची गई प्रकाशित सूची। प्रत्येक माप पर उसका स्रोत दिया है।"
                        : "Owner-reviewed listings. Measurements show their source."
                      : hindi
                        ? "यह संदर्भ नक्शा है। नंबर, माप और उपलब्धता की पुष्टि बाकी है।"
                        : "Reference plan. Plot numbers, measurements and availability need confirmation."}
                  </p>
                </div>
                <a className="button" href="/compare">
                  {hindi ? "तुलना" : "Compare"} ({compare.length}/3) ↗
                </a>
              </div>
              {stale && (
                <div className="connection-note" role="status">
                  {mode === "offline"
                    ? "Live inventory is not connected. Showing the reference plan."
                    : "Inventory refresh failed. Displayed data may be stale."}{" "}
                  <button onClick={() => setRetry((n) => n + 1)}>
                    Retry connection
                  </button>
                </div>
              )}
              {error ? (
                <section className="page" role="alert">
                  <h2>Unable to load the drawing</h2>
                  <p>{error}</p>
                  <button onClick={() => setRetry((n) => n + 1)}>
                    Retry layout
                  </button>
                  <a
                    href="/assets/geographic-layout.svg"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the static drawing
                  </a>
                </section>
              ) : !data ? (
                <p className="page" role="status">
                  Loading the colony drawing…
                </p>
              ) : (
                <>
                  {amenities.some((item) => item.mapPoint) && (
                    <div className="amenity-navigation">
                      <details>
                        <summary>
                          {hindi ? "सुविधाएँ देखें" : "Explore amenities"} (
                          {amenities.filter((item) => item.mapPoint).length})
                        </summary>
                        <div>
                          {amenities
                            .filter(
                              (item) =>
                                item.mapPoint &&
                                (!leisureFacilityIds.has(item.id) ||
                                  !amenities.some(
                                    (parent) =>
                                      parent.id === "owner-ref-clubhouse" &&
                                      parent.mapPoint,
                                  )),
                            )
                            .map((item) => (
                              <React.Fragment key={item.id}>
                                <button onClick={() => chooseAmenity(item.id)}>
                                  {hindi && item.titleHi
                                    ? item.titleHi
                                    : item.title}
                                </button>
                                {item.id === "owner-ref-clubhouse" &&
                                  amenities.some(
                                    (child) =>
                                      child.mapPoint &&
                                      leisureFacilityIds.has(child.id),
                                  ) && (
                                    <div
                                      className="clubhouse-facilities"
                                      role="group"
                                      aria-label={
                                        hindi
                                          ? "क्लब हाउस सुविधाएँ"
                                          : "Clubhouse facilities"
                                      }
                                    >
                                      <span>
                                        {hindi
                                          ? "क्लब हाउस सुविधाएँ"
                                          : "Clubhouse facilities"}
                                      </span>
                                      {amenities
                                        .filter(
                                          (child) =>
                                            child.mapPoint &&
                                            leisureFacilityIds.has(child.id),
                                        )
                                        .map((child) => (
                                          <button
                                            key={child.id}
                                            onClick={() =>
                                              chooseAmenity(child.id)
                                            }
                                          >
                                            {hindi && child.titleHi
                                              ? child.titleHi
                                              : child.title}
                                          </button>
                                        ))}
                                    </div>
                                  )}
                              </React.Fragment>
                            ))}
                        </div>
                      </details>
                      {amenities.some((item) => item.referencePreview) && (
                        <span>
                          {hindi
                            ? "सांकेतिक स्थान · पुष्टि बाकी"
                            : "Illustrative locations · confirmation pending"}
                        </span>
                      )}
                    </div>
                  )}
                  {(blocks.length > 0 || selectedBlock) && (
                    <div className="block-navigation">
                      {blocks.length > 0 && (
                        <details>
                          <summary>
                            {hindi
                              ? "स्वीकृत ब्लॉक देखें"
                              : "Browse approved blocks"}{" "}
                            ({blocks.length})
                          </summary>
                          <label>
                            {hindi ? "ब्लॉक खोजें" : "Search blocks"}
                            <input
                              type="search"
                              value={blockSearch}
                              onChange={(e) => setBlockSearch(e.target.value)}
                              placeholder={
                                hindi ? "ब्लॉक का नाम" : "Block name"
                              }
                            />
                          </label>
                          <div className="block-options">
                            {blocks
                              .filter((b) =>
                                b.name
                                  .toLowerCase()
                                  .includes(blockSearch.trim().toLowerCase()),
                              )
                              .map((b) => (
                                <button
                                  key={b.name}
                                  aria-pressed={selectedBlock === b.name}
                                  onClick={() => chooseBlock(b.name)}
                                >
                                  {hindi ? "ब्लॉक" : "Block"} {b.name}{" "}
                                  <small>({b.plots.length})</small>
                                </button>
                              ))}
                          </div>
                        </details>
                      )}
                      {selectedBlock && (
                        <button onClick={() => chooseBlock("")}>
                          {hindi ? "पूरी कॉलोनी देखें" : "Back to full colony"}
                        </button>
                      )}
                      {selectedBlock &&
                        !blocks.some((b) => b.name === selectedBlock) && (
                          <span role="status">
                            This approved block is no longer published.
                          </span>
                        )}
                    </div>
                  )}
                  {!blocks.length && !selectedBlock && (
                    <p className="block-pending">
                      {hindi
                        ? "ब्लॉक की पुष्टि होने तक प्लॉट नंबर से खोजें।"
                        : "Search by plot number; blocks appear after owner confirmation."}
                    </p>
                  )}
                  <div
                    className="mobile-tabs"
                    role="group"
                    aria-label="Explorer view"
                  >
                    <button
                      aria-pressed={mobileView === "map"}
                      onClick={() => setMobileView("map")}
                    >
                      {hindi ? "नक्शा" : "Map"}
                    </button>
                    <button
                      aria-pressed={mobileView === "list"}
                      onClick={() => setMobileView("list")}
                    >
                      {hindi ? "प्लॉट सूची" : "Plot list"} ({filtered.length})
                    </button>
                  </div>
                  <div
                    className={`workspace mobile-${mobileView}${selected ? " has-selection" : ""}`}
                  >
                    <aside className="inventory">
                      <div className="section-title">
                        <h2>{hindi ? "प्लॉट खोजें" : "Find a plot"}</h2>
                        <span>{filtered.length}</span>
                      </div>
                      <label>
                        {hindi ? "प्लॉट नंबर" : "Plot number"}
                        <input
                          type="search"
                          placeholder={
                            hindi ? "जैसे B26" : "Try a plot number, e.g. B26"
                          }
                          value={filters.query}
                          onChange={(e) =>
                            setFilters({ ...filters, query: e.target.value })
                          }
                        />
                      </label>
                      <details className="filter-details">
                        <summary>
                          {hindi ? "प्लॉट छाँटें" : "Filter plots"}
                        </summary>
                        {mode !== "connected" && (
                          <label htmlFor="filter-block">
                            Plan area (reference)
                            <select
                              id="filter-block"
                              aria-label="Plan area (reference)"
                              value={filters.block}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  block: e.target.value,
                                })
                              }
                            >
                              <option value="">All plan references</option>
                              {[
                                ...new Set(
                                  plots
                                    .filter((p) => !p.approved)
                                    .map((p) => p.block),
                                ),
                              ]
                                .sort((a, b) =>
                                  a.localeCompare(b, undefined, {
                                    numeric: true,
                                  }),
                                )
                                .map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                            </select>
                          </label>
                        )}
                        <label htmlFor="filter-status">
                          {hindi ? "स्थिति" : "Status"}
                          <select
                            id="filter-status"
                            aria-label="Status"
                            value={filters.status}
                            onChange={(e) =>
                              setFilters({ ...filters, status: e.target.value })
                            }
                          >
                            <option value="">
                              {hindi ? "सभी स्थितियाँ" : "All statuses"}
                            </option>
                            {[...new Set(plots.map((p) => p.status))].map(
                              (s) => (
                                <option value={s} key={s}>
                                  {statusName(s)}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          {hindi ? "प्लॉट का प्रकार" : "Plot type"}
                          <select
                            value={filters.type}
                            onChange={(e) =>
                              setFilters({ ...filters, type: e.target.value })
                            }
                          >
                            <option value="">All types</option>
                            {[
                              ...new Set(
                                plots.map(
                                  (p) => p.approved?.plotType || "not_provided",
                                ),
                              ),
                            ].map((s) => (
                              <option value={s} key={s}>
                                {s === "not_provided" ? "Not provided" : s}
                              </option>
                            ))}
                          </select>
                        </label>
                        {plots.some((p) => p.approved?.facing) && (
                          <label>
                            Facing
                            <select
                              value={filters.facing}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  facing: e.target.value,
                                })
                              }
                            >
                              <option value="">All directions</option>
                              {[
                                ...new Set(
                                  plots
                                    .map((p) => p.approved?.facing)
                                    .filter(Boolean),
                                ),
                              ]
                                .sort()
                                .map((f) => (
                                  <option key={f}>{f}</option>
                                ))}
                            </select>
                          </label>
                        )}
                        {plots.some((p) => p.approved?.phase) && (
                          <label>
                            Approved phase
                            <select
                              value={filters.phase}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  phase: e.target.value,
                                })
                              }
                            >
                              <option value="">All phases</option>
                              {[
                                ...new Set(
                                  plots
                                    .map((p) => p.approved?.phase)
                                    .filter(Boolean),
                                ),
                              ]
                                .sort()
                                .map((phase) => (
                                  <option key={phase}>{phase}</option>
                                ))}
                            </select>
                          </label>
                        )}
                        {plots.some((p) => p.approved?.corner != null) && (
                          <label>
                            Corner plot
                            <select
                              value={filters.corner}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  corner: e.target.value,
                                })
                              }
                            >
                              <option value="">All plots</option>
                              <option value="yes">Verified corner</option>
                              <option value="no">Verified non-corner</option>
                            </select>
                          </label>
                        )}
                        {plots.some(
                          (p) => p.approved?.roadWidthMetres != null,
                        ) && (
                          <label>
                            Minimum verified road width (m)
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={filters.minRoad}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  minRoad: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        {plots.some((p) => p.priceINR != null) && (
                          <label>
                            Maximum published price (₹)
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={filters.maxPrice}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  maxPrice: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        <div className="form-grid">
                          <label>
                            {hindi ? "न्यूनतम क्षेत्रफल (m²)" : "Min area (m²)"}
                            <input
                              type="number"
                              min="0"
                              value={filters.min}
                              onChange={(e) =>
                                setFilters({ ...filters, min: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            {hindi ? "अधिकतम क्षेत्रफल (m²)" : "Max area (m²)"}
                            <input
                              type="number"
                              min="0"
                              value={filters.max}
                              onChange={(e) =>
                                setFilters({ ...filters, max: e.target.value })
                              }
                            />
                          </label>
                        </div>
                        <p className="small">
                          Area uses verified values when supplied, otherwise
                          approximate map values.
                        </p>
                        <button
                          onClick={() =>
                            setFilters({
                              query: "",
                              block: "",
                              status: "",
                              type: "",
                              facing: "",
                              phase: "",
                              corner: "",
                              minRoad: "",
                              maxPrice: "",
                              min: "",
                              max: "",
                              savedOnly: false,
                            })
                          }
                        >
                          {hindi ? "फ़िल्टर हटाएँ" : "Reset filters"}
                        </button>
                      </details>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={filters.savedOnly}
                          onChange={(e) =>
                            setFilters({
                              ...filters,
                              savedOnly: e.target.checked,
                            })
                          }
                        />{" "}
                        {hindi ? "मेरी सूची" : "My shortlist"} ({saved.length})
                      </label>
                      <p className="list-caption" aria-live="polite">
                        {filtered.length}{" "}
                        {hindi
                          ? "परिणाम · नंबर क्रम में"
                          : "results · natural number order"}
                      </p>
                      <div className="plot-list" aria-label="Plot results">
                        {filtered.map((p) => (
                          <button
                            key={p.id}
                            className={`plot-row ${p.id === selected ? "active" : ""}`}
                            aria-pressed={p.id === selected}
                            onClick={() => select(p.id)}
                          >
                            <span>
                              <b>
                                {p.approved
                                  ? "Plot"
                                  : p.identityReviewRequired
                                    ? "Review"
                                    : "Plan label"}{" "}
                                {p.identityReviewRequired ? "cell" : p.label}
                              </b>
                              <small>
                                {p.approved
                                  ? `${hindi ? "ब्लॉक" : "Block"} ${p.block}`
                                  : `${hindi ? "योजना क्षेत्र" : "Plan area"} ${p.block}`}{" "}
                                · {statusName(p.status)}
                              </small>
                              <small>{areaLabel(p, areaUnit)}</small>
                            </span>
                            <span aria-hidden="true">
                              {saved.includes(p.id) ? "♥" : "↗"}
                            </span>
                          </button>
                        ))}
                        {!filtered.length && (
                          <p>
                            No matching plots. Adjust your filters or try
                            another number.
                          </p>
                        )}
                      </div>
                    </aside>
                    <Suspense fallback={<div>Opening map…</div>}>
                      <div
                        className="map-wrap"
                        onPointerDown={() => setPlaying(false)}
                      >
                        {siteAccessStatus === "needs_review" && (
                          <p role="status" className="note">
                            {hindi ? "प्रवेश स्थल की सीमा की दोबारा समीक्षा आवश्यक है; प्रवेश दिशा अस्थायी रूप से उपलब्ध नहीं है।" : "The entrance footprint needs another review against current parcel information. Gate directions are temporarily unavailable."}
                          </p>
                        )}
                        <MapCanvas
                          data={data}
                          plots={plots}
                          selected={selected}
                          units={units}
                          focusRequest={focusRequest}
                          visibleIds={new Set(filtered.map((p) => p.id))}
                          onSelect={select}
                          selectedBlock={selectedBlock}
                          onBlockSelect={chooseBlock}
                          mapMode={mapMode}
                          setMapMode={setMapMode}
                          amenities={mapAmenities}
                          presentationPlacements={presentationPlacements}
                          amenityId={route.params.get("amenity")}
                          onAmenitySelect={chooseAmenity}
                          onAmenityClose={() => navigate("/explore")}
                          language={language}
                          stale={stale}
                          visitorAccess={visitorAccess}
                          structures={mapStructures}
                        />
                      </div>
                    </Suspense>
                    {selected && !plot ? (
                      <aside className="details">
                        <h2>Plot not found</h2>
                        <p>
                          This link may be provisional, unpublished or archived.
                          No other plot has been substituted.
                        </p>
                        <a href="/explore">Return to the full plan</a>
                      </aside>
                    ) : plot ? (
                      <PlotDetails
                        plot={plot}
                        units={units}
                        setUnits={setUnits}
                        areaUnit={areaUnit}
                        setAreaUnit={setAreaUnit}
                        saved={saved.includes(selected)}
                        onSave={() =>
                          setSaved((s) =>
                            s.includes(selected)
                              ? s.filter((x) => x !== selected)
                              : [...s, selected],
                          )
                        }
                        onCompare={() => toggleCompare(selected)}
                        compared={compare.includes(selected)}
                        onFocus={() => setFocusRequest((n) => n + 1)}
                        onClose={() => {
                          navigate(
                            selectedBlock
                              ? `/explore?block=${encodeURIComponent(selectedBlock)}`
                              : "/explore",
                          );
                          setMobileView("map");
                          requestAnimationFrame(() =>
                            document.querySelector(".map-area > svg")?.focus(),
                          );
                        }}
                        onBackToExplorer={
                          path.startsWith("/plots/")
                            ? () =>
                                navigate(
                                  `/explore?plot=${encodeURIComponent(selected)}${selectedBlock ? `&block=${encodeURIComponent(selectedBlock)}` : ""}`,
                                )
                            : null
                        }
                        onContact={contact}
                        notify={setNotice}
                        language={language}
                        documents={content.filter(
                          (item) =>
                            item.kind === "media" &&
                            item.published.category === "document",
                        )}
                      />
                    ) : null}
                  </div>
                </>
              )}
            </>
          ) : path === "/compare" ? (
            <Compare
              plots={compare
                .map((id) => plots.find((p) => p.id === id))
                .filter(Boolean)}
              remove={toggleCompare}
              select={select}
              units={units}
              areaUnit={areaUnit}
              loading={
                compare.length > 0 && ((!data && !error) || !publicReady)
              }
              missing={compare.filter((id) => !plots.some((p) => p.id === id))}
              loadError={compare.length && !data ? error : ""}
              onRetry={() => setRetry((n) => n + 1)}
            />
          ) : path === "/contact" ? (
            <div className="page">
              <ContactForm
                key={route.params.toString()}
                plots={plots}
                initialPlot={plot}
                requestedPlotId={route.params.get("plot") || ""}
                plotsLoading={(!data && !error) || !publicReady}
                plotLoadError={!data ? error : ""}
                onRetryPlots={() => setRetry((n) => n + 1)}
                connectionChecking={!publicReady}
                kind={
                  route.params.get("type") === "visit" ? "visit" : "enquiry"
                }
                mode={mode}
                language={language}
              />
              {project?.contactPhone && (
                <p>
                  Confirmed contact:{" "}
                  <a href={`tel:${project.contactPhone}`}>
                    {project.contactPhone}
                  </a>{" "}
                  ·{" "}
                  <a
                    href={`https://wa.me/${project.contactPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello, I would like to enquire about ${siteConfig.name}.${plot ? ` Plot ${plot.label}: ${location.origin}${plot.approved ? `/plots/${encodeURIComponent(plot.id)}` : `/explore?plot=${encodeURIComponent(plot.id)}`}` : ""}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open a WhatsApp draft ↗
                  </a>{" "}
                  (Opening a draft does not send a message.)
                </p>
              )}
            </div>
          ) : path === "/location" ? (
            <section className="page location-page">
              <div>
                <span className="eyebrow">GET YOUR BEARINGS</span>
                <h1>Begin with the location.</h1>
                <p>
                  The drawing is geographically positioned using the supplied
                  KML.{" "}
                  {visitorAccess
                    ? "A reviewed visitor entrance is published."
                    : "The visitor entrance and approach route have not yet been confirmed."}
                </p>
                <div className="note">
                  {siteAccessStatus === "needs_review"
                    ? "The entrance footprint needs another review against current parcel information. Gate directions are temporarily unavailable."
                    : visitorAccess
                    ? "Directions use the reviewed visitor route-access point."
                    : "Gate directions are unavailable until visitor access is reviewed and published. The site-area link is approximate; confirm access with the team before travelling."}
                </div>
                {visitorDirections && (
                  <a
                    className="button primary"
                    href={visitorDirections}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Maps directions ↗
                  </a>
                )}
                {areaLink && (
                  <a
                    className="button"
                    href={areaLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View approximate site area ↗
                  </a>
                )}
                <a
                  className="button"
                  href="/downloads/Shubh_Mangal_Full_Layout.kml"
                  download
                >
                  Download source KML ↓
                </a>
                <h2>Nearby places</h2>
                {content.filter((c) => c.kind === "nearby").length ? (
                  content
                    .filter((c) => c.kind === "nearby")
                    .map((c) => (
                      <article key={c.id}>
                        <h3>{c.published.title}</h3>
                        <p>
                          {c.published.category && (
                            <>{c.published.category} · </>
                          )}
                          {c.published.distanceKm} km ·{" "}
                          {c.published.method.replace("_", " ")} · Source:{" "}
                          {c.published.source}
                        </p>
                      </article>
                    ))
                ) : (
                  <p>
                    Nearby landmarks, distances and travel times await
                    verification.
                  </p>
                )}
                <a href="/contact?type=visit">Request a visit →</a>
              </div>
              <figure className="location-preview">
                <img
                  src="/assets/geographic-layout.svg"
                  alt="Approximate colony footprint from supplied KML"
                  loading="lazy"
                />
                <figcaption>
                  Geographic drawing · north up · no satellite imagery
                </figcaption>
              </figure>
            </section>
          ) : path === "/amenities" ? (
            <section className="page">
              <span className="eyebrow">EVERYDAY CONSIDERATIONS</span>
              <h1>Amenities, clearly described.</h1>
              <p>
                Source drawings show intent. Completion is only stated after
                owner verification.
              </p>
              <div className="amenity-grid large">
                {(amenities.length
                  ? amenities
                  : [
                      "Road network",
                      "Water supply",
                      "Electricity",
                      "Security",
                      "Landscaping",
                      "Temple",
                    ].map((title) => ({
                      title,
                      state: "confirmation_pending",
                      description:
                        "Referenced in the supplied plan or poster. Current availability, specification and completion await owner confirmation.",
                      source: "Supplied source documents",
                    }))
                ).map((a) => (
                  <article key={a.title}>
                    <span className="line-icon">◇</span>
                    <h2>{hindi && a.titleHi ? a.titleHi : a.title}</h2>
                    <span className="badge">
                      {amenityStateName(a.state, hindi)}
                    </span>
                    <p>
                      {hindi && a.descriptionHi
                        ? a.descriptionHi
                        : a.description}
                    </p>
                    {a.placementPrecision === "approximate" && (
                      <small>Approximate location · not surveyed</small>
                    )}
                    {a.imageUrl && <AmenityImage amenity={a} hindi={hindi} />}
                    <small>Source: {a.source}</small>
                    {(a.location || a.mapPoint) && a.id && (
                      <p>
                        <a
                          className="button"
                          href={`/explore?amenity=${encodeURIComponent(a.id)}`}
                        >
                          Show on map ↗
                        </a>
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ) : ["/documents", "/gallery"].includes(path) ? (
            <section className="page">
              <span className="eyebrow">THE ORIGINAL SOURCES</span>
              <h1>See where the details begin.</h1>
              <p>
                The supplied PDF is the reference for owner review. Final plot
                dimensions, identity, approvals and legal details require
                verification.
              </p>
              <div className="plans">
                <article>
                  <h2>North-oriented survey plan</h2>
                  <p>
                    Rendering of the supplied PDF. Its subdivisions need
                    reconciliation with the map and poster.
                  </p>
                  <a
                    href="/assets/survey-plan-north.png"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src="/assets/survey-plan-north.png"
                      alt="Supplied north-oriented source plan, open full resolution to inspect"
                      loading="lazy"
                    />
                  </a>
                  <a
                    className="button"
                    href="/downloads/survey-plan-north.pdf"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open original PDF ↗
                  </a>
                </article>
                <article>
                  <h2>Marketing poster</h2>
                  <p className="warning">
                    Unverified historical marketing source. The RERA, loan,
                    facility and contact claims printed in this image are not
                    confirmed by this website.
                  </p>
                  <a
                    href="/assets/colony-poster.png"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src="/assets/colony-poster.png"
                      alt="Supplied marketing poster containing unverified approval and facility claims"
                      loading="lazy"
                    />
                  </a>
                </article>
              </div>
              <h2>Owner-approved gallery & documents</h2>
              {content.filter((c) => c.kind === "media").length ? (
                content
                  .filter((c) => c.kind === "media")
                  .map((c) => (
                    <article key={c.id}>
                      <h3>{c.published.title}</h3>
                      <p>
                        {c.published.category} · revision {c.published.revision}{" "}
                        · {c.published.description}
                      </p>
                      <a
                        href={c.published.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open approved asset ↗
                      </a>
                    </article>
                  ))
              ) : (
                <p>
                  No owner-approved site photographs, progress media or legal
                  documents have been published.
                </p>
              )}
            </section>
          ) : path === "/privacy" ? (
            <section className="page prose">
              <span className="eyebrow">YOUR INFORMATION</span>
              <h1>Privacy & contact consent</h1>
              <p>
                The enquiry form collects your name, phone, optional email and
                message, selected plot references, preferred language, and
                consent. Visit requests also collect your requested time in
                Asia/Kolkata.
              </p>
              <p>
                In connected mode, this information is stored in the project
                database and is accessible only to authorised sales staff,
                administrators and owners. It is used to respond to your
                request. Submitting a form does not subscribe you to marketing,
                reserve a plot, or confirm a visit.
              </p>
              <p>
                In local development mode, records remain in the local
                development database. In offline demo mode, only a draft file is
                downloaded to your own device; no message is sent. No automatic
                email, SMS or WhatsApp delivery is configured.
              </p>
              <p>
                Shortlists and your language preference are stored in this
                browser. Your comparison is kept in this tab for reloads. Staff
                sessions use an HttpOnly cookie. The site has no advertising
                trackers. External Google Maps and WhatsApp links are handled by
                those providers when you choose to open them.
              </p>
              <p>
                Opening the optional Google map contacts Google for its basemap.
                My location asks for browser permission only when pressed. The
                reported point and accuracy stay in this view's memory, are
                cleared when hidden or closed, and are not added to enquiries,
                application requests, URLs, logs or browser storage. Map
                viewport requests to Google are subject to that provider's
                privacy terms. This feature does not identify the parcel you are
                standing on.
              </p>
              <p>
                The owner must set a retention period, privacy contact and
                customer deletion procedure before public launch. Permanent
                inventory audit history contains business changes; buyer contact
                details are kept separately. Do not enter sensitive financial or
                identity documents in the message field.
              </p>
              <button
                onClick={() => {
                  setSaved([]);
                  setNotice("Shortlist cleared from this browser.");
                }}
              >
                Clear my local shortlist
              </button>
            </section>
          ) : (
            <section className="page">
              <h1>Page not found</h1>
              <a href="/">Return home →</a>
            </section>
          )}
        </main>
      )}
      {tour !== null && (
        <aside className="tour" aria-label="Guided tour">
          <div>
            <span className="eyebrow">
              GUIDED LOOK · {tour + 1}/{tourSteps.length}
            </span>
            <h2>{tourSteps[tour][0]}</h2>
            <p>{tourSteps[tour][1]}</p>
          </div>
          <div className="actions">
            <button disabled={tour === 0} onClick={() => moveTour(tour - 1)}>
              Previous
            </button>
            <button
              onClick={() => setPlaying(!playing)}
              disabled={
                path === "/contact" ||
                matchMedia("(prefers-reduced-motion: reduce)").matches
              }
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              disabled={tour === tourSteps.length - 1}
              onClick={() => moveTour(tour + 1)}
            >
              Next
            </button>
            <button
              disabled={tour === tourSteps.length - 1}
              onClick={() => moveTour(tourSteps.length - 1)}
            >
              Skip to visit
            </button>
            <button
              onClick={() => {
                setTour(null);
                setPlaying(false);
              }}
            >
              Exit tour
            </button>
          </div>
        </aside>
      )}
      <footer>
        <a className="brand footer-brand" href="/">
          SHUBH MANGAL<small>शुभ मंगल रेजिडेंसी</small>
        </a>
        <p>
          A thoughtful beginning.
          <br />
          <span>Source-led exploration. Owner review before publication.</span>
        </p>
        <nav aria-label="Footer">
          <a href="/gallery">Gallery</a>
          <a href="/contact">Contact</a>
          <a href="/privacy">Privacy</a>
          <a href="/admin">Owner workspace</a>
        </nav>
        <small>
          © {new Date().getFullYear()} {siteConfig.name}
        </small>
      </footer>
      <div role="status" aria-live="polite" className={notice ? "toast" : ""}>
        {notice}
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <Boundary>
    <App />
  </Boundary>,
);
