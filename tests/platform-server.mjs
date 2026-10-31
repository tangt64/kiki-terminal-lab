// Only used by the integration test runner. Never loaded by the production entry point.
if(!process.env.TEST_PLATFORM_DATABASE_URL||!/^\/community_test_/.test(new URL(process.env.TEST_PLATFORM_DATABASE_URL).pathname))throw new Error('A dedicated test database is required');
process.env.DATABASE_URL=process.env.TEST_PLATFORM_DATABASE_URL;
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=String(input);
  if(['https://oauth2.googleapis.com/token','https://kauth.kakao.com/oauth/token','https://nid.naver.com/oauth2.0/token'].includes(url))return new Response(JSON.stringify({access_token:'test-provider-token',token_type:'Bearer'}),{headers:{'Content-Type':'application/json'}});
  if(url==='https://openidconnect.googleapis.com/v1/userinfo')return new Response(JSON.stringify({sub:'community-google-test',email:'google@sso.example.test',email_verified:true,name:'SSO User'}),{headers:{'Content-Type':'application/json'}});
  if(url==='https://kapi.kakao.com/v2/user/me')return new Response(JSON.stringify({id:'community-kakao-test',kakao_account:{email:'kakao@sso.example.test',is_email_verified:true},properties:{nickname:'SSO User'}}),{headers:{'Content-Type':'application/json'}});
  if(url==='https://openapi.naver.com/v1/nid/me')return new Response(JSON.stringify({resultcode:'00',response:{id:'community-naver-test',email:'naver@sso.example.test',name:'SSO User'}}),{headers:{'Content-Type':'application/json'}});
  return realFetch(input,options);
};
await import('../platform/server/community-bootstrap.js');
