import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function visit(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?visit(file):[file];});}
for(const dir of ['server','scripts','tests','platform/server','platform/shared'])for(const file of visit(path.join(root,dir))){if(!/\.(m?js)$/.test(file))continue;const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(checked.status!==0){process.stderr.write(checked.stderr);process.exit(1);}}
console.log('KIKI OS TERMINAL-LAB JavaScript syntax: OK');
