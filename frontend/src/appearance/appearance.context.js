import {createContext, useContext} from 'react';
import {DEFAULT_APPEARANCE} from '../../../backend/src/config/appearance';
export const AppearanceContext = createContext({appearance:DEFAULT_APPEARANCE, loading:false, error:'', companyName:'', preview:()=>{}, clearPreview:()=>{}});
export function useAppearance() { return useContext(AppearanceContext); }
