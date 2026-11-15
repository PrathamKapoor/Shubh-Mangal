import { api } from "./api.js";

function validSnapshot(value) {
  return value && value.project && Array.isArray(value.project.items) && Array.isArray(value.plots) && value.geometry?.type === "FeatureCollection" && Array.isArray(value.geometry.features);
}

// The caller owns scheduling and UI state. Only a complete current response
// reaches onSnapshot; failure leaves the previously committed data intact.
export function createPublicRefresh({ load = (signal) => api("/public/snapshot", { signal }), onSnapshot, onFailure, onStart = () => {}, timeoutMs = 12000 }) {
  let active = true, request;
  async function refresh() {
    request?.abort();
    const current = new AbortController();
    request = current;
    let timer, cancelled;
    try {
      onStart();
      const result = await Promise.race([
        Promise.resolve().then(() => load(current.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(Error("Public snapshot timed out")); current.abort(); }, timeoutMs); }),
        new Promise((resolve) => { cancelled = () => resolve(null); current.signal.addEventListener("abort", cancelled, { once: true }); }),
      ]);
      if (!active || request !== current || current.signal.aborted) return;
      if (!validSnapshot(result)) throw Error("Invalid public snapshot");
      onSnapshot(result);
    } catch {
      if (active && request === current) onFailure();
    } finally { clearTimeout(timer); current.signal.removeEventListener("abort", cancelled); }
  }
  return { refresh, dispose() { active = false; request?.abort(); } };
}
