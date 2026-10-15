// Legacy seeder: loads infra/seed/data/*.json into Mongo (one file per
// collection). Collection data is DB-only now — the fixture directory is
// intentionally empty and this script no-ops. Kept for compatibility in
// case fixtures are reintroduced.
// Usage: MONGODB_URI=mongodb://... node scripts/seed.mjs [--replace]
import mongoose from 'mongoose';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { getModel } from '../src/lib/models.js';
import { hashPassword } from '../src/lib/password.js';

// Plain `node` does not load .env.local (unlike `next`), so read it here.
// An already-exported environment variable still takes precedence.
try {
  const envFile = join(process.cwd(), '.env.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && !(k in process.env)) process.env[k] = v;
    }
  }
} catch {}

const candidates = [
  process.env.MONGODB_URI,
  'mongodb://app:devpasswordchange@localhost:27017/wmams?replicaSet=rs0&readPreference=primary'
].filter(Boolean);
const replace = process.argv.includes('--replace');
const dir = join(process.cwd(), 'infra', 'seed', 'data');

let connected = '';
for (const uri of candidates) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    connected = uri;
    break;
  } catch {}
  await mongoose.disconnect().catch(() => {});
}
if (!connected) {
  console.error('SEED-FAILED: no Mongo reachable. Tried:');
  for (const u of candidates) console.error(' -', u.replace(/:[^:@/]+@/, ':***@'));
  console.error('Start one:  docker compose -f infra/docker/docker-compose.dev.yml up -d');
  console.error('Or install MongoDB Community (runs on 127.0.0.1:27017), then re-run npm run seed.');
  console.error('Or point elsewhere:  $env:MONGODB_URI="mongodb+srv://..."; npm run seed');
  process.exit(1);
}
console.log('connected:', connected.replace(/:[^:@/]+@/, ':***@'));
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const col = basename(f, '.json');
  const M = getModel(col);
  if (!M) { console.log('skip (no model)', col); continue; }
  const docs = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (replace) await M.deleteMany({});
  // Users: `password` is plaintext in seed only — hash to passwordHash and
  // never store it raw. Per-username upsert keeps this idempotent, so plain
  // `npm run seed` backfills passwords onto an existing database too.
  if (col === 'users') {
    if (replace) await M.deleteMany({});
    let pwCount = 0;
    for (const d of docs) {
      const { password, ...rest } = d;
      const doc = { ...rest };
      if (password) { doc.passwordHash = hashPassword(password); pwCount++; }
      await M.updateOne({ username: doc.username }, { $set: doc }, { upsert: true });
    }
    console.log(col, await M.countDocuments(), `(passwords set: ${pwCount})`);
    continue;
  }
  if (docs.length) await M.insertMany(docs, { ordered: false }).catch((e) => console.log(col, 'partial:', e.message));
  console.log(col, await M.countDocuments());
}
await mongoose.disconnect();
console.log('SEED-DONE');
