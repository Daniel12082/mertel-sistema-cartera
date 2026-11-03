import { useAppDataMode } from './useAppDataMode';
import CollectionDashboard from '../pages/Administracion/CollectionDashboard';
import ReportedPayments from '../pages/Administracion/ReportedPayments';
import Reportes from '../pages/Reportes/Reportes';

export default function SimulationReports() {
  const { mode } = useAppDataMode();
  if (mode !== 'SIMULATION') return <Reportes />;
  return <section><h2>Reportes de demostración</h2><CollectionDashboard /><ReportedPayments /></section>;
}
