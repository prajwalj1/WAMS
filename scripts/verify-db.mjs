import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'child_process';

// Dev-only runtime harness: in-memory Mongo on :27018, app on :3110.
// Collection data is DB-only (no fixtures), so the database starts empty —
// create documents via POST /api/seed or the app UI.
const mongod = await MongoMemoryServer.create({ instance: { port: 27018 } });
console.log('mongo', mongod.getUri('wmams'));
const seed = spawn('node', ['scripts/seed.mjs', '--replace'], {
  env: { ...process.env, MONGODB_URI: mongod.getUri('wmams') },
  stdio: 'inherit',
});
await new Promise((res) => seed.on('close', res));
console.log('seeded — start the app with:');
console.log(`$env:MONGODB_URI="${mongod.getUri('wmams')}"; npm run start -- --port 3110`);
await mongod.stop();
