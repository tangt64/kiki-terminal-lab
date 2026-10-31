import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
test('all local application imports resolve inside the standalone directory',()=>{
  for(const directory of ['server','client/src','platform/server','platform/client/src','platform/shared'])for(const file of files(path.join(root,directory))){
    if(!/\.(js|jsx)$/.test(file))continue;
    const content=fs.readFileSync(file,'utf8');
    for(const match of content.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)){
      const specifier=match[1];if(!specifier.startsWith('.'))continue;
      const target=path.resolve(path.dirname(file),specifier);assert.ok(target.startsWith(root+path.sep),`${file}: ${specifier} escapes standalone root`);assert.ok(fs.existsSync(target),`${file}: missing ${specifier}`);
    }
  }
});
test('the legacy core schema stays available for migration fixtures',()=>{
  const schema=fs.readFileSync(path.join(root,'server/schema.sql'),'utf8');
  assert.doesNotMatch(schema,/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:courses|lab_requests|payments|certificates|exam_entitlements)\b/i);
});
