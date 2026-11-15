import test from'node:test';import assert from'node:assert/strict';
import{assertPrivateRepository,parseRemote,ReleaseTarget}from'../scripts/release-api.mjs';
test('public GitHub is permitted while public Gitea remains forbidden by default',()=>{
 const repo={id:1,full_name:'example/kiki-terminal-lab',private:false,archived:false,permissions:{push:true}};
 assert.doesNotThrow(()=>assertPrivateRepository(repo,parseRemote('https://github.com/example/kiki-terminal-lab.git','github','kiki-terminal-lab'),{kind:'github'}));
 assert.throws(()=>assertPrivateRepository(repo,parseRemote('https://git.example.com/example/kiki-terminal-lab.git','gitea','kiki-terminal-lab'),{kind:'gitea'}));
});
test('public verification rejects a redirect to GitHub login',async()=>{
 const target=new ReleaseTarget({kind:'github',remote:'origin',location:parseRemote('https://github.com/example/kiki-terminal-lab.git','github','kiki-terminal-lab'),token:'test-only',fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://github.com/login'}})});
 target.private=false;await assert.rejects(target.checkAnonymous({assets:[]}));
});

test('public Gitea is accepted only by explicit opt-in and still requires correct identity and permissions',()=>{
 const location=parseRemote('https://git.example.com/example/kiki-terminal-lab.git','gitea','kiki-terminal-lab');
 const repo={id:1,full_name:location.fullName,private:false,archived:false,permissions:{push:true}};
 assert.doesNotThrow(()=>assertPrivateRepository(repo,location,{kind:'gitea',allowPublicGitea:true}));
 for(const changed of [{...repo,mirror:true},{...repo,archived:true},{...repo,full_name:'other/kiki-terminal-lab'},{...repo,permissions:{}}])assert.throws(()=>assertPrivateRepository(changed,location,{kind:'gitea',allowPublicGitea:true}));
});
test('public Gitea anonymous checks reject login redirects and allow only successful public pages',async()=>{
 const options={kind:'gitea',remote:'internal',location:parseRemote('https://git.example.com/example/kiki-terminal-lab.git','gitea','kiki-terminal-lab'),token:'fixture-only',allowPublicGitea:true};
 const target=new ReleaseTarget({...options,fetchImpl:async()=>new Response(null,{status:302,headers:{location:'/user/login'}})});target.private=false;
 await assert.rejects(target.checkAnonymous({assets:[]}));
 const publicTarget=new ReleaseTarget({...options,fetchImpl:async()=>new Response('public',{status:200})});publicTarget.private=false;
 await assert.doesNotReject(publicTarget.checkAnonymous({assets:[]}));
});
