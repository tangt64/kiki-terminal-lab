import {useEffect,useRef,useState} from 'react';
import {TerminalLabBrand} from './terminal-lab-logo.jsx';
import {COMMUNITY_SERVICES} from './community-workspace.js';
import './community-workspace.css';
export function CommunityNavigation({section,isAdmin,onNavigate,onLogout,onAdmin,onCommunity,onSupport}) {
  const [collapsed,setCollapsed]=useState(false),[open,setOpen]=useState(false),[mobile,setMobile]=useState(()=>window.matchMedia('(max-width:820px)').matches);
  const nav=useRef(null),toggle=useRef(null),close=useRef(null);
  useEffect(()=>{const media=window.matchMedia('(max-width:820px)'),change=()=>{setMobile(media.matches);setOpen(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    if(!mobile||!open)return;
    const workspace=document.getElementById('portal-workspace'),previousHidden=workspace?.getAttribute('aria-hidden'),previousInert=workspace?.hasAttribute('inert'),overflow=document.body.style.overflow;
    workspace?.setAttribute('inert','');workspace?.setAttribute('aria-hidden','true');document.body.style.overflow='hidden';close.current?.focus();
    const key=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);}if(event.key==='Tab'){const items=[...nav.current.querySelectorAll('button:not(:disabled)')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;if(!previousInert)workspace?.removeAttribute('inert');if(previousHidden==null)workspace?.removeAttribute('aria-hidden');else workspace?.setAttribute('aria-hidden',previousHidden);toggle.current?.focus();};
  },[mobile,open]);
  const act=action=>{setOpen(false);action();};
  const items=[['terminalCloud','클라우드','☁',()=>onNavigate('terminalCloud')],['qna','커뮤니티','◇',onCommunity],['notices','공지사항','▤',()=>onNavigate('notices')],['messages','도움말','?',onSupport]];
  const cloudActive=['resources','terminalCloud',...COMMUNITY_SERVICES.map(([key])=>key)].includes(section);
  return <div className={`community-navigation-frame${collapsed&&!mobile?' is-collapsed':''}`}>
    {mobile?<button ref={toggle} type="button" className="community-mobile-menu" aria-expanded={open} aria-controls="community-primary-navigation" onClick={()=>setOpen(true)}>☰ 메뉴</button>:null}
    {mobile&&open?<button type="button" className="community-navigation-backdrop" aria-label="메뉴 닫기" onClick={()=>setOpen(false)}/>:null}
    <aside ref={nav} hidden={mobile&&!open} className="community-workspace-nav" aria-label="사용자 주 메뉴" role={mobile&&open?'dialog':undefined} aria-modal={mobile&&open?true:undefined}>
      <header><button ref={mobile?close:undefined} type="button" aria-label={mobile?'메뉴 닫기':collapsed?'메뉴 펼치기':'메뉴 접기'} aria-expanded={!collapsed} onClick={()=>mobile?setOpen(false):setCollapsed(v=>!v)}>☰</button><TerminalLabBrand/></header>
      <nav id="community-primary-navigation" aria-label="주요 메뉴">{items.map(([key,label,icon,action])=><button type="button" key={key} aria-label={label} title={collapsed?label:undefined} aria-current={(key==='terminalCloud'?cloudActive:section===key||key==='messages'&&section==='consulting')?'page':undefined} onClick={()=>act(action)}><i aria-hidden="true">{icon}</i><span>{label}</span></button>)}</nav>
      <footer>{isAdmin?<button type="button" onClick={()=>act(()=>onNavigate('opsMonitor'))}><i aria-hidden="true">◎</i><span>운영 모니터</span></button>:null}<button type="button" onClick={()=>act(()=>onNavigate('profile'))}><i aria-hidden="true">♙</i><span>내 정보</span></button>{isAdmin?<button type="button" onClick={()=>act(onAdmin)}><i aria-hidden="true">⚙</i><span>관리자 포털</span></button>:null}<button type="button" onClick={()=>act(onLogout)}><i aria-hidden="true">↪</i><span>로그아웃</span></button></footer>
    </aside>
  </div>;
}
export function CommunityServiceLinks({section,onService,onInstances,onServices}) {
  if(!['resources','terminalCloud',...COMMUNITY_SERVICES.map(([key])=>key)].includes(section))return null;
  return <nav className="community-service-links" aria-label="서비스 바로가기"><button type="button" onClick={onInstances}>가상머신</button>{COMMUNITY_SERVICES.map(([key,label])=><button type="button" key={key} aria-current={section===key?'page':undefined} onClick={()=>onService(key)}>{label}</button>)}<button type="button" onClick={onServices}>공유·예약·알림</button></nav>;
}
export function CommunityAdminNavigation({groups,labels,tab,onNavigate,filterInput,filter,favorites,onFavorite,open,onClose}) {
  const [selected,setSelected]=useState('');
  useEffect(()=>setSelected(''),[tab]);
  const active=groups.find(g=>g.key===selected)||groups.find(g=>g.tabs.includes(tab))||groups[0];
  return <aside className={`admin-nav-panel community-admin-navigation ${open?'is-mobile-open':''}`} aria-label="관리자 메뉴">
    <div className="sidebar-mobile-head"><strong>관리 메뉴</strong><button type="button" onClick={onClose}>닫기</button></div><TerminalLabBrand/>
    <label className="admin-nav-search"><span>메뉴 찾기</span><input type="search" {...filterInput} placeholder="이름으로 바로 이동"/></label>
    <nav aria-label="관리자 주요 영역">{groups.map(group=><button type="button" key={group.key} aria-expanded={active?.key===group.key} onClick={()=>setSelected(group.key)}>{group.label}<small>{group.tabs.length}</small></button>)}</nav>
    <nav aria-label="관리자 세부 메뉴">{(filter?groups.flatMap(g=>g.tabs):active?.tabs||[]).map(key=><div className="community-admin-menu-row" key={key}><button type="button" aria-current={key===tab?'page':undefined} onClick={()=>{onNavigate(key);onClose();}}>{labels[key]||key}</button><button type="button" aria-label={`${labels[key]} 즐겨찾기 ${favorites.includes(key)?'해제':'추가'}`} aria-pressed={favorites.includes(key)} onClick={()=>onFavorite(key)}>{favorites.includes(key)?'★':'☆'}</button></div>)}</nav>
    {favorites.length?<details><summary>즐겨찾기</summary>{favorites.map(key=><button type="button" key={key} onClick={()=>{onNavigate(key);onClose();}}>{labels[key]}</button>)}</details>:null}
  </aside>;
}
