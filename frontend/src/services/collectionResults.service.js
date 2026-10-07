import api from './api';

export async function collectionResultsRequest(path, {method='get',body,params,signal}={}) {
  try {
    const {data}=await api.request({url:`/collection/results${path}`,method,data:body,params,signal});
    if (!data.success) throw new Error('Respuesta inválida de gestión.'); return data.data;
  } catch(error) {
    if (error.code==='ERR_CANCELED') throw error;
    throw new Error(error.response?.data?.message || 'No fue posible completar la gestión.',{cause:error});
  }
}

// Keep signed source contexts below Express's existing JSON limit, without
// increasing a global request limit or dropping document ownership checks.
export async function refreshFinancialPipeline(referenceDate,customers,{signal}={},request=collectionResultsRequest){
  const encoder=new TextEncoder();const chunks=[];let chunk=[];
  for(const customer of customers){
    const candidate=[...chunk,customer];
    if(encoder.encode(JSON.stringify({reference_date:referenceDate,customers:candidate})).byteLength>60000){
      if(!chunk.length)throw new Error('El contexto de un cliente supera el tamaño admitido. Actualiza la importación.');
      chunks.push(chunk);chunk=[customer];
    }else chunk=candidate;
  }
  if(chunk.length)chunks.push(chunk);
  const responses=new Array(chunks.length);let next=0;
  await Promise.all(Array.from({length:Math.min(3,chunks.length)},async()=>{
    while(next<chunks.length){const index=next++;responses[index]=await request('/pipeline/refresh',{method:'post',body:{reference_date:referenceDate,customers:chunks[index]},signal});}
  }));
  return {reference_date:referenceDate,customers:responses.flatMap(response=>response.customers)};
}

// Display composition only. Engine stages and balances are never computed in the browser.
export function applyFinancialPipelineContext(source, response) {
  const contexts=new Map(response.customers.map(item=>[String(item.customer_id),item]));
  const pipeline=(source.pipeline || []).flatMap(item=>{
    const context=contexts.get(String(item.customer.id));
    if (!context) return [item];
    if (!context.financial_source_ready) return [{...item,pending_report_count:context.pending_report_count,financial_source_ready:false,source_documents_pending:context.source_documents_pending}];
    if (!context.collection_item) return [];
    const financial=context.collection_item;
    const invoices=financial.invoices.map(row=>({...row,document_number:row.invoice.invoice_number,movement_type:'invoice',
      movement:'Factura',issue_date:row.invoice.issue_date,due_date:row.invoice.due_date,document_value:row.invoice.document_value,
      balance:row.invoice.balance,source_row:row.invoice.invoice_id ?? row.invoice.id}));
    return [{...item,...financial,financial_source_ready:true,pending_report_count:context.pending_report_count,documents:invoices,
      source_documents:item.documents,source_details:item.source_details,source_context:item.source_context}];
  });
  const counts=key=>pipeline.filter(item=>source.stage_catalog?.find(stage=>stage.key===item.stage)?.category===key).length;
  return {...source,pipeline,summary:{...source.summary,overdue:counts('overdue'),due_today:counts('due_today'),due_in_five_days:counts('days_before_due'),prompt_payment:counts('prompt_payment')},
    metadata:{...source.metadata,financial_context_refreshed:true}};
}
