let csrfToken='';
let csrfRequest=null;
export async function api(path,{method='GET',body}={}){
  if(method!=='GET'&&!csrfToken){
    csrfRequest ||= fetch('/api/auth/csrf',{credentials:'include'}).then(async response=>{if(!response.ok)throw new Error('요청 토큰을 불러오지 못했습니다.');csrfToken=(await response.json()).csrfToken;}).finally(()=>{csrfRequest=null;});
    await csrfRequest;
  }
  const response=await fetch(path,{method,credentials:'include',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{'X-CSRF-Token':csrfToken})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(result.csrfToken)csrfToken=result.csrfToken;
  if(!response.ok){if(response.status===403&&result.message?.includes('토큰'))csrfToken='';const error=new Error(result.message||'요청을 처리하지 못했습니다.');error.status=response.status;error.userMessage=error.message;throw error;}
  return result;
}
