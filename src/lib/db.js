// Server-only MongoDB connection (Mongoose 8). Import ONLY in API routes /
// server code — never from client components.
import mongoose from "mongoose";
import { getEnv } from "./env";
import { ensureIndexes } from "./models";

let cached = globalThis.__wmams_mongoose;

if (!cached) {
  cached = globalThis.__wmams_mongoose = { conn: null, promise: null, uri: "" };
}

const LOCAL_FALLBACK = "mongodb://127.0.0.1:27017/wmams?directConnection=true"; // plain local mongod

// Never silently serve a DIFFERENT database: when an explicit remote URI
// (Atlas / replica set) is configured, a blip must surface as DB_UNAVAILABLE
// — not as phantom rows (e.g. a stale "pppp" test package) from local mongod
// appearing/disappearing across refreshes. The plain-local fallback applies
// only when the configured URI is itself local (dev default, nothing remote
// to protect).

export function connectedUri() {
  return cached.uri;
}

export async function dbConnect(uri) {
  if (typeof window !== "undefined") throw new Error("[db] imported on client");
  if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;
  if (!cached.promise) {
    const env = getEnv();
    const configured = uri || env.mongo.uri;
    const isLocal = /localhost|127\.0\.0\.1/i.test(String(configured || ""));
    // Remote configured → that database only (fail loudly on outage).
    // Local configured → also try plain local mongod (dev ergonomics).
    const candidates = [configured, ...(isLocal ? [LOCAL_FALLBACK] : [])].filter(Boolean);
    cached.promise = (async () => {
      let lastErr = null;
      for (const u of candidates) {
        try {
          // NOTE: default connection — models.js binds via mongoose.model().
          const m = await mongoose.connect(u, { bufferCommands: false, serverSelectionTimeoutMS: 5000 });
          cached.uri = u.replace(/:[^:@/]+@/, ":***@");
          cached.conn = m;
          await ensureIndexes();
          return m;
        } catch (e) {
          lastErr = e;
          await mongoose.disconnect().catch(() => {});
        }
      }
      // Never cache a failure: a transient blip (Atlas TLS hiccup, brief
      // network drop) must not poison every later request until restart.
      // Reset so the next API call retries the connection fresh.
      cached.promise = null;
      throw lastErr;
    })();
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
