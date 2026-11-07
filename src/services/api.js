export async function api(
  path,
  { method = "GET", body, csrf, key, signal } = {},
) {
  const r = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error(
      "The server is unavailable. Your information has not been sent.",
    );
  }
  if (!r.ok) {
    const e = Error(data.error || "Request failed");
    e.fields = data.fields;
    e.status = r.status;
    throw e;
  }
  return data;
}
export async function loadPublicInventory(signal) {
  const plots = [];
  let offset = 0,
    total;
  do {
    const page = await api(`/public/plots?limit=600&offset=${offset}`, {
      signal,
    });
    plots.push(...page.plots);
    total = page.total;
    if (!page.plots.length) break;
    offset += page.plots.length;
  } while (offset < total);
  // A refresh can overlap an owner's edit; never render a duplicated plot ID.
  return [...new Map(plots.map((p) => [p.id, p])).values()];
}
export function downloadJSON(value, name) {
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function loadStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
