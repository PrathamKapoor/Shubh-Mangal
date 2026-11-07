import React, { useEffect, useRef } from "react";
import { areaLabel, metres, formatNumber } from "../../shared/domain.mjs";
export default function PlotDetails({
  plot,
  units,
  setUnits,
  areaUnit,
  setAreaUnit,
  saved,
  onSave,
  onCompare,
  compared,
  onFocus,
  onClose,
  onBackToExplorer,
  onContact,
  notify,
  language = "en",
  documents = [],
}) {
  const hi = language === "hi";
  const detailPanel = useRef(null);
  useEffect(() => {
    if (plot && window.matchMedia("(max-width: 700px)").matches)
      detailPanel.current?.focus({ preventScroll: true });
  }, [plot?.id]);
  if (!plot)
    return (
      <aside className="details empty-detail">
        <span className="line-icon">⌖</span>
        <span className="eyebrow">THE DETAILS MATTER</span>
        <h2>
          {hi
            ? "अपनी अगली शुरुआत को करीब से देखें।"
            : "A little closer to your next chapter."}
        </h2>
        <p>
          {hi
            ? "नक्शे पर आकृति चुनें या सूची में नंबर खोजें। विवरण यहाँ दिखेगा।"
            : "Select a shape on the plan or find a number in the list. Its details will appear here."}
        </p>
        <div className="note">
          Plan labels are references. Plot identity and availability require
          owner confirmation.
        </div>
      </aside>
    );
  const known = plot.approved;
  const linkedDocuments = documents.filter((document) =>
    known?.documentIds?.includes(document.id),
  );
  async function share() {
    const url = new URL(location.href);
    url.pathname = known ? `/plots/${plot.id}` : "/explore";
    url.search = "";
    if (!known) url.searchParams.set("plot", plot.id);
    try {
      await navigator.clipboard.writeText(url.href);
      notify(
        known
          ? "Plot link copied."
          : "Plan reference link copied. It may change after owner review.",
      );
    } catch {
      notify(`Copy this link: ${url.href}`);
    }
  }
  return (
    <aside
      ref={detailPanel}
      tabIndex={-1}
      className="details selected-detail"
      aria-label="Selected plot details"
    >
      <div className="detail-top">
        <span className="eyebrow">
          {known ? `Block ${plot.block}` : `Plan area ${plot.block}`}
        </span>
        <button
          aria-label={hi ? "प्लॉट विवरण बंद करें" : "Close plot details"}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <h2>
        {known ? (hi ? "प्लॉट" : "Plot") : hi ? "योजना नंबर" : "Plan label"}{" "}
        {plot.identityReviewRequired ? "cell" : plot.label}
      </h2>
      <div className={`badge status-${plot.status}`}>
        {plot.status === "unverified"
          ? hi
            ? "उपलब्धता की पुष्टि बाकी"
            : "Availability unverified"
          : hi
            ? {
                available: "उपलब्ध (पुष्टि हुई)",
                reserved: "आरक्षित",
                sold: "विक्रय हुआ",
                blocked: "अवरुद्ध",
              }[plot.status] || plot.status
            : `Verified ${plot.status}`}
      </div>
      {!known && (
        <p className="warning">
          {hi ? (
            "इस नंबर की पुष्टि बाकी है। सभी माप नक्शे से अनुमानित हैं।"
          ) : (
            <>
              {plot.identityReviewRequired
                ? "This plot number needs confirmation."
                : "This number is awaiting owner confirmation."}{" "}
              All dimensions are map-derived estimates.
            </>
          )}
        </p>
      )}
      {plot.identityReviewRequired && (
        <p className="small">
          Source candidates: {plot.labelCandidates.join(", ") || "None"}
        </p>
      )}
      <div className="area-value">{areaLabel(plot, areaUnit)}</div>
      <label className="inline-label">
        {hi ? "क्षेत्रफल की इकाई" : "Area unit"}
        <select value={areaUnit} onChange={(e) => setAreaUnit(e.target.value)}>
          <option value="sqft">{hi ? "वर्ग फुट" : "Square feet"}</option>
          <option value="sqm">{hi ? "वर्ग मीटर" : "Square metres"}</option>
          <option value="sqyd">{hi ? "वर्ग गज" : "Square yards"}</option>
        </select>
      </label>
      <div className="unit-toggle" role="group" aria-label="Length units">
        <button aria-pressed={units === "ft"} onClick={() => setUnits("ft")}>
          {hi ? "फुट" : "Feet"}
        </button>
        <button aria-pressed={units === "m"} onClick={() => setUnits("m")}>
          {hi ? "मीटर" : "Metres"}
        </button>
      </div>
      <h3>{hi ? "आकृति और भुजाओं की लंबाई" : "Shape & side lengths"}</h3>
      <p className="small">
        {hi
          ? "भुजा नंबर नक्शे के हैं; सामने की दिशा की पुष्टि नहीं मानें। सभी माप नीचे दिए हैं।"
          : "Edge numbers describe this drawing, not a verified frontage. A missing overlay label is available below."}
      </p>
      <div className="edge-list">
        {plot.edges.map((edge, i) => {
          const verified = known?.dimensions.find((d) => d.edgeIndex === i);
          return (
            <div key={i}>
              <span>{verified?.name || `Edge ${i + 1}`}</span>
              <b>
                {verified ? "Verified" : "Approx."}{" "}
                {formatNumber(metres(verified?.metres ?? edge.metres, units))}{" "}
                {units}
              </b>
            </div>
          );
        })}
        {known?.dimensions
          .filter((d) => d.edgeIndex == null)
          .map((d, i) => (
            <div key={`v${i}`}>
              <span>{d.name}</span>
              <b>
                Verified {formatNumber(metres(d.metres, units))} {units}
              </b>
            </div>
          ))}
      </div>
      <dl className="facts">
        {known?.phase && (
          <div>
            <dt>Phase</dt>
            <dd>{known.phase}</dd>
          </div>
        )}
        {known?.corner != null && (
          <div>
            <dt>Corner plot</dt>
            <dd>Verified {known.corner ? "Yes" : "No"}</dd>
          </div>
        )}
        {known?.parkFacing != null && (
          <div>
            <dt>Park-facing</dt>
            <dd>Verified {known.parkFacing ? "Yes" : "No"}</dd>
          </div>
        )}
        {plot.updatedAt && (
          <div>
            <dt>{hi ? "रिकॉर्ड अद्यतन" : "Record updated"}</dt>
            <dd>
              {new Date(plot.updatedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}{" "}
              IST
            </dd>
          </div>
        )}
        {plot.statusUpdatedAt && (
          <div>
            <dt>{hi ? "स्थिति अद्यतन" : "Status updated"}</dt>
            <dd>
              {new Date(plot.statusUpdatedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}{" "}
              IST
            </dd>
          </div>
        )}
        <div>
          <dt>{hi ? "सड़क की चौड़ाई" : "Road width"}</dt>
          <dd>
            {known?.roadWidthMetres
              ? `Verified ${formatNumber(metres(known.roadWidthMetres, units))} ${units}`
              : hi
                ? "जानकारी उपलब्ध नहीं"
                : "Not provided"}
          </dd>
        </div>
        <div>
          <dt>{hi ? "दिशा" : "Facing"}</dt>
          <dd>
            {known?.facing
              ? `Verified ${known.facing}`
              : hi
                ? "जानकारी उपलब्ध नहीं"
                : "Not provided"}
          </dd>
        </div>
        <div>
          <dt>{hi ? "प्लॉट का प्रकार" : "Plot type"}</dt>
          <dd>
            {known?.plotType && known.plotType !== "not_provided"
              ? known.plotType
              : hi
                ? "जानकारी उपलब्ध नहीं"
                : "Not provided"}
          </dd>
        </div>
        <div>
          <dt>{hi ? "जाँच की तारीख" : "Verified on"}</dt>
          <dd>
            {plot.verifiedAt
              ? new Date(plot.verifiedAt).toLocaleDateString("en-IN")
              : hi
                ? "जाँच बाकी"
                : "Awaiting review"}
          </dd>
        </div>
        {plot.priceINR != null && (
          <div>
            <dt>Published price</dt>
            <dd>₹{formatNumber(plot.priceINR)}</dd>
          </div>
        )}
      </dl>
      {linkedDocuments.length > 0 && (
        <section className="plot-documents">
          <h3>{hi ? "इस प्लॉट के दस्तावेज़" : "Documents for this plot"}</h3>
          {linkedDocuments.map((document) => (
            <p key={document.id}>
              <a href={document.published.url} target="_blank" rel="noreferrer">
                {document.published.title} ↗
              </a>{" "}
              <small>· {document.published.revision}</small>
            </p>
          ))}
        </section>
      )}
      <div className="detail-actions">
        {onBackToExplorer && (
          <button onClick={onBackToExplorer}>
            Back to this plot in explorer
          </button>
        )}
        <button className="primary" onClick={() => onContact("enquiry", plot)}>
          {hi ? "इस प्लॉट के बारे में पूछें" : "Enquire about this plot"} ↗
        </button>
        <button onClick={() => onContact("visit", plot)}>
          {hi ? "भ्रमण का अनुरोध" : "Request a visit"}
        </button>
        <button aria-pressed={saved} onClick={onSave}>
          {saved
            ? hi
              ? "♥ सूची में है"
              : "♥ Shortlisted"
            : hi
              ? "♡ सूची में जोड़ें"
              : "♡ Shortlist"}
        </button>
        <button aria-pressed={compared} onClick={onCompare}>
          {compared
            ? hi
              ? "तुलना से हटाएँ"
              : "Remove comparison"
            : hi
              ? "＋ तुलना करें"
              : "＋ Compare"}
        </button>
        <button onClick={onFocus}>{hi ? "प्लॉट पर जाएँ" : "Focus plot"}</button>
        <button onClick={share}>
          {hi ? "प्लॉट लिंक कॉपी करें" : "Copy plot link"}
        </button>
      </div>
      <details className="provenance">
        <summary>Source & verification details</summary>
        <p>
          This shape is based on the supplied plan. Boundaries and map-derived
          measurements are approximate.
        </p>
        <p>
          Projection: UTM 43N. Approximate geometry area:{" "}
          {formatNumber(plot.areaSqMApprox)} m².
        </p>
        {known && (
          <p>
            Reviewed reference: {known.sourceDocument}, revision{" "}
            {known.sourceRevision}. Original area:{" "}
            {known.areaSourceText || "Not provided"}. Verification applies to
            the supplied fields, not legal title.
          </p>
        )}
        <a href="/documents">Compare with source documents ↗</a>
      </details>
    </aside>
  );
}
