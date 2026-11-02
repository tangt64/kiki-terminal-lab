import test from'node:test';import assert from'node:assert/strict';
import{assertPrivateRepository,parseRemote,ReleaseTarget}from'../scripts/release-api.mjs';
test('public GitHub is permitted while public Gitea remains forbidden',()=>{
 const repo={id:1,full_name:'example/kiki-terminal-lab',private:false,archived:false,permissions:{push:true}};
 assert.doesNotThrow(()=>assertPrivateRepository(repo,parseRemote('https://github.com/example/kiki-terminal-lab.git','github','kiki-terminal-lab'),{kind:'github'}));
 assert.throws(()=>assertPrivateRepository(repo,parseRemote('https://git.example.com/example/kiki-terminal-lab.git','gitea','kiki-terminal-lab'),{kind:'gitea'}));
});
test('public verification rejects a redirect to GitHub login',async()=>{
 const target=new ReleaseTarget({kind:'github',remote:'origin',location:parseRemote('https://github.com/example/kiki-terminal-lab.git','github','kiki-terminal-lab'),token:'test-only',fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://github.com/login'}})});
 target.private=false;await assert.rejects(target.checkAnonymous({assets:[]}));
});
