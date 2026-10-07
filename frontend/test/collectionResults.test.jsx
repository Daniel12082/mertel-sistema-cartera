import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AuthContext} from '../src/auth/auth.context';
import ManagementResults from '../src/pages/Cobranza/ManagementResults';
import CollectionPaymentForm from '../src/pages/Cobranza/CollectionPaymentForm';
import ReportedPayments from '../src/pages/Administracion/ReportedPayments';
import PortfolioPipelineView from '../src/pages/Cobranza/PortfolioPipelineView';
import {collectionResultsRequest,applyFinancialPipelineContext,refreshFinancialPipeline} from '../src/services/collectionResults.service';
vi.mock('../src/services/collectionResults.service',async importOriginal=>({...await importOriginal(),collectionResultsRequest:vi.fn()}));
vi.mock('../src/pages/Cobranza/CollectionOperations',()=>({default:()=>null}));
vi.mock('../src/pages/Cobranza/CustomerHistory',()=>({default:()=>null}));
const catalog=[['CONTACTED','Contacté al cliente'],['WHATSAPP','Envié WhatsApp'],['PROMISE','Promesa de pago'],['PAID','Cliente pagó'],['PARTIAL_PAYMENT','Pago parcial'],['PAYMENT_REPORTED','Reportar pago'],['NO_RESPONSE','Cliente no responde'],['INCONSISTENCY','Cliente reporta inconsistencia'],['WRONG_NUMBER','Número incorrecto'],['OTHER','Otra gestión']].map(([key,label])=>({key,label}));
const invoices=[{id:'11',invoice_number:'ME-74743',balance:'3482310.00',due_date:'2026-10-01',status:'pending'},{id:'12',invoice_number:'ME-74801',balance:'850000.00',due_date:'2026-10-12',status:'pending'}];
const context={customer:{id:'1',name:'Cliente MERTEL',nit:'90012345'},result_catalog:catalog,open_invoices:invoices,total_balance:'4332310.00',reports:[],collection_item:{stage_label:'En mora'},reference_date:'2026-10-07',financial_source_ready:true};
const report={id:'4',customer_id:'1',invoice_id:'11',customer_name:'Cliente MERTEL',nit:'90012345',invoice_number:'ME-74743',reported_amount:'3482310.00',reported_payment_date:'2026-10-07',current_balance:'3482310.00',reported_by:'Cobrador',status:'PENDING_REVIEW'};
const permissions=['collection.view','collection.manage','payments.create','payment_allocations.create','settings.manage','history.view'];
function view(component,allowed=permissions){return render(<AuthContext.Provider value={{permissions:allowed,user:{name:'Cobrador'}}}>{component}</AuthContext.Provider>);}
beforeEach(()=>{vi.clearAllMocks();collectionResultsRequest.mockImplementation((path)=>Promise.resolve(path==='/reports'?{reports:[report],page:1,has_next:false}:context));});
describe('Management results and financial confirmation',()=>{
  it('Gestionar on a pipeline card opens server-based outcome catalogue',async()=>{
    const pipeline={reference_date:'2026-10-07',source:{reference_date:'2026-10-07'},stage_catalog:[{key:'overdue',label:'En mora',category:'overdue'}],summary:{},pipeline:[{customer:{id:'1',name:'Cliente MERTEL'},stage:'overdue',stage_label:'En mora',total_balance:'4332310.00',invoices:[],documents:[],source_context:'fixture-token',source_details:{}}]};
    collectionResultsRequest.mockImplementation(path=>Promise.resolve(path==='/pipeline/refresh'?{customers:[]}:context));
    const user=userEvent.setup();view(<PortfolioPipelineView data={pipeline}/>);await user.click(screen.getByRole('button',{name:'Gestionar',exact:true}));
    for(const item of catalog)expect(await screen.findByRole('button',{name:item.label,exact:true})).toBeVisible();
    expect(collectionResultsRequest).toHaveBeenCalledWith('/customers/1/context',expect.objectContaining({params:expect.objectContaining({context_token:'fixture-token'})}));
  });
  it('total payment displays pending invoices and requires server confirmation before recording',async()=>{
    const complete=vi.fn();const user=userEvent.setup();
    const preview={customer:context.customer,payment:{amount:'3482310.00'},invoices:[{...invoices[0],allocation_amount:'3482310.00',resulting_balance:'0.00'}],unallocated_amount:'0.00',confirmation_token:'signed-fixture'};
    collectionResultsRequest.mockResolvedValue(preview);view(<CollectionPaymentForm customerId="1" invoices={invoices} referenceDate="2026-10-07" onComplete={complete}/>);
    await user.click(screen.getByLabelText('Seleccionar factura ME-74743'));expect(screen.getByLabelText('Monto recibido')).toHaveValue(3482310);
    fireEvent.change(screen.getByLabelText('Fecha de pago'),{target:{value:'2026-10-07'}});await user.click(screen.getByRole('button',{name:'Revisar pago'}));
    expect(await screen.findByLabelText('Resumen de confirmación del pago')).toHaveTextContent('Saldo resultante calculado por el servidor');
    expect(screen.getByText('Esta acción modificará el registro financiero y el saldo de la factura.')).toBeVisible();
    expect(collectionResultsRequest).not.toHaveBeenCalledWith('/customers/1/payments',expect.anything());
    collectionResultsRequest.mockResolvedValue({payment:{id:'8'},total_balance:'850000.00'});await user.click(screen.getByRole('button',{name:'Confirmar pago'}));
    expect(collectionResultsRequest).toHaveBeenLastCalledWith('/customers/1/payments',expect.objectContaining({body:expect.objectContaining({confirmation_token:'signed-fixture',allocations:[{invoice_id:'11',amount:'3482310.00'}]})}));expect(complete).toHaveBeenCalled();
    const body=collectionResultsRequest.mock.calls.at(-1)[1].body;expect(body).not.toHaveProperty('new_balance');
  });
  it('partial payments send received amount, while summary uses backend resulting balance',async()=>{
    const user=userEvent.setup();view(<CollectionPaymentForm customerId="1" invoices={invoices} kind="PARTIAL" referenceDate="2026-10-07" onComplete={vi.fn()}/>);
    await user.click(screen.getByLabelText('Seleccionar factura ME-74743'));await user.type(screen.getByLabelText('Monto recibido'),'1500000');fireEvent.change(screen.getByLabelText('Fecha de pago'),{target:{value:'2026-10-07'}});
    collectionResultsRequest.mockResolvedValue({customer:context.customer,payment:{amount:'1500000'},invoices:[{...invoices[0],allocation_amount:'1500000',resulting_balance:'1982310.00'}],unallocated_amount:'0',confirmation_token:'fixture'});
    await user.click(screen.getByRole('button',{name:'Revisar pago'}));expect(await screen.findByLabelText('Resumen de confirmación del pago')).toHaveTextContent('1.982.310');
    expect(collectionResultsRequest).toHaveBeenCalledWith('/customers/1/payment-preview',expect.objectContaining({body:expect.objectContaining({payment_kind:'PARTIAL',amount:'1500000'})}));
  });
  it('multiple invoices support explicit manual amounts without automatic distribution',async()=>{
    const user=userEvent.setup();view(<CollectionPaymentForm customerId="1" invoices={invoices} kind="MULTIPLE" onComplete={vi.fn()}/>);
    await user.click(screen.getByLabelText('Seleccionar factura ME-74743'));await user.click(screen.getByLabelText('Seleccionar factura ME-74801'));await user.type(screen.getByLabelText('Asignar a ME-74743'),'1500000');await user.type(screen.getByLabelText('Asignar a ME-74801'),'500000');await user.type(screen.getByLabelText('Monto recibido'),'2000000');fireEvent.change(screen.getByLabelText('Fecha de pago'),{target:{value:'2026-10-07'}});
    collectionResultsRequest.mockRejectedValue(new Error('Fixture validation'));await user.click(screen.getByRole('button',{name:'Revisar pago'}));
    expect(collectionResultsRequest).toHaveBeenCalledWith('/customers/1/payment-preview',expect.objectContaining({body:expect.objectContaining({allocations:[{invoice_id:'11',amount:'1500000'},{invoice_id:'12',amount:'500000'}]})}));
  });
  it('reported payment uses operational endpoint, has pending status and never calls financial confirmation',async()=>{
    const changed=vi.fn();const user=userEvent.setup();view(<ManagementResults customerId="1" referenceDate="2026-10-07" startOpen onChanged={changed}/>);
    await user.click(await screen.findByRole('button',{name:'Reportar pago',exact:true}));await user.selectOptions(screen.getByLabelText('Factura relacionada'),'11');await user.type(screen.getByLabelText('Monto informado'),'3482310');fireEvent.change(screen.getByLabelText('Fecha informada'),{target:{value:'2026-10-07'}});await user.type(screen.getByLabelText('Observación del resultado'),'Cliente informó pago');
    expect(screen.getByText(/No se modificarán saldos/)).toBeVisible();await user.click(screen.getByRole('button',{name:'Guardar reporte'}));
    await waitFor(()=>expect(changed).toHaveBeenCalled());expect(collectionResultsRequest).toHaveBeenCalledWith('/customers/1/result',expect.objectContaining({body:expect.objectContaining({result:'PAYMENT_REPORTED',reported_amount:'3482310'})}));expect(collectionResultsRequest.mock.calls.some(([path])=>path.endsWith('/payments'))).toBe(false);
  });
  it('shows backend errors and missing selection, does not claim success',async()=>{
    const user=userEvent.setup();view(<CollectionPaymentForm customerId="1" invoices={invoices} onComplete={vi.fn()}/>);await user.type(screen.getByLabelText('Monto recibido'),'1').catch(()=>{});
    fireEvent.change(screen.getByLabelText('Fecha de pago'),{target:{value:'2026-10-07'}});await user.click(screen.getByRole('button',{name:'Revisar pago'}));expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una factura');expect(collectionResultsRequest).not.toHaveBeenCalled();
  });
  it('collector without payment permissions can report and manage but cannot register payment',async()=>{
    view(<ManagementResults customerId="1" startOpen/>,['collection.view','collection.manage']);expect(await screen.findByRole('button',{name:'Cliente pagó',exact:true})).toBeDisabled();expect(screen.getByRole('button',{name:'Pago parcial',exact:true})).toBeDisabled();expect(screen.getByRole('button',{name:'Reportar pago',exact:true})).toBeEnabled();
  });
  it('administrator lists reports, confirms using server summary and rejects with reason',async()=>{
    const user=userEvent.setup();view(<ReportedPayments/>);expect(await screen.findByRole('row',{name:/Cliente MERTEL/})).toHaveTextContent('Pendiente de conciliación');await user.click(screen.getByRole('button',{name:'Rechazar 4'}));await user.type(screen.getByLabelText('Motivo del rechazo'),'Referencia incorrecta');
    collectionResultsRequest.mockImplementation(path=>Promise.resolve(path==='/reports'?{reports:[],page:1,has_next:false}:{}));await user.click(screen.getByRole('button',{name:'Guardar rechazo'}));expect(collectionResultsRequest).toHaveBeenCalledWith('/reports/4/review',expect.objectContaining({body:{decision:'REJECTED',reason:'Referencia incorrecta'}}));
  });
  it('report review is denied to collectors without making administrative requests',()=>{
    view(<ReportedPayments/>,['collection.manage']);expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');expect(collectionResultsRequest).not.toHaveBeenCalled();
  });
  it('pipeline card is removed only from authoritative engine result; temporary unmatched docs remain',()=>{
    const source={stage_catalog:[{key:'overdue',category:'overdue'}],pipeline:[{customer:{id:'1'},stage:'overdue',total_balance:'100',documents:[]},{customer:{id:'2'},stage:'overdue',total_balance:'200',documents:[]}],summary:{overdue:2}};
    const updated=applyFinancialPipelineContext(source,{customers:[{customer_id:'1',financial_source_ready:true,collection_item:null},{customer_id:'2',financial_source_ready:false,source_documents_pending:['FV-X'],pending_report_count:1}]});
    expect(updated.pipeline).toHaveLength(1);expect(updated.pipeline[0].customer.id).toBe('2');expect(updated.pipeline[0].total_balance).toBe('200');expect(source.pipeline).toHaveLength(2);
  });
  it('large signed pipelines stay within the existing API body limit and retain every customer context',async()=>{
    const customers=Array.from({length:200},(_,index)=>({customer_id:String(index+1),context_token:'signed-context-'.repeat(500)}));
    const request=vi.fn(async(path,{body})=>{
      expect(path).toBe('/pipeline/refresh');expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThan(100000);
      return{customers:body.customers.map(customer=>({customer_id:customer.customer_id,financial_source_ready:true,collection_item:null}))};
    });
    const result=await refreshFinancialPipeline('2026-10-07',customers,{},request);
    expect(request.mock.calls.length).toBeGreaterThan(1);expect(result.customers.map(customer=>customer.customer_id)).toEqual(customers.map(customer=>customer.customer_id));
  });
});
