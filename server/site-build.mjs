import { hash } from "./auth.mjs";
export function buildIdentity(selected) {
  return { version: 1, digest: hash(JSON.stringify({ source: selected.source, revision: selected.revision })) };
}
export function assertBuildIdentity(manifest, selected) {
  const expected = buildIdentity(selected);
  if (manifest?.version !== expected.version || manifest?.digest !== expected.digest)
    throw new Error("Browser build does not match the selected site source and layout revision; build with the same SITE_SOURCE_CONFIG");
}
