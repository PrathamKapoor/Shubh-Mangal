import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
export const hash = (v) => createHash("sha256").update(v).digest("hex");
const derive = promisify(scrypt);
export async function passwordHash(value) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(value, salt, 64)).toString("hex")}`;
}
export async function checkPassword(value, encoded) {
  const [salt, key] = (encoded || "").split(":");
  if (!salt || !key) return false;
  const actual = await derive(value, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function createUser(
  db,
  { email, name, password, role = "owner" },
) {
  if (password.length < 14)
    throw Error("Use a password with at least 14 characters");
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [id, email.toLowerCase(), name, await passwordHash(password), role],
  );
  return id;
}
export async function audit(tx, actor, action, id, oldValue, newValue, reason) {
  await tx.query(
    "INSERT INTO audit_logs(id,actor_id,action,entity_id,old_value,new_value,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      actor?.id || null,
      action,
      id,
      JSON.stringify(oldValue ?? null),
      JSON.stringify(newValue ?? null),
      reason,
    ],
  );
}
