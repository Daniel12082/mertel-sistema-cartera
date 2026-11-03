import {BarChart3,AlertCircle} from 'lucide-react';
import './dashboard-ui.css';

export function Panel({title,description,action,children,className='',error,onRetry}) {
  return <section className={`ui-panel ${className}`} aria-label={title}><header className="ui-panel-heading"><div><h3>{title}</h3>{description&&<p>{description}</p>}</div>{action}</header>{error&&<div className="ui-error" role="alert"><AlertCircle size={16} aria-hidden="true"/><span>No pudimos cargar esta sección.</span>{onRetry&&<button onClick={onRetry}>Reintentar</button>}</div>}{children}</section>;
}
export function StatCard({label,value,context,icon:Icon,tone='neutral'}) {
  return <article className={`ui-stat ui-stat-${tone}`}><div className="ui-stat-heading"><span>{label}</span>{Icon&&<Icon size={17} aria-hidden="true"/>}</div><strong>{value??'No disponible'}</strong>{context&&<small>{context}</small>}</article>;
}
export function EmptyState({title='No hay datos disponibles',description,compact=false}) {
  return <div className={`ui-empty ${compact?'ui-empty-compact':''}`} role="status"><span className="ui-empty-icon"><BarChart3 size={24} aria-hidden="true"/></span><strong>{title}</strong>{description&&<p>{description}</p>}</div>;
}
export function Badge({children,tone='neutral'}) { return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>; }
export function DashboardSkeleton() {
  return <div className="ui-dashboard-skeleton" role="status" aria-label="Cargando resumen de MERTEL"><div className="ui-skeleton-kpis">{Array.from({length:6},(_,index)=><span key={index}/>)}</div><div className="ui-skeleton-panels"><span/><span/><span/><span/></div><span className="ui-sr-only">Cargando resumen de MERTEL…</span></div>;
}
