import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'client/public/licenses');fs.mkdirSync(output,{recursive:true});
const packages=['react','react-dom','scheduler','@xterm/xterm','@xterm/addon-fit','@novnc/novnc','@mdxeditor/editor'];
const notices=[];
for(const name of packages){
  const directory=path.join(root,'node_modules',name);const info=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
  notices.push({name,version:info.version,license:info.license,source:typeof info.repository==='string'?info.repository:info.repository?.url});
  for(const sub of ['','docs']){
    const dir=path.join(directory,sub);if(!fs.existsSync(dir))continue;
    for(const file of fs.readdirSync(dir))if(/^(LICENSE|COPYING|AUTHORS)/i.test(file)&&fs.statSync(path.join(dir,file)).isFile())fs.copyFileSync(path.join(dir,file),path.join(output,name.replaceAll('/','-')+'-'+file));
  }
}
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify(notices,null,2)+'\n');
console.log('Browser dependency notices generated');
