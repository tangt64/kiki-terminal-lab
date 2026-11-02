import test from'node:test';import assert from'node:assert/strict';
import{assertPrivateRepository,parseRemote}from'../scripts/release-api.mjs';
test('public GitHub is permitted while public Gitea remains forbidden',()=>{
 const repo={id:1,full_name:'example/kiki-terminal-lab',private:false,archived:false,permissions:{push:true}};
 assert.doesNotThrow(()=>assertPrivateRepository(repo,parseRemote('https://github.com/example/kiki-terminal-lab.git','github','kiki-terminal-lab'),{kind:'github'}));
 assert.throws(()=>assertPrivateRepository(repo,parseRemote('https://git.example.com/example/kiki-terminal-lab.git','gitea','kiki-terminal-lab'),{kind:'gitea'}));
});
