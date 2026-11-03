import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import {DistributionChart,ActivityChart,StageBars} from '../src/pages/Dashboard/DashboardCharts';
beforeEach(()=>vi.stubGlobal('ResizeObserver',class {
  constructor(callback){this.callback=callback;}
  observe(target){this.callback([{target,contentRect:{width:320,height:235}}]);}
  unobserve(){} disconnect(){}
}));
afterEach(()=>vi.unstubAllGlobals());
it('empty portfolio never draws an invented distribution',()=>{
  const {container}=render(<DistributionChart rows={[]} total={0} unclassified={0}/>);
  expect(screen.getByText('No hay cartera persistente cargada')).toBeVisible();expect(container.querySelector('svg.recharts-surface')).toBeNull();
});
it('one historical date is rendered as the available real activity point',()=>{
  const {container}=render(<ActivityChart rows={[{day:'2026-10-07',gestions:2,payments:1,promises:1}]}/>);
  expect(screen.getByRole('img',{name:'Tendencia diaria de gestiones, pagos y promesas'})).toBeVisible();
  expect(screen.getByRole('table',{name:'Actividad diaria'})).toBeInTheDocument();
  expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
});
it('donut percentages include the unclassified portion of the real total',async()=>{
  const {container}=render(<DistributionChart rows={[{key:'overdue',label:'En mora',amount:75,balance:'75.00',customers:1,color:'#b6223c'}]} total={100} unclassified={25}/>);
  expect(screen.getByText('75.0%')).toBeVisible();expect(screen.getByText('25.0%')).toBeVisible();expect(screen.getByText('Fuera de etapas')).toBeVisible();await waitFor(()=>expect(container.querySelector('svg.recharts-surface')).not.toBeNull());expect(screen.getByRole('table',{name:'Datos de la gráfica'})).toBeInTheDocument();
});
it('zero client counts use an empty state rather than decorative bars',()=>{
  render(<StageBars rows={[{key:'overdue',label:'En mora',balance:'0.00',customers:0,amount:0}]} kind="clients"/>);expect(screen.getByText('No hay clientes con cartera')).toBeVisible();
});
