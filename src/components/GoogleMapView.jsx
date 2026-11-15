import React, { useEffect, useMemo, useRef, useState } from "react";
import { pathToGeographicGeometry } from "../../shared/geography.mjs";
import {
  buildMapFeatures,
  loadGoogleMaps,
  siteBounds,
} from "../services/google-maps.js";
import {
  createLocationRequest,
  locationRelativeToBounds,
} from "../services/visitor-location.js";
import { directionsUrl } from "../../shared/site-access.mjs";

const colors = {
  available: "#23734b",
  reserved: "#a85b08",
  sold: "#b63434",
  blocked: "#545b66",
  unverified: "#636b75",
};
const copy = {
  en: {
    title: "Google map",
    plan: "Back to Plan",
    fit: "Show entire site",
    roadmap: "Roadmap",
    hybrid: "Hybrid",
    loading: "Loading Google map…",
    loadingGeometry: "Loading published boundaries…",
    disabled:
      "Google Maps is not configured or is disabled. Use the Plan view.",
    bounds: "Site geographic bounds are unavailable. Use the Plan view.",
    network: "Google Maps could not load. Check your connection and try again.",
    timeout:
      "Google Maps took too long to load. Check your connection and try again.",
    auth: "Google Maps authorization failed. Ask the site administrator to check the API key, billing and website restrictions, then reload this page.",
    reload: "Reload page",
    retry: "Try again",
    geometry:
      "Boundaries are unavailable. All plot overlays have been cleared. Retry or use the Plan view.",
    provisional: "Provisional boundaries",
    provisionalNote:
      "Unapproved plan paths are approximate, not published or surveyed boundaries.",
    official: "Published boundaries",
    missing:
      "Some published boundaries do not match the current inventory and are hidden.",
    stale:
      "Inventory may be out of date. Confirm plot details before proceeding.",
    legend: "Plot status",
    available: "Available",
    reserved: "Reserved",
    sold: "Sold",
    blocked: "Blocked",
    unverified: "Unverified",
  },
  hi: {
    title: "गूगल नक्शा",
    plan: "प्लान पर लौटें",
    fit: "पूरा स्थल दिखाएँ",
    roadmap: "रोडमैप",
    hybrid: "हाइब्रिड",
    loading: "गूगल नक्शा लोड हो रहा है…",
    loadingGeometry: "प्रकाशित सीमाएँ लोड हो रही हैं…",
    disabled: "गूगल नक्शा कॉन्फ़िगर नहीं है या बंद है। प्लान देखें।",
    bounds: "स्थल की भौगोलिक सीमा उपलब्ध नहीं है। प्लान देखें।",
    network: "गूगल नक्शा लोड नहीं हुआ। इंटरनेट जाँचें और फिर प्रयास करें।",
    timeout: "गूगल नक्शा लोड होने में अधिक समय लगा। फिर प्रयास करें।",
    auth: "गूगल नक्शे का प्राधिकरण विफल हुआ। व्यवस्थापक से API कुंजी, बिलिंग और वेबसाइट प्रतिबंध जाँचने को कहें, फिर पेज दोबारा लोड करें।",
    reload: "पेज दोबारा लोड करें",
    retry: "फिर प्रयास करें",
    geometry:
      "सीमाएँ उपलब्ध नहीं हैं। सभी प्लॉट सीमाएँ हटा दी गई हैं। फिर प्रयास करें या प्लान देखें।",
    provisional: "अस्थायी सीमाएँ",
    provisionalNote:
      "अस्वीकृत प्लान की सीमाएँ अनुमानित हैं; ये प्रकाशित या सर्वेक्षित सीमाएँ नहीं हैं।",
    official: "प्रकाशित सीमाएँ",
    missing:
      "कुछ प्रकाशित सीमाएँ वर्तमान सूची से मेल नहीं खातीं और छिपाई गई हैं।",
    stale:
      "प्लॉट सूची पुरानी हो सकती है। आगे बढ़ने से पहले विवरण की पुष्टि करें।",
    legend: "प्लॉट स्थिति",
    available: "उपलब्ध",
    reserved: "आरक्षित",
    sold: "बिका हुआ",
    blocked: "अवरुद्ध",
    unverified: "असत्यापित",
  },
};
const buttonStyle = { minHeight: 44, padding: "8px 12px" };
function clearLayer(layer) {
  layer?.forEach((feature) => layer.remove(feature));
}

