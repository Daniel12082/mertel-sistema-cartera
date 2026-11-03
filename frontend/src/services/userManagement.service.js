import api from './api';
export async function usersRequest(method,path='',body,{signal}={}){
  try{const {data}=await api.request({method,url:'/admin/users'+path,data:body,signal});if(!data?.success||!data.data)throw new Error('Respuesta inválida');return data.data;}
  catch(error){if(error.code==='ERR_CANCELED')throw error;throw new Error([400,403,404,409].includes(error.response?.status)?error.response.data?.message:'No pudimos cargar o guardar los usuarios. Intenta nuevamente.',{cause:error});}
}
