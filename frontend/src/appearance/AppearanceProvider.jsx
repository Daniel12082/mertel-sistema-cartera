import {useCallback, useEffect, useState} from 'react';
import {useAuth} from '../auth/useAuth';
import {useAppDataMode} from '../simulation/useAppDataMode';
import {simulationSnapshot} from '../simulation/store';
import {loadAppearance, persistAppearance} from '../services/appearance.service';
import {DEFAULT_APPEARANCE, foregroundFor} from '../../../backend/src/config/appearance';
import {AppearanceContext} from './appearance.context';
import './appearance.css';

const realCache = new Map();
export default function AppearanceProvider({children}) {
  const {user, permissions=[]} = useAuth(), {mode,epoch} = useAppDataMode();
  const userId=user?.id;
  const source = `${mode}:${epoch}:${user?.id||''}`, simulated = mode === 'SIMULATION';
  const [state,setState] = useState(()=>({source, data:simulated ? {appearance:structuredClone(DEFAULT_APPEARANCE),company_name:''} : realCache.get(String(user?.id))||null, loaded:simulated, error:''}));
  const [draft,setDraft] = useState(null), [revision,setRevision] = useState(0);
  const reload = useCallback(()=>setRevision(value=>value+1),[]);
  const preview = useCallback(value=>setDraft(value),[]), clearPreview = useCallback(()=>setDraft(null),[]);
  useEffect(()=>{
    if (!userId || simulated) return;
    const controller = new AbortController();
    loadAppearance(controller.signal).then(data=>{
      if (controller.signal.aborted) return;
      realCache.set(String(userId),data); setState({source,data,loaded:true,error:''});
    }).catch(error=>{if (!controller.signal.aborted) setState({source,data:null,loaded:true,error:error.message});});
    return ()=>controller.abort();
  },[userId,simulated,source,revision]);
  const data = state.source===source ? state.data : null;
  const savedAppearance = data?.appearance||DEFAULT_APPEARANCE, appearance = draft||savedAppearance;
  useEffect(()=>{
    const root=document.documentElement;
    const entries = {...Object.fromEntries(Object.entries(appearance.colors).map(([key,value])=>[`--mertel-${key}`,value])),
      '--mertel-primary-foreground':foregroundFor(appearance.colors.primary),'--mertel-sidebar-foreground':foregroundFor(appearance.colors.sidebar),'--mertel-accent-foreground':foregroundFor(appearance.colors.accent)};
    root.dataset.mertelTheme='custom';
    for (const [key,value] of Object.entries(entries)) root.style.setProperty(key,value);
    const previousTitle=document.title;document.title=appearance.name;
    return ()=>{for (const key of Object.keys(entries)) root.style.removeProperty(key);delete root.dataset.mertelTheme;document.title=previousTitle;};
  },[appearance]);
  async function save(value) {
    if (!permissions.includes('settings.manage')) throw new Error('No tienes permiso para personalizar MERTEL.');
    const expected=simulationSnapshot();
    const result = simulated ? {appearance:structuredClone(value),company_name:''} : await persistAppearance(value);
    if (simulationSnapshot().epoch !== expected.epoch || simulationSnapshot().mode !== expected.mode) throw new Error('La fuente de datos cambió. Vuelve a abrir Personalización.');
    if (!simulated) realCache.set(String(user.id),result);
    setState({source,data:result,loaded:true,error:''});setDraft(null);
    return result;
  }
  const value=({appearance,savedAppearance,companyName:data?.company_name||'',loading:Boolean(user&&!simulated&&(!state.loaded||state.source!==source)),error:state.error,reload,preview,clearPreview,save});
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
