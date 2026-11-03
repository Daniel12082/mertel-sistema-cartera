import { useContext } from 'react';
import { SimulationContext } from './simulation.context';
export function useAppDataMode() { return useContext(SimulationContext); }
