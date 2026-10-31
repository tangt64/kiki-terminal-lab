import {cpSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'platform/client/public');
mkdirSync(output,{recursive:true});
if(existsSync(path.join(root,'client/public/licenses')))cpSync(path.join(root,'client/public/licenses'),path.join(output,'licenses'),{recursive:true});
console.log('Standalone dependency notices prepared');