export default function GoogleMapView({
  data,
  plots = [],
  selected,
  visibleIds,
  onSelect,
  onExit,
  hindi = false,
  stale = false,
  visitorAccess = null,
  onAccessSelect,
  structures = [],
  onStructureSelect,
}) {
  const text = copy[hindi ? "hi" : "en"];
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  const enabled =
    import.meta.env.VITE_GOOGLE_MAPS_ENABLED === "true" && Boolean(key?.trim());
  const boundsKey = JSON.stringify(siteBounds(data));
  const container = useRef(null),
    mapRef = useRef(null),
    layerRef = useRef(null),
    selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [ready, setReady] = useState(false),
    [failure, setFailure] = useState(null),
    [retry, setRetry] = useState(0);
  const [collection, setCollection] = useState(null),
    [geometryError, setGeometryError] = useState(false),
    [mapType, setMapType] = useState("roadmap");
  const locationRequest = useRef(null);
  const [device, setDevice] = useState({ status: "idle" });

  useEffect(() => {
    if (!ready) return;
    const request = createLocationRequest({
      geolocation: navigator.geolocation,
      secureContext: window.isSecureContext,
      onChange: (state) => {
        setDevice(state);
        if (state.position)
          mapRef.current?.panTo({
            lat: state.position.lat,
            lng: state.position.lng,
          });
      },
    });
    locationRequest.current = request;
    const hide = () => {
      if (document.hidden) {
        request.cancel();
        setDevice({ status: "idle" });
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      request.cancel();
      locationRequest.current = null;
      document.removeEventListener("visibilitychange", hide);
    };
  }, [ready]);
  useEffect(() => {
    if (!ready || !device.position) return;
    const { lat, lng, accuracy, timestamp } = device.position;
    const maps = window.google.maps,
      center = { lat, lng };
    const uncertainty = new maps.Circle({
      map: mapRef.current,
      center,
      radius: accuracy,
      clickable: false,
      fillColor: "#2463a0",
      fillOpacity: 0.12,
      strokeColor: "#2463a0",
      strokeOpacity: 0.6,
      strokeWeight: 1,
    });
    const marker = new maps.Circle({
      map: mapRef.current,
      center,
      radius: 3,
      clickable: false,
      fillColor: "#2463a0",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
      zIndex: 10,
    });
    const timer = setTimeout(
      () => setDevice({ status: "stale" }),
      Math.max(0, 60000 - (Date.now() - timestamp)),
    );
    return () => {
      clearTimeout(timer);
      uncertainty.setMap(null);
      marker.setMap(null);
    };
  }, [ready, device]);
  useEffect(() => {
    if (!ready || !visitorAccess) return;
    const point = visitorAccess.physicalAnchor || visitorAccess.routeAccess;
    if (!point) return;
    const layer = new window.google.maps.Data();
    const features = [
      ...(visitorAccess.footprint ? [{
        type: "Feature",
        id: "visitor-entrance",
        properties: { featureType: "entrance-footprint" },
        geometry: { type: "Polygon", coordinates: [visitorAccess.footprint.outer, ...visitorAccess.footprint.holes] },
      }] : []),
      {
        type: "Feature",
        id: "visitor-entrance-anchor",
        properties: { featureType: "entrance-anchor" },
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      },
    ];
    layer.addGeoJson({
      type: "FeatureCollection",
      features,
    });
    layer.setStyle({
      title: visitorAccess.physicalAnchor
        ? "Reviewed physical entrance anchor"
        : "Reviewed route-access point",
      clickable: true,
      fillColor: "#8257b8",
      fillOpacity: 0.45,
      strokeColor: "#533082",
      zIndex: 5,
    });
    const click = layer.addListener("click", () => onAccessSelect?.());
    layer.setMap(mapRef.current);
    return () => {
      click?.remove();
      clearLayer(layer);
      layer.setMap(null);
    };
  }, [ready, visitorAccess, onAccessSelect]);

  useEffect(() => {
    if (!ready || !structures.length) return;
    const layer = new window.google.maps.Data();
    layer.addGeoJson({ type: "FeatureCollection", features: structures.map((item) => ({
      type: "Feature", id: item.id, properties: { featureType: "structure" },
      geometry: { type: "Polygon", coordinates: [item.published.footprint.outer, ...item.published.footprint.holes] },
    })) });
    layer.setStyle({ clickable: true, fillColor: "#66879c", fillOpacity: 0.45, strokeColor: "#33596f", zIndex: 4 });
    const click = layer.addListener("click", (event) => onStructureSelect?.(event.feature.getId()));
    layer.setMap(mapRef.current);
    return () => { click?.remove(); clearLayer(layer); layer.setMap(null); };
  }, [ready, structures, onStructureSelect]);

  useEffect(() => {
    if (!enabled || boundsKey === "null") return;
    const controller = new AbortController();
    let map,
      layer,
      click,
      failed = false;
    setFailure(null);
    setReady(false);
    const fail = (error) => {
      if (controller.signal.aborted) return;
      failed = true;
      clearLayer(layer);
      layer?.setMap(null);
      setReady(false);
      setCollection(null);
      setFailure(error.code || "network");
    };
    loadGoogleMaps({ key, signal: controller.signal, onAuthFailure: fail })
      .then((maps) => {
        if (controller.signal.aborted || failed) return;
        try {
          map = new maps.Map(container.current, {
            mapTypeId: "roadmap",
            mapTypeControl: false,
            streetViewControl: false,
            gestureHandling: "cooperative",
            keyboardShortcuts: true,
          });
          layer = new maps.Data();
          layer.setMap(map);
          mapRef.current = map;
          layerRef.current = layer;
          click = layer.addListener("click", (event) => {
            const id = event.feature.getId();
            if (typeof id === "string") selectRef.current?.(id);
          });
          map.fitBounds(JSON.parse(boundsKey));
          setMapType("roadmap");
          setReady(true);
        } catch (error) {
          fail(error);
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError") fail(error);
      });
    return () => {
      controller.abort();
      click?.remove();
      clearLayer(layer);
      layer?.setMap(null);
      if (map) window.google?.maps?.event?.clearInstanceListeners(map);
      if (layer) window.google?.maps?.event?.clearInstanceListeners(layer);
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [enabled, key, boundsKey, retry]);

  useEffect(() => {
    if (!ready) return;
    let active = true,
      request,
      requestTimeout;
    async function refresh() {
      window.clearTimeout(requestTimeout);
      request?.abort();
      const current = new AbortController();
      request = current;
      const timeout = (requestTimeout = window.setTimeout(() => {
        if (!active || request !== current) return;
        current.abort();
        clearLayer(layerRef.current);
        setCollection(null);
        setGeometryError(true);
      }, 12000));
      try {
        const response = await fetch("/api/public/geometry", {
          signal: current.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw Error("geometry");
        const result = await response.json();
        if (
          result?.type !== "FeatureCollection" ||
          !Array.isArray(result.features)
        )
          throw Error("geometry");
        if (!active || request !== current || current.signal.aborted) return;
        setCollection(result);
        setGeometryError(false);
      } catch {
        if (!active || request !== current || current.signal.aborted) return;
        clearLayer(layerRef.current);
        setCollection(null);
        setGeometryError(true);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      request?.abort();
      window.clearTimeout(requestTimeout);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [ready, retry]);

  const model = useMemo(() => {
    if (!collection) return { type: "FeatureCollection", features: [] };
    try {
      return buildMapFeatures(
        collection,
        plots,
        data,
        pathToGeographicGeometry,
      );
    } catch {
      return null;
    }
  }, [collection, plots, data]);
  useEffect(() => {
    const layer = layerRef.current;
    if (!ready || !layer) return;
    clearLayer(layer);
    if (model) {
      try {
        layer.addGeoJson(model);
      } catch {
        clearLayer(layer);
        setGeometryError(true);
      }
    } else setGeometryError(true);
  }, [ready, model]);
  useEffect(() => {
    if (!ready) return;
    // Data preserves GeoJSON inner rings and MultiPolygons. Native attribution
    // and controls remain Google's: https://developers.google.com/maps/documentation/javascript/datalayer
    layerRef.current?.setStyle((feature) => {
      const id = feature.getId(),
        isSelected = id === selected;
      return {
        visible: !visibleIds || visibleIds.has(id),
        clickable: !visibleIds || visibleIds.has(id),
        fillColor: colors[feature.getProperty("status")] || colors.unverified,
        fillOpacity: feature.getProperty("provisional") ? 0.2 : 0.45,
        strokeColor: isSelected
          ? "#102b49"
          : colors[feature.getProperty("status")] || colors.unverified,
        strokeOpacity: 1,
        strokeWeight: isSelected ? 4 : 2,
        zIndex: isSelected ? 2 : 1,
      };
    });
  }, [ready, model, selected, visibleIds]);

  const error = !enabled
    ? "disabled"
    : boundsKey === "null"
      ? "bounds"
      : failure;
  const provisional = model?.features.some(
    (feature) => feature.properties.provisional,
  );
  const missing =
    collection &&
    model &&
    plots.some(
      (plot) =>
        plot.approved &&
        !model.features.some((feature) => feature.id === plot.id),
    );
  const changeType = (type) => {
    mapRef.current?.setMapTypeId(type);
    setMapType(type);
  };
  return (
    <section
      aria-label={text.title}
      lang={hindi ? "hi" : "en"}
      style={{ width: "100%", minWidth: 0 }}
    >
      <div
        role="group"
        aria-label={text.title}
        style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8 }}
      >
        <button type="button" style={buttonStyle} onClick={onExit}>
          {text.plan}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!ready || Boolean(error)}
          onClick={() => mapRef.current?.fitBounds(JSON.parse(boundsKey))}
        >
          {text.fit}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!ready || Boolean(error)}
          aria-pressed={mapType === "roadmap"}
          onClick={() => changeType("roadmap")}
        >
          {text.roadmap}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!ready || Boolean(error)}
          aria-pressed={mapType === "hybrid"}
          onClick={() => changeType("hybrid")}
        >
          {text.hybrid}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 8 }}>
        <button
          type="button"
          style={buttonStyle}
          disabled={!ready || Boolean(error) || device.status === "requesting"}
          onClick={() => locationRequest.current?.request()}
        >
          {hindi ? "मेरा स्थान" : "My location"}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={device.status === "idle"}
          onClick={() => {
            locationRequest.current?.cancel();
            setDevice({ status: "idle" });
          }}
        >
          {hindi ? "स्थान हटाएँ" : "Clear location"}
        </button>
      </div>
      <p role="status" aria-live="polite" data-testid="location-status">
        {device.position
          ? `${hindi ? "ब्राउज़र की अनुमानित सटीकता" : "Browser-reported accuracy"}: ${Math.ceil(device.position.accuracy)} m. ${locationRelativeToBounds(device.position, siteBounds(data)) === "off-site" ? (hindi ? "रिपोर्ट किया गया बिंदु स्थल सीमा के बाहर है।" : "The reported point is outside the site extent.") : hindi ? "यह किसी प्लॉट पर उपस्थिति का प्रमाण नहीं है।" : "This does not establish presence on a parcel."}`
          : device.status === "idle"
            ? hindi
              ? "स्थान केवल बटन दबाने पर माँगा जाएगा।"
              : "Location is requested only when you press My location."
            : hindi
              ? {
                  requesting: "स्थान माँगा जा रहा है…",
                  denied: "स्थान की अनुमति नहीं मिली। ब्राउज़र सेटिंग जाँचें।",
                  timeout: "स्थान अनुरोध का समय समाप्त हुआ। फिर प्रयास करें।",
                  unavailable: "स्थान उपलब्ध नहीं है।",
                  unsupported: "ब्राउज़र स्थान सुविधा उपलब्ध नहीं है।",
                  insecure: "स्थान के लिए HTTPS आवश्यक है।",
                  stale: "स्थान पुराना है। नया स्थान माँगें।",
                  invalid: "स्थान की जानकारी अमान्य है।",
                }[device.status] || "स्थान उपलब्ध नहीं है।"
              : device.status === "requesting"
                ? "Requesting your location…"
                : device.error || "Location is stale. Request a new position."}
        {device.status === "inaccurate" &&
          (hindi
            ? " सटीकता कम है; प्लॉट की पहचान नहीं की जा सकती।"
            : " Low accuracy; this cannot identify a parcel.")}
      </p>
      {visitorAccess && (
        <p>
          <a
            href={directionsUrl(visitorAccess)}
            target="_blank"
            rel="noreferrer"
          >
            {hindi
              ? "समीक्षित प्रवेश मार्ग के दिशा-निर्देश"
              : "Directions to reviewed visitor access"}
          </a>{" "}
          · {hindi ? "प्रवेश चिह्न" : "Entrance pin"}:{" "}
          {visitorAccess.physicalAnchor
            ? hindi
              ? "भौतिक प्रवेश आधार"
              : "physical anchor"
            : hindi
              ? "मार्ग प्रवेश बिंदु"
              : "route-access point"}
        </p>
      )}
      <p>
        {hindi
          ? "गूगल दृश्य खोलने पर मानचित्र प्रदाता से संपर्क होता है। आपका स्थान इस सुविधा की मेमोरी में रहता है; इसे फ़ॉर्म या संग्रह में नहीं जोड़ा जाता। पृष्ठ छिपने या दृश्य बंद होने पर स्थान हटा दिया जाता है।"
          : "Opening this basemap contacts Google. This feature keeps your location in memory and does not attach it to forms or storage. Location is cleared when the page is hidden or this view closes."}
      </p>
      {error && (
        <div role="alert">
          <p>{error === "reload" ? text.auth : text[error] || text.network}</p>
          {enabled && boundsKey !== "null" && (
            <button
              type="button"
              style={buttonStyle}
              onClick={() =>
                error === "auth" || error === "reload"
                  ? window.location.reload()
                  : setRetry((value) => value + 1)
              }
            >
              {error === "auth" || error === "reload"
                ? text.reload
                : text.retry}
            </button>
          )}
        </div>
      )}
      {!error && !ready && <p role="status">{text.loading}</p>}
      {stale && <p role="status">{text.stale}</p>}
      {!error && (geometryError || !model) && (
        <div role="alert">
          <p>{text.geometry}</p>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => setRetry((value) => value + 1)}
          >
            {text.retry}
          </button>
        </div>
      )}
      {!error && ready && !collection && !geometryError && (
        <p role="status">{text.loadingGeometry}</p>
      )}
      {!error && missing && <p role="status">{text.missing}</p>}
      {!error && provisional && (
        <p>
          <strong>{text.provisional}</strong>: {text.provisionalNote}
        </p>
      )}
      {!error && ready && (
        <p>
          {text.official} · {text.legend}:{" "}
          {Object.keys(colors)
            .map((status) => text[status])
            .join(" · ")}
        </p>
      )}
      <div
        ref={container}
        aria-label={text.title}
        hidden={Boolean(error)}
        style={{ width: "100%", height: "min(65vh, 640px)", minHeight: 320 }}
      />
    </section>
  );
}
