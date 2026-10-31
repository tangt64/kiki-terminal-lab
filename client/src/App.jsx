import {lazy,Suspense,useCallback,useEffect,useState} from 'react';
import {api} from './api.js';
import {useCloud} from './use-cloud.js';
const Cloud=lazy(()=>import('./terminal-cloud-view.jsx'));
const Admin=lazy(()=>import('./Admin.jsx'));

export default function App(){
  const [session,setSession]=useState(undefined);
  const [error,setError]=useState('');
  useEffect(()=>{api('/api/auth/me').then(result=>setSession(result.user)).catch(error=>setError(error.message));},[]);
  if(session===undefined)return <main className="boot"><h1>Terminal Lab Community</h1>{error?<div role="alert">{error}<button onClick={()=>location.reload()}>다시 시도</button></div>:<p role="status">연결 확인 중…</p>}</main>;
  if(!session)return <Login onLogin={setSession}/>;
  return <Portal session={session} onSession={setSession}/>;
}

function Login({onLogin}){
  const [signup,setSignup]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  async function submit(event){
    event.preventDefault();setBusy(true);setMessage('');const form=Object.fromEntries(new FormData(event.currentTarget));
    try{const result=await api(signup?'/api/auth/signup':'/api/auth/login',{method:'POST',body:form});if(signup){setSignup(false);setMessage(result.message);}else onLogin(result.user);}
    catch(error){setMessage(error.message);}finally{setBusy(false);}
  }
  return <main className="login"><section className="login-intro"><span className="eyebrow">TERMINAL LAB / COMMUNITY</span><h1>내 클라우드를<br/>한곳에서 관리하세요.</h1><p>프로젝트 요청부터 인스턴스, 네트워크, 스토리지까지.<br/>사용자는 자원을 관리하고 관리자는 권한과 운영을 관리합니다.</p><div className="intro-tags"><span>OpenStack</span><span>사용자 포털</span><span>관리자 콘솔</span></div><small>독립 설치형 클라우드 관리 포털 · v0.1.0</small></section><section className="login-card"><div className="brand-mark" aria-hidden="true">&gt;_</div><h2>{signup?'계정 신청':'로그인'}</h2><p className="hint">{signup?'가입 후 관리자의 승인이 필요합니다.':'승인된 계정으로 클라우드에 접속하세요.'}</p><form onSubmit={submit}>
    <label>아이디<input name="username" autoComplete="username" required minLength={3} maxLength={64}/></label>
    {signup?<><label>이름<input name="name" autoComplete="name" required maxLength={80}/></label><label>이메일<input type="email" name="email" autoComplete="email"/></label></>:null}
    <label>비밀번호<input type="password" name="password" autoComplete={signup?'new-password':'current-password'} required minLength={signup?12:1} maxLength={200}/></label>
    <button className="primary-btn" disabled={busy}>{busy?'처리 중…':signup?'계정 신청':'로그인'}</button>
  </form>{message?<p role="status" className="form-message">{message}</p>:null}<button className="text-btn" onClick={()=>{setSignup(!signup);setMessage('');}}>{signup?'로그인으로 돌아가기':'계정 신청하기'}</button></section></main>;
}

function Portal({session,onSession}){
  const [page,setPage]=useState(location.pathname==='/admin'?'admin':location.pathname==='/profile'?'profile':'cloud');
  const [notice,setNotice]=useState('');const [ownerId,setOwnerId]=useState(session.id);
  const notify=useCallback(message=>setNotice(message),[]);
  const cloud=useCloud(session,notify);
  function navigate(next){setPage(next);history.pushState({},'',next==='admin'?'/admin':next==='profile'?'/profile':'/');}
  useEffect(()=>{const change=()=>setPage(location.pathname==='/admin'?'admin':location.pathname==='/profile'?'profile':'cloud');window.addEventListener('popstate',change);return()=>window.removeEventListener('popstate',change);},[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),8000);return()=>clearTimeout(timer);},[notice]);
  async function logout(){try{await api('/api/auth/logout',{method:'POST'});onSession(null);history.replaceState({},'','/');}catch(error){notify(error.message);}}
  const title=page==='admin'?'관리자 콘솔':page==='profile'?'내 계정':'클라우드 콘솔';
  return <div className="community-shell"><aside className="community-nav"><a className="brand" href="/" onClick={event=>{event.preventDefault();navigate('cloud');}}> <span aria-hidden="true">&gt;_</span><div>Terminal Lab<small>COMMUNITY</small></div></a><p className="nav-caption">WORKSPACE</p><nav aria-label="주 메뉴"><button aria-current={page==='cloud'?'page':undefined} onClick={()=>{setOwnerId(session.id);navigate('cloud');}}>클라우드 콘솔</button>{session.role==='admin'?<button aria-current={page==='admin'?'page':undefined} onClick={()=>navigate('admin')}>관리자 콘솔</button>:null}<button aria-current={page==='profile'?'page':undefined} onClick={()=>navigate('profile')}>내 계정</button></nav><div className="nav-bottom"><span className="status-dot"/>독립 설치형 포털<small>v0.1.0</small></div></aside><div className="community-body"><header className="community-header"><div><p className="eyebrow">TERMINAL LAB COMMUNITY</p><h1>{title}</h1></div><div className="account"><span>{session.name}<small>{session.role==='admin'?'관리자':'일반 사용자'}</small></span><button className="mini-btn" onClick={logout}>로그아웃</button></div></header><main className="community-main">{notice?<div className="notice" role="status">{notice}<button aria-label="알림 닫기" onClick={()=>setNotice('')}>×</button></div>:null}<Suspense fallback={<p role="status">화면을 불러오는 중…</p>}>
    {page==='cloud'?(cloud.settings?<><div className="page-heading"><h2>{ownerId===session.id?'내 프로젝트':'사용자 프로젝트'}</h2><p>프로젝트별로 자원을 구성하고 작업 상태를 확인하세요.</p></div><Cloud key={ownerId} {...cloud.cloudProps} projectOwnerId={ownerId}/></>:<p role="status">클라우드 설정을 불러오는 중…</p>):null}
    {page==='admin'?(session.role==='admin'?<Admin cloud={cloud} notify={notify} inspectProject={owner=>{setOwnerId(owner);navigate('cloud');}}/>:<p role="alert">관리자 권한이 필요합니다.</p>):null}
    {page==='profile'?<Profile session={session} onSession={onSession} notify={notify}/>:null}
  </Suspense></main></div></div>;
}

function Profile({session,onSession,notify}){
  const [busy,setBusy]=useState(false);
  async function save(event){event.preventDefault();setBusy(true);try{const result=await api('/api/profile',{method:'PATCH',body:Object.fromEntries(new FormData(event.currentTarget))});notify('계정 정보를 저장했습니다.');onSession(result.reauthenticate?null:result.user);}catch(error){notify(error.message);}finally{setBusy(false);}}
  return <section className="panel narrow"><h2>내 계정</h2><p className="hint">아이디: {session.username}</p><form onSubmit={save}><label>이름<input name="name" defaultValue={session.name} required maxLength={80}/></label><label>이메일<input type="email" name="email" defaultValue={session.email}/></label><hr/><p className="hint">비밀번호를 변경하면 다시 로그인해야 합니다.</p><label>현재 비밀번호<input type="password" name="currentPassword" autoComplete="current-password"/></label><label>새 비밀번호<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={200}/></label><button className="primary-btn" disabled={busy}>저장</button></form></section>;
}
