export const mainPanels=[
  {label:'Dashboard',path:'/',permission:'dashboard.view'}, {label:'Clientes',path:'/clientes',permission:'customers.view'},
  {label:'Facturas',path:'/facturas',permission:'invoices.view'}, {label:'Cartera',path:'/cartera',permission:'portfolio.view'},
  {label:'Cobranza',path:'/cobranza',permission:'collection.view'}, {label:'Pagos',path:'/pagos',permission:'payments.view'},
  {label:'Reportes',path:'/reportes',permission:'reports.view'}, {label:'Configuración',path:'/configuracion',permission:'settings.view'},
];
export const administrationPanels=[
  {label:'Centro Administrativo',path:'/administracion',permission:'admin_dashboard.view'},
  {label:'Clientes por resolver',path:'/administracion/resolucion-clientes',permission:'portfolio.import'},
  {label:'Pagos reportados',path:'/administracion/pagos-reportados',permission:'reported_payments.view'},
  {label:'Auditoría',path:'/administracion/historial-cobranza',permission:'audit.view'},
  {label:'WhatsApp',path:'/administracion/whatsapp',permission:'whatsapp.view'},
  {label:'Plantillas WhatsApp',path:'/administracion/plantillas-whatsapp',permission:'message_templates.view'},
  {label:'Importar cartera',path:'/administracion/importar-cartera',permission:'portfolio.import'},
  {label:'Dashboard de cobranza',path:'/administracion/dashboard-cobranza',permission:'collection_dashboard.view'},
];
export const configurationPermissions={general:'settings.manage',cobranza:'settings.manage',usuarios:'users.view',roles:'roles.view',whatsapp:'whatsapp.manage',mensajes:'message_templates.view',importaciones:'portfolio.import',sistema:'settings.manage',personalizacion:'settings.manage'};
export function hasPanelAccess(path,permissions=[]){
  if(path==='/configuracion')return permissions.includes('settings.view')||Object.values(configurationPermissions).some(p=>permissions.includes(p));
  if(path.startsWith('/configuracion/'))return permissions.includes(configurationPermissions[path.split('/')[2]]);
  if(path==='/administracion/configuracion-cobranza')return permissions.includes('settings.manage');
  const panel=[...mainPanels,...administrationPanels].find(item=>item.path===path);
  return !panel||permissions.includes(panel.permission);
}
export const firstPanelPath=permissions=>[...mainPanels,...administrationPanels].find(item=>hasPanelAccess(item.path,permissions))?.path;
