import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Podman retains the image healthcheck without changing Docker flags or installation ownership',()=>{
  const file=fileURLToPath(new URL('../installer/install.py',import.meta.url));
  const program=`import importlib.util,json
spec=importlib.util.spec_from_file_location('installer',${JSON.stringify(file)})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
results=[]
for engine in ['podman','docker']:
 for label in [module.LABEL,module.LEGACY_LABEL]:
  installer=object.__new__(module.Installer);installer.engine=engine
  installer.state={'id':'local-fixture','image':'localhost/local-fixture:0','ownership_label':label}
  installer.require_state=lambda:None
  calls=[];installer.run=lambda *args:calls.append([str(value) for value in args])
  installer.build()
  results.append({'engine':engine,'label':label,'calls':calls})
print(json.dumps(results))`;
  const result=spawnSync(process.env.RELEASE_PYTHON||(process.platform==='win32'?'python':'python3'),['-c',program],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  for(const {engine,label,calls}of JSON.parse(result.stdout)){
    assert.equal(calls.length,1);
    const args=calls[0];assert.equal(args[0],'build');
    assert.equal(args.includes('--format'),engine==='podman');
    if(engine==='podman')assert.equal(args[args.indexOf('--format')+1],'docker');
    assert.equal(args[args.indexOf('--label')+1],label+'=local-fixture');
    assert.equal(args[args.indexOf('-t')+1],'localhost/local-fixture:0');
    assert.equal(args.includes('--network'),false);
  }
});
