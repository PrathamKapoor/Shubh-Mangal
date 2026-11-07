import React, { useRef, useState } from "react";
import { contactSchema } from "../../shared/domain.mjs";
import { api, downloadJSON } from "../services/api";
export default function ContactForm({
  plots,
  initialPlot,
  requestedPlotId = "",
  plotsLoading = false,
  connectionChecking = false,
  plotLoadError = "",
  onRetryPlots,
  kind = "enquiry",
  mode,
  language = "en",
}) {
  const [type, setType] = useState(kind),
    [values, setValues] = useState({
      name: "",
      phone: "",
      email: "",
      message: "",
      consent: false,
      website: "",
      language,
      preferredContact: "phone",
      plotIds:
        initialPlot?.id || requestedPlotId
          ? [initialPlot?.id || requestedPlotId]
          : [],
    }),
    [date, setDate] = useState(""),
    [time, setTime] = useState("10:00"),
    [errors, setErrors] = useState({}),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const retry = useRef({ key: crypto.randomUUID(), payload: "" });
  function clearFieldError(name) {
    setErrors((previous) => {
      if (!previous[name]) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }
  function field(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
    clearFieldError(name);
    setError("");
    setResult(null);
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    if (connectionChecking) {
      setError("Checking the connection. Please wait before submitting.");
      return;
    }
    const payload = {
      ...values,
      ...(type === "visit"
        ? {
            preferredAt:
              date && time
                ? new Date(`${date}T${time}:00+05:30`).toISOString()
                : undefined,
          }
        : {}),
    };
    const check = contactSchema.safeParse(payload);
    const issues = check.success
      ? {}
      : Object.fromEntries(
          check.error.issues.map((x) => [x.path[0], x.message]),
        );
    if (
      values.plotIds[0] &&
      !plots.some((plot) => plot.id === values.plotIds[0])
    ) {
      issues.plotIds = plotLoadError
        ? language === "hi"
          ? "प्लॉट सूची लोड नहीं हुई। पुनः प्रयास करें या सामान्य पूछताछ चुनें।"
          : "The plot list could not be loaded. Retry or choose a general enquiry."
        : plotsLoading
          ? language === "hi"
            ? "चुना प्लॉट लोड हो रहा है। कृपया प्रतीक्षा करें।"
            : "The selected plot is still loading. Please wait."
          : language === "hi"
            ? "चुना प्लॉट उपलब्ध नहीं है। दूसरा प्लॉट या सामान्य पूछताछ चुनें।"
            : "The selected plot is unavailable. Choose another plot or a general enquiry.";
    }
    if (
      type === "visit" &&
      (!payload.preferredAt || new Date(payload.preferredAt) <= new Date())
    )
      issues.preferredAt = "Choose a future visit date and time.";
    setErrors(issues);
    if (Object.keys(issues).length) {
      document.getElementById(`contact-${Object.keys(issues)[0]}`)?.focus();
      return;
    }
    if (mode === "offline") {
      downloadJSON(
        {
          ...payload,
          type,
          status: "LOCAL_DRAFT_NOT_SENT",
          createdAt: new Date().toISOString(),
        },
        "shubh-mangal-enquiry-draft.json",
      );
      setResult({
        message:
          "Draft downloaded to this device. Nothing was sent to the colony team.",
      });
      return;
    }
    const serialized = JSON.stringify({ ...payload, type });
    if (retry.current.payload !== serialized)
      retry.current = { key: crypto.randomUUID(), payload: serialized };
    setBusy(true);
    try {
      setResult(
        await api(type === "visit" ? "/visit-requests" : "/enquiries", {
          method: "POST",
          body: payload,
          key: retry.current.key,
        }),
      );
    } catch (err) {
      setError(err.message);
      setErrors(err.fields || {});
    } finally {
      setBusy(false);
    }
  }
  const hindi = language === "hi";
  const missingPlot =
    values.plotIds[0] && !plots.some((plot) => plot.id === values.plotIds[0]);
  return (
    <div className="contact-form">
      <div className="form-intro">
        <span className="eyebrow">LET’S TALK ABOUT YOUR PLANS</span>
        <h1>
          {hindi
            ? "आपकी नई शुरुआत, एक बातचीत से।"
            : "Your next step starts with a conversation."}
        </h1>
        <p>
          {hindi
            ? "भ्रमण का अनुरोध केवल रुचि दर्शाता है। तारीख और समय की पुष्टि टीम करेगी; इससे प्लॉट आरक्षित नहीं होता।"
            : "A visit request is an expression of interest. The team must confirm the date and time; it does not reserve a plot."}
        </p>
        <div className="note">
          {connectionChecking
            ? hindi
              ? "कनेक्शन की जाँच हो रही है…"
              : "Checking the connection…"
            : mode === "connected"
              ? hindi
                ? "आपका अनुरोध टीम के लिए सुरक्षित रूप से सहेजा जाएगा।"
                : "Your request will be saved securely for the team."
              : mode === "local-demo"
                ? hindi
                  ? "स्थानीय परीक्षण मोड: अनुरोध स्थानीय डेटाबेस में सहेजा जाएगा; कोई सूचना नहीं भेजी जाएगी।"
                  : "Local development mode. Requests are saved in the local database; no notification is sent."
                : hindi
                  ? "परीक्षण मोड: सर्वर उपलब्ध नहीं है। निजी प्रारूप डाउनलोड करें; कुछ भी नहीं भेजा जाएगा।"
                  : "Demo / local mode. The backend is unavailable. Download a private draft; nothing will be sent."}
        </div>
        <a href="/privacy">How your information is used ↗</a>
      </div>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={busy}>
          <legend className="sr-only">Contact details</legend>
          <label>
            {hindi ? "अनुरोध का प्रकार" : "Request type"}
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setResult(null);
              }}
            >
              <option value="enquiry">
                {hindi
                  ? "सामान्य / प्लॉट संबंधी पूछताछ"
                  : "General / plot enquiry"}
              </option>
              <option value="visit">
                {hindi ? "भ्रमण का अनुरोध" : "Visit request"}
              </option>
            </select>
          </label>
          <div className="form-grid">
            {[
              ["name", hindi ? "आपका नाम" : "Your name", "text"],
              ["phone", hindi ? "फ़ोन नंबर" : "Phone number", "tel"],
              [
                "email",
                hindi ? "ईमेल (वैकल्पिक)" : "Email (optional)",
                "email",
              ],
            ].map(([name, label, type]) => (
              <label key={name} htmlFor={`contact-${name}`}>
                {label}
                {name !== "email" ? " *" : ""}
                <input
                  id={`contact-${name}`}
                  name={name}
                  type={type}
                  autoComplete={
                    name === "name"
                      ? "name"
                      : name === "phone"
                        ? "tel"
                        : "email"
                  }
                  maxLength={name === "email" ? 254 : 100}
                  value={values[name]}
                  aria-invalid={!!errors[name]}
                  aria-describedby={errors[name] ? `error-${name}` : undefined}
                  onChange={(e) => field(name, e.target.value)}
                />
                {errors[name] && (
                  <span className="field-error" id={`error-${name}`}>
                    {errors[name]}
                  </span>
                )}
              </label>
            ))}
            <label>
              {hindi ? "पसंदीदा भाषा" : "Preferred language"}
              <select
                value={values.language}
                onChange={(e) => field("language", e.target.value)}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
              </select>
            </label>
            <label>
              {hindi ? "संपर्क का पसंदीदा तरीका" : "Preferred contact method"}
              <select
                value={values.preferredContact}
                onChange={(e) => field("preferredContact", e.target.value)}
              >
                <option value="phone">{hindi ? "फ़ोन" : "Phone"}</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">{hindi ? "ईमेल" : "Email"}</option>
              </select>
            </label>
          </div>
          <label>
            {hindi ? "चुना हुआ प्लॉट (वैकल्पिक)" : "Selected plot (optional)"}
            <select
              id="contact-plotIds"
              value={values.plotIds[0] || ""}
              aria-invalid={!!errors.plotIds}
              aria-describedby={
                errors.plotIds
                  ? "error-plotIds"
                  : missingPlot
                    ? "selected-plot-help"
                    : undefined
              }
              onChange={(e) =>
                field("plotIds", e.target.value ? [e.target.value] : [])
              }
            >
              <option value="">
                {hindi
                  ? "सामान्य पूछताछ — कोई प्लॉट नहीं चुना"
                  : "General enquiry — no plot selected"}
              </option>
              {missingPlot && (
                <option value={values.plotIds[0]} disabled>
                  {plotLoadError
                    ? hindi
                      ? "प्लॉट सूची लोड नहीं हुई"
                      : "Plot list could not be loaded"
                    : plotsLoading
                      ? hindi
                        ? "चुना प्लॉट लोड हो रहा है…"
                        : "Loading selected plot…"
                      : hindi
                        ? "चुना प्लॉट उपलब्ध नहीं है"
                        : "Selected plot is unavailable"}
                </option>
              )}
              {plots.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.approved ? "Plot" : "Plan label"} {p.label} · {p.block} ·{" "}
                  {p.status}
                </option>
              ))}
            </select>
          </label>
          {plotLoadError && (
            <div className="warning" role="alert">
              {hindi
                ? "प्लॉट सूची लोड नहीं हुई।"
                : "The plot list could not be loaded."}{" "}
              <button
                type="button"
                onClick={() => {
                  clearFieldError("plotIds");
                  onRetryPlots?.();
                }}
              >
                {hindi ? "पुनः प्रयास करें" : "Retry plot list"}
              </button>
            </div>
          )}
          {missingPlot && !errors.plotIds && (
            <p
              className={plotsLoading ? "small" : "field-error"}
              id="selected-plot-help"
              role={plotsLoading ? "status" : undefined}
            >
              {plotLoadError
                ? hindi
                  ? "पुनः प्रयास करें या सामान्य पूछताछ चुनें।"
                  : "Retry or choose a general enquiry."
                : plotsLoading
                  ? hindi
                    ? "चुना प्लॉट लोड हो रहा है…"
                    : "Loading selected plot…"
                  : hindi
                    ? "दूसरा प्लॉट या सामान्य पूछताछ चुनें।"
                    : "Choose another plot or a general enquiry."}
            </p>
          )}
          {errors.plotIds && (
            <p className="field-error" id="error-plotIds" role="alert">
              {errors.plotIds}
            </p>
          )}
          <p className="small">
            {mode === "offline" && !connectionChecking
              ? hindi
                ? "स्थानीय प्रारूप में प्लॉट की वर्तमान स्थिति की जाँच नहीं होती।"
                : "A local draft does not check the current plot status."
              : hindi
                ? "भेजते समय सर्वर वर्तमान स्थिति फिर जाँचेगा।"
                : "Current status is checked again by the server when you submit."}
          </p>
          {type === "visit" && (
            <div className="form-grid">
              <label>
                {hindi ? "पसंदीदा तारीख *" : "Preferred date *"}
                <input
                  id="contact-preferredAt"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    clearFieldError("preferredAt");
                  }}
                  aria-invalid={!!errors.preferredAt}
                  aria-describedby={
                    errors.preferredAt ? "error-preferredAt" : undefined
                  }
                />
              </label>
              <label>
                {hindi
                  ? "पसंदीदा समय · भारत (IST) *"
                  : "Preferred time · India (IST) *"}
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    clearFieldError("preferredAt");
                  }}
                />
              </label>
              {errors.preferredAt && (
                <p className="field-error" id="error-preferredAt">
                  {errors.preferredAt}
                </p>
              )}
            </div>
          )}
          <label>
            {hindi ? "संदेश (वैकल्पिक)" : "Message (optional)"}
            <textarea
              id="contact-message"
              rows="4"
              maxLength={2000}
              value={values.message}
              aria-invalid={!!errors.message}
              aria-describedby={errors.message ? "error-message" : undefined}
              onChange={(e) => field("message", e.target.value)}
            />
            {errors.message && (
              <span className="field-error" id="error-message">
                {errors.message}
              </span>
            )}
          </label>
          <div className="honeypot" aria-hidden="true">
            <label>
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={values.website}
                onChange={(e) => field("website", e.target.value)}
              />
            </label>
          </div>
          <label className="check" htmlFor="contact-consent">
            <input
              id="contact-consent"
              type="checkbox"
              checked={values.consent}
              onChange={(e) => field("consent", e.target.checked)}
              aria-invalid={!!errors.consent}
              aria-describedby={errors.consent ? "error-consent" : undefined}
            />{" "}
            {hindi
              ? "मैं इस पूछताछ या भ्रमण के बारे में संपर्क की सहमति देता/देती हूँ। *"
              : "I consent to being contacted about this enquiry or visit. *"}
          </label>
          {errors.consent && (
            <p className="field-error" id="error-consent">
              {errors.consent}
            </p>
          )}
          <button
            className="primary"
            disabled={busy || connectionChecking || !!result?.reference}
          >
            {busy
              ? hindi
                ? "सहेज रहे हैं…"
                : "Saving…"
              : connectionChecking
                ? hindi
                  ? "कनेक्शन की जाँच…"
                  : "Checking connection…"
                : mode === "offline"
                  ? hindi
                    ? "प्रारूप डाउनलोड करें"
                    : "Download local draft"
                  : type === "visit"
                    ? hindi
                      ? "भ्रमण का अनुरोध"
                      : "Request a visit"
                    : hindi
                      ? "पूछताछ भेजें"
                      : "Submit enquiry"}{" "}
            ↗
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="warning">
            {error} Your entered details are preserved; retry when ready.
          </p>
        )}
        {result && (
          <div role="status" className="success">
            <p>{result.message}</p>
            {result.reference && (
              <p>
                Reference: <b className="code-text">{result.reference}</b>
              </p>
            )}
            {result.status === "requested" && (
              <p>
                {hindi
                  ? "भ्रमण का अनुरोध दर्ज है — पुष्टि बाकी है।"
                  : "Visit status: Requested — awaiting confirmation."}
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
