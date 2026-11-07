import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HttpError } from "./inventory.mjs";

// Files are content-addressed and private until published content references them.
// Only raster formats are accepted; SVG, HTML, model files and active content are excluded.
export async function stageImage(directory, bytes, claimedType) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 12 ||
    bytes.length > 2 * 1024 * 1024
  )
    throw new HttpError(422, "Choose a PNG, JPEG or WebP image under 2 MB");
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const ext = png ? "png" : jpeg ? "jpg" : webp ? "webp" : null;
  const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[ext];
  if (!ext || claimedType !== type)
    throw new HttpError(422, "Image format does not match its contents");
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  try {
    await writeFile(resolve(directory, name), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return { name, url: `/api/public/media/${name}`, type, size: bytes.length };
}
export function mediaFile(directory, name) {
  if (!/^[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(name))
    throw new HttpError(404, "Image not found");
  return resolve(directory, name);
}
