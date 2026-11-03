import api from './api';
export async function getReports(params={}, {signal}={}) {
  const response=await api.get('/admin/reports',{params,signal});
  if(response.data?.success!==true||!response.data?.data) throw new Error(response.data?.message||'No fue posible cargar los reportes.');
  return response.data.data;
}
