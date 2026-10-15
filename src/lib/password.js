// Password hashing (server-only) — scrypt, no extra dependency.
// Stored format: scrypt$<saltHex>$<hashHex>. Importable from both Next.js
// server code and scripts/*.mjs (relative import only, no @/ alias).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    if (!password || !stored) return false;
    const [algo, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const derived = scryptSync(String(password), salt, KEYLEN);
    const expected = Buffer.from(hash, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
