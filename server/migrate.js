import { getConfig } from './config.js';
import { Database } from './db.js';
const config=getConfig();
const db=new Database(config.databaseUrl);
try {await db.migrate(config.initialAdmin);console.log('Community schema is ready.');}
finally {await db.close();}
