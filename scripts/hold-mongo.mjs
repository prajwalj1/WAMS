import { MongoMemoryServer } from 'mongodb-memory-server';
import { writeFileSync } from 'fs';
const mongod = await MongoMemoryServer.create({ instance: { port: 27018 } });
writeFileSync('./.mongo-uri', mongod.getUri('wmams'));
console.log('holding', mongod.getUri('wmams'));
setInterval(() => {}, 1000000);
