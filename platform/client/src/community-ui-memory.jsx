import {createContext,useContext,useEffect,useRef,useState} from 'react';
const Memory=createContext(null);
// List presentation only. This map is destroyed when the authenticated shell unmounts.
export function CommunityUiMemory({children}) {
  const memory=useRef(new Map());
  return <Memory.Provider value={memory.current}>{children}</Memory.Provider>;
}
export function useCommunityUiState(key,initial) {
  const memory=useContext(Memory),initialValue=()=>typeof initial==='function'?initial():initial;
  const read=()=>memory?.has(key)?memory.get(key):initialValue();
  const [state,setState]=useState(()=>({key,value:read()}));
  const value=state.key===key?state.value:read();
  if(state.key!==key)setState({key,value});
  useEffect(()=>{if(state.key===key)memory?.set(key,state.value);},[memory,key,state]);
  const update=next=>setState(previous=>({key,value:typeof next==='function'?next(previous.key===key?previous.value:read()):next}));
  return [value,update];
}
