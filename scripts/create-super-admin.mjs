// Create (or reset) a SUPER_ADMIN account directly in Mongo — the DB-only
// bootstrap for the first admin. Prints a one-time random password;
// change it after first login via the user detail page.
//
// Usage: node scripts/create-super-admin.mjs [username]
//   e.g. node scripts/create-super-admin.mjs super.admin
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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

const username = process.argv[2] || 'super.admin';
const candidates = [
  process.env.MONGODB_URI,
  'mongodb://app:devpasswordchange@localhost:27017/wmams?replicaSet=rs0&readPreference=primary',
  'mongodb://127.0.0.1:27017/wmams?directConnection=true',
].filter(Boolean);

let connected = '';
for (const uri of candidates) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    connected = uri.replace(/:[^:@/]+@/, ':***@');
    break;
  } catch {}
  await mongoose.disconnect().catch(() => {});
}
if (!connected) {
  console.error('CREATE-FAILED: no Mongo reachable.');
  process.exit(1);
}
console.log('connected:', connected);

// One-time random password (20 chars). It is printed below exactly once —
// it is never written to any file. Change it after first login.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
const bytes = randomBytes(20);
let password = '';
for (const b of bytes) password += alphabet[b % alphabet.length];

const users = mongoose.connection.db.collection('users');
const doc = {
  username,
  name: 'System Administrator',
  nameEn: 'System Administrator',
  unit: 'PMO',
  unitId: 'pmo',
  scopeUnitIds: ['pmo'],
  orgUnitId: 'pmo',
  orgAncestors: ['pmo'],
  orgPath: 'pmo',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  mfa: true,
  mobile: '',
  passwordHash: hashPassword(password),
  archivedAt: null,
};
await users.updateOne({ username }, { $set: doc }, { upsert: true });
console.log(`SUPER_ADMIN ready: ${username} (role=SUPER_ADMIN, status=ACTIVE)`);
console.log(`ONE-TIME PASSWORD for ${username}: ${password}`);
console.log('Log in with it, then change it immediately via the user detail page.');
await mongoose.disconnect();
console.log('CREATE-DONE');
