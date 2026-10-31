import {useEffect,useRef,useState} from 'react';
import RFB from '@novnc/novnc/lib/rfb.js';

export default function Console(){
  const root=useRef(null);const [status,setStatus]=useState('VNC 콘솔 연결 중…');
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('session');
    if(!/^[a-f0-9]{64}$/.test(id||'')){setStatus('잘못된 콘솔 세션입니다.');return;}
    const rfb=new RFB(root.current,`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/terminal/socket/${id}`);
    rfb.scaleViewport=true;rfb.resizeSession=true;
    rfb.addEventListener('connect',()=>setStatus('연결됨'));
    rfb.addEventListener('disconnect',()=>setStatus('연결이 종료되었습니다. 포털에서 콘솔을 다시 열어 주세요.'));
    rfb.addEventListener('credentialsrequired',()=>setStatus('VNC 서버 인증 설정을 관리자에게 확인해 주세요.'));
    return()=>rfb.disconnect();
  },[]);
  return <main className="console"><p role="status">{status}</p><div ref={root}/></main>;
}
