import React,{lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import './community.css';
import './cloud.css';
const App=lazy(()=>import('./App.jsx'));
const Console=lazy(()=>import('./Console.jsx'));
createRoot(document.getElementById('root')).render(<React.StrictMode><Suspense fallback={<p className="boot" role="status">불러오는 중…</p>}>{window.location.pathname==='/console'?<Console/>:<App/>}</Suspense></React.StrictMode>);
