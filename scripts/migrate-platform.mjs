import {getConfig} from '../server/config.js';
import {migratePlatform} from '../platform/server/community-migration.js';
await migratePlatform(getConfig());
const {runtimeCloseDatabasePool}=await import('../platform/server/db-runtime.js');
await runtimeCloseDatabasePool();
console.log('Community platform schema is ready');
