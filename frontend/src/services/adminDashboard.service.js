import api from './api';
export async function getAdminDashboard(params, {signal}={}) {
  try { const {data}=await api.get('/admin/dashboard',{params,signal});
    if(!data?.success||!data.data)throw new Error('Respuesta inválida');return data.data;
  } catch(error) { if(error.code==='ERR_CANCELED')throw error;
    throw new Error(error.response?.status===400?error.response.data.message:error.response?.status===403?'No tienes permiso administrativo.':'No fue posible cargar el Centro Administrativo.',{cause:error}); }
}
