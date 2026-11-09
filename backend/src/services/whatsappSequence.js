import { renderMessageTemplate } from '../utils/messageTemplate.js';
import {calculatePromptPaymentDiscount,dateDay,dateFromDay} from './promptPayment.service.js';
import {evaluateCollectionCase} from './collectionEngine.service.js';
import {moneyCents} from './collectionMoney.js';
import {collectionStageCatalog} from './collectionPolicy.js';

export const MERTEL_CONTACTS=Object.freeze([
  {stage:'prompt_payment',label:'Pronto pago',template_name:'mertel_pronto_pago',description:'Día hábil 7 desde emisión; límite día calendario 10'},
  {stage:'five_days_before_due',label:'Recordatorio',template_name:'mertel_aviso_previo',description:'Exactamente 5 días calendario antes del vencimiento'},
  {stage:'due_today',label:'Vence hoy',template_name:'mertel_vence_hoy',description:'El día calendario del vencimiento'},
  {stage:'overdue',label:'Mora',template_name:'mertel_mora',description:'El día calendario siguiente al vencimiento'},
]);
const amount=cents=>`${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
const id=invoice=>String(invoice.invoice_id??invoice.id);
// Colombian public holidays: Ley 51/1983. Gregorian Easter, with Emiliani Monday transfers.
export function colombianHolidays(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1,easter=dateDay(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const fixed=(month,day)=>dateDay(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  const monday=day=>day+(8-new Date(day*86400000).getUTCDay())%7;
  return new Set([...[[1,1],[5,1],[7,20],[8,7],[12,8],[12,25]].map(([m,d])=>fixed(m,d)),...[[1,6],[3,19],[6,29],[8,15],[10,12],[11,1],[11,11]].map(([m,d])=>monday(fixed(m,d))),easter-3,easter-2,monday(easter+39),monday(easter+60),monday(easter+68)].map(dateFromDay));
}
export function seventhBusinessDay(issueDate, rules){
  const weekdays = rules?.prompt_payment?.window?.calendar?.working_weekdays || [1,2,3,4,5];
  if (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Calendario laboral inválido.');
  let day=dateDay(issueDate),count=0;
  while(count<7){day++;const date=dateFromDay(day),weekday=new Date(day*86400000).getUTCDay();if((rules?.prompt_payment?.window?.calendar?.working_weekdays || [1,2,3,4,5]).includes(weekday)&&!isHoliday(date,rules))count++;}
  return dateFromDay(day);
}
export function contactDates(invoice,rules){
  if(!invoice)return MERTEL_CONTACTS.map(step=>({...step,date:null,deadline:null,applicable:false,reason:'Sin factura de referencia.'}));
  let issue,due;try{issue=dateDay(invoice.issue_date);due=dateDay(invoice.due_date);}catch{return MERTEL_CONTACTS.map(step=>({...step,date:null,deadline:null,applicable:false,reason:'Fechas de factura no disponibles.'}));}
  const prompt=seventhBusinessDay(invoice.issue_date,rules),limit=dateFromDay(issue+10);
  return MERTEL_CONTACTS.map(step=>{const date=step.stage==='prompt_payment'?prompt:dateFromDay(due+(step.stage==='five_days_before_due'?-5:step.stage==='overdue'?1:0));const applicable=step.stage!=='prompt_payment'||prompt<=limit;return {...step,date,deadline:step.stage==='prompt_payment'?limit:date,applicable,reason:applicable?'': 'El día hábil 7 excede el día calendario 10; no se envía pronto pago.'};});
}
export function sequenceCase({customer,invoices,rules,referenceDate}){
  const evaluated=evaluateCollectionCase({customer,invoices:engineInvoices(invoices),rules,referenceDate});
  const pending=invoices.filter(row=>!row.deleted_at&&moneyCents(row.balance)>0n);
  const total=amount(pending.reduce((sum,row)=>sum+moneyCents(row.balance),0n));
  const stageLabel=collectionStageCatalog(rules).find(row=>row.key===evaluated.stage)?.label||'Sin etapa de cobranza';
  return {evaluated,total,pending,item:{stage:evaluated.stage,stage_label:stageLabel,total_balance:total,main_invoice:evaluated.primaryInvoice?{invoice:evaluated.primaryInvoice}:null}};
}
export function sequenceAnchor({customer,invoices,rules,referenceDate,messages=[]},current){
  if(current.evaluated.primaryInvoice)return current.evaluated.primaryInvoice;
  const historic=messages.find(row=>row.message_mode==='AUTOMATICO'&&row.invoice_id&&invoices.some(invoice=>id(invoice)===String(row.invoice_id)));
  if(historic)return invoices.find(row=>id(row)===String(historic.invoice_id));
  const dates=[...new Set(current.pending.filter(row=>row.due_date>=referenceDate).map(row=>row.due_date))].sort();
  for(const date of dates){const predicted=evaluateCollectionCase({customer,invoices:current.pending,rules,referenceDate:date});if(predicted.primaryInvoice)return predicted.primaryInvoice;}
  return null;
}

export function isHoliday(date, rules) {
  const configured = rules?.prompt_payment?.window?.calendar?.holidays || [];
  return configured.includes(date) || colombianHolidays(Number(date.slice(0, 4))).has(date);
}
export function automaticDayAllowed(date, rules) {
  return new Date(dateDay(date) * 86400000).getUTCDay() !== 0 && !isHoliday(date, rules);
}
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
export function promo18(invoice) {
  const value = normalize(invoice.promo_18);
  return ['SI', 'YES', 'TRUE'].includes(value) || /^\d+(\.\d+)?$/.test(value) && moneyCents(value) > 0n || /PROMO\s*18\s*[:=]\s*SI\b/i.test(invoice.notes || '');
}
export function conditioned(invoice) {
  return normalize(invoice.discount_condition ?? invoice.discount) === 'CONDICIONADO' || /DSCTO\s*[:=]\s*CONDICIONADO\b/i.test(invoice.notes || '');
}
export function validMobile(phone) {
  if (typeof phone !== 'string' || !/^[+\d\s()-]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '');
  return /^(57)?3\d{9}$/.test(digits);
}
export function noticeContext(message) {
  if (!message?.automation_context) return null;
  return typeof message.automation_context === 'string' ? JSON.parse(message.automation_context) : message.automation_context;
}
const success = message => Boolean(message.sent_at) || ['SENT', 'DELIVERED', 'READ'].includes(message.status);
const engineInvoices = rows => rows.map(row => ({ ...row, promo_18: promo18(row) ? '1.00' : '0.00' }));
export const invoiceKey = id;
const cop = value => {
  const cents = moneyCents(value), whole = cents / 100n, fraction = cents % 100n;
  return `$${new Intl.NumberFormat('es-CO').format(whole)}${fraction ? ',' + String(fraction).padStart(2, '0') : ''}`;
};

// Message policy adapter around evaluateCollectionCase. It never changes classification or balances.
export function automaticNotices(input) {
  const { customer, invoices, rules, templates = [], settings, messages = [] } = input;
  const current = sequenceCase(input), groups = new Map();
  for (const invoice of current.pending) for (const step of contactDates(invoice, rules).filter(row => row.date)) {
    const key = `${step.stage}:${step.date}`;
    if (!groups.has(key)) groups.set(key, { ...step, notice_date: step.date, trigger_invoices: [] });
    groups.get(key).trigger_invoices.push(invoice);
  }
  const catalog = collectionStageCatalog(rules);
  return [...groups.values()].map(notice => {
    const expiry = dateFromDay(dateDay(notice.date) + 3);
    notice.expires_on = notice.stage === 'prompt_payment' ? notice.trigger_invoices.reduce((limit, invoice) => {
      const deadline = dateFromDay(dateDay(invoice.issue_date) + 10); return deadline < limit ? deadline : limit;
    }, expiry) : expiry;
    notice.invoice = notice.trigger_invoices[0];
    notice.invoice_ids = notice.trigger_invoices.map(id).sort();
    notice.matched = notice.stage === 'prompt_payment' ? current.pending : notice.stage === 'overdue' ? current.pending.filter(row => row.due_date < input.referenceDate) : current.pending.filter(row => row.due_date === notice.invoice.due_date);
    // Confirm the event against the same collection engine on its original date.
    const evidence = evaluateCollectionCase({ customer, invoices: engineInvoices(notice.trigger_invoices), rules, referenceDate: notice.date });
    const configured = settings.rules.find(row => row.stage === notice.stage && row.mode === 'AUTOMATICO' && row.enabled);
    notice.template_name = input.realTemplateName || notice.template_name;
    notice.template = templates.find(row => row.name === notice.template_name && row.status === 'active' && row.channel === 'whatsapp' && (!row.stage || row.stage === notice.stage) && (!configured || String(configured.template_id) === String(row.id)));
    notice.rule = notice.template && settings.rules.find(row => row.enabled && row.mode === 'AUTOMATICO' && row.stage === notice.stage && String(row.template_id) === String(notice.template.id));
    notice.message = messages.find(row => {
      if (row.message_mode !== 'AUTOMATICO' || row.stage !== notice.stage) return false;
      const saved = noticeContext(row);
      return saved?.notice_date === notice.date || (success(row) || !saved) && (saved?.invoice_ids || [row.invoice_id]).some(key => notice.invoice_ids.includes(String(key)));
    });
    let reason = notice.reason;
    if (!catalog.some(row => row.key === notice.stage) || !evidence.classifiedInvoices.some(row => row.eligible && row.stage === notice.stage)) reason ||= 'La etapa no está habilitada o no aplica en el motor de cobranza.';
    if (notice.stage === 'prompt_payment' && current.pending.every(promo18)) reason = 'Toda la cartera tiene PROMO 18 = SI; no aplica pronto pago.';
    if (notice.stage === 'prompt_payment' && current.pending.some(row => !promo18(row) && row.base_value == null)) reason = 'Falta base antes de IVA; no se inventa el descuento.';
    if (settings.excluded_customers?.[String(customer.id)]) reason = 'Cliente excluido de mensajes automáticos.';
    if (!validMobile(customer.phone)) reason = 'Cliente sin celular válido; no consume cupo.';
    if (input.contactAuthorized === false) reason = 'El cliente no tiene autorización registrada para avisos por WhatsApp.';
    if (input.referenceDate > notice.expires_on) reason = 'Aviso descartado: superó su ventana máxima.';
    if (!notice.template) reason ||= `Plantilla activa ${notice.template_name} no disponible.`;
    if (!notice.rule || !settings.automations_enabled) reason ||= 'Automatización no activada para esta etapa.';
    if (notice.message) reason = success(notice.message) ? 'Este aviso ya fue enviado; no se repite.' : notice.message.status === 'CANCELLED' ? 'Aviso cancelado; no se regenera.' : reason;
    notice.reason = reason || '';
    notice.applicable = !reason;
    notice.total = current.total;
    notice.current = current;
    return notice;
  }).sort((left, right) => MERTEL_CONTACTS.findIndex(row => row.stage === right.stage) - MERTEL_CONTACTS.findIndex(row => row.stage === left.stage) || left.date.localeCompare(right.date));
}

export function automaticSelection(input) {
  const notice = automaticNotices(input).find(row => row.applicable && row.date <= input.referenceDate && row.expires_on >= input.referenceDate && (!row.message || ['PENDING', 'FAILED'].includes(row.message.status)));
  return notice ? { ...notice.current, ...notice, step: notice, balance: amount(notice.matched.reduce((sum, row) => sum + moneyCents(row.balance), 0n)) } : null;
}

export function automaticContent(notice, referenceDate) {
  const rows = notice.matched;
  const listing = rows.map(row => {
    const value = moneyCents(row.document_value), balance = moneyCents(row.balance);
    let text = `${row.invoice_number}: ${value === balance ? cop(row.balance) : `valor ${cop(row.document_value)} · saldo pendiente ${cop(row.balance)}`}`;
    if (notice.stage === 'prompt_payment' && promo18(row)) text += ' · sin descuento (PROMO 18)';
    if (notice.stage === 'overdue' && conditioned(row)) text += ` · perdió el descuento condicionado · ${dateDay(row.due_date) - dateDay(row.issue_date)} días de crédito · ${dateDay(referenceDate) - dateDay(row.due_date)} días vencida`;
    return text;
  }).join('\n');
  const balance = amount(rows.reduce((sum, row) => sum + moneyCents(row.balance), 0n));
  const values = { cliente_nombre: notice.current.evaluated.customer.name, nombre_cliente: notice.current.evaluated.customer.name,
    nit: notice.current.evaluated.customer.nit, empresa: 'MERTEL IMPORTACIONES S.A.S.', cartera_detalle: listing,
    cantidad_facturas: rows.length, saldo: cop(balance), saldo_pendiente: cop(balance), total_cartera: cop(notice.total),
    saldo_en_mora: cop(balance), fecha_vencimiento: notice.invoice.due_date, numero_factura: notice.invoice.invoice_number,
    aviso_condicionado: rows.some(conditioned) && notice.stage !== 'overdue' ? 'Conserva el beneficio del descuento condicionado solamente si paga a tiempo.' : '',
    cupo_credito: notice.current.evaluated.customer.credit_limit == null ? null : cop(notice.current.evaluated.customer.credit_limit),
    cupo_disponible: notice.current.evaluated.customer.available_credit == null ? null : cop(notice.current.evaluated.customer.available_credit),
  };
  let lead;
  if (notice.stage === 'prompt_payment') {
    const base = rows.filter(row => !promo18(row)).reduce((sum, row) => sum + moneyCents(row.base_value), 0n);
    const discount = moneyCents(calculatePromptPaymentDiscount(amount(base)).amount);
    const collectible = rows.filter(row => !promo18(row)).reduce((sum, row) => sum + moneyCents(row.balance), 0n);
    if (discount > collectible || discount > moneyCents(notice.total)) throw new Error('El descuento sobre base antes de IVA supera el valor que realmente se cobra.');
    values.base_antes_iva = cop(amount(base)); values.descuento_pronto_pago = cop(amount(discount)); values.total_pronto_pago = cop(amount(moneyCents(notice.total) - discount));
    lead = `Total cartera ${values.total_cartera}\nBase antes de IVA con derecho a descuento ${values.base_antes_iva}\n3% de descuento sobre esa base ${values.descuento_pronto_pago}\nTotal a pagar antes del día calendario 10 (${notice.expires_on}) ${values.total_pronto_pago}`;
  } else if (notice.stage === 'overdue') lead = `Total en mora ${cop(balance)}. Le pedimos ponerse al día para no afectar su cupo de crédito.`;
  else {
    const when = referenceDate === notice.invoice.due_date ? 'hoy' : notice.invoice.due_date < referenceDate ? `el ${notice.invoice.due_date} (ya venció)` : `el ${notice.invoice.due_date}`;
    lead = rows.length === 1 ? `Su factura ${notice.invoice.due_date < referenceDate ? 'venció' : 'vence'} ${when}.` : `Sus ${rows.length} facturas ${notice.invoice.due_date < referenceDate ? 'vencieron' : 'vencen'} ${when}.`;
  }
  values.resumen_aviso = lead;
  // Empty conditional notice is intentionally valid; do not invent a missing variable.
  const content = `${lead}\n${listing}${values.aviso_condicionado ? '\n' + values.aviso_condicionado : ''}`;
  return { values, content, balance };
}

export function buildWhatsAppSequence(input, render = renderAutomaticNotice) {
  const current = sequenceCase(input), notices = automaticNotices(input);
  const steps = MERTEL_CONTACTS.flatMap(step => {
    const history = (input.messages || []).filter(row => row.message_mode === 'AUTOMATICO' && row.stage === step.stage).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const candidates = notices.filter(row => row.stage === step.stage);
    const dates = [...new Set([...candidates.map(row => row.date), ...history.map(row => noticeContext(row)?.notice_date || null)])].sort();
    if (!dates.length) dates.push(null);
    return dates.map(date => {
      const notice = candidates.find(row => row.date === date);
      const exactMessage = notice?.message && (noticeContext(notice.message)?.notice_date || null) === date ? notice.message : null;
      const message = exactMessage || history.find(row => (noticeContext(row)?.notice_date || null) === date) || null;
      let content = message?.content || '', reason = notice?.reason || (message ? 'Aviso registrado en el historial del canal.' : 'Cliente sin cartera aplicable a esta etapa.');
      if (notice?.applicable) { try { content = render(notice, input.referenceDate); } catch (error) { reason = error.message; } }
      return { ...step, template_name: input.realTemplateName || step.template_name, date, deadline: notice?.expires_on || noticeContext(message)?.expires_on || null,
        template_id: notice?.template ? String(notice.template.id) : message?.template_id || null,
        applicable: Boolean(notice?.applicable), reason, content, message,
        status: message ? message.status === 'PENDING' && message.scheduled_at ? 'PROGRAMADO' : message.status : notice?.applicable ? 'PENDIENTE' : 'NO APLICA' };
    });
  });
  const contactDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const last = (input.messages || []).filter(row => row.direction === 'outbound' && row.sent_at && contactDay(row.sent_at) <= input.referenceDate).sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0];
  const next = notices.filter(row => row.applicable && !success(row.message || {}) && row.date >= input.referenceDate).sort((a, b) => a.date.localeCompare(b.date))[0] || automaticSelection(input);
  return { customer: input.customer, total_balance: current.total, stage: current.item.stage, stage_label: current.item.stage_label,
    reference_date: input.referenceDate, steps, last_contact: last ? { date: last.sent_at, label: last.template_name, message: last } : null,
    next_contact: next ? { date: next.message?.scheduled_at || next.date, label: next.label, template_name: next.template_name } : null,
    excluded: Boolean(input.settings.excluded_customers?.[String(input.customer.id)]), notice: 'Fechas calculadas con cartera vigente; los avisos enviados no se repiten.' };
}

export function automaticWindow(notice, rules, now, previousMessages = []) {
  const latest = previousMessages.filter(row => row.message_mode === 'AUTOMATICO' && row.sent_at).reduce((last, row) => Math.max(last, new Date(row.sent_at).getTime()), 0);
  if (latest) now = new Date(Math.max(now.getTime(), latest + Number(notice.rule.interval_hours || 0) * 3600000));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  for (let offset = 0; offset <= 3; offset++) {
    const date = dateFromDay(dateDay(day) + offset);
    if (date > notice.expires_on) return null;
    const weekday = new Date(dateDay(date) * 86400000).getUTCDay() || 7;
    if (!automaticDayAllowed(date, rules) || !notice.rule.weekdays.includes(weekday)) continue;
    const start = new Date(`${date}T${notice.rule.start_time}:00-05:00`), end = new Date(`${date}T${notice.rule.end_time}:00-05:00`);
    if (now >= end) continue;
    const scheduled = new Date(Math.max(start.getTime(), now.getTime())); scheduled.setUTCMilliseconds(0); return scheduled;
  }
  return null;
}


export function renderAutomaticNotice(notice, day) {
  let computed; try { computed = automaticContent(notice, day); } catch (error) { throw error; }
  const optional = notice.template.content.replace(/\{\{\s*aviso_condicionado\s*\}\}/g, computed.values.aviso_condicionado);
  const rendered = renderMessageTemplate(optional, computed.values);
  if (rendered.missing_variables.length || rendered.unsupported_variables.length || rendered.malformed_variables || !optional.trim()) throw new Error('Faltan variables válidas en la plantilla automática.');
  // The approved template provides the introduction. Mandatory policy details cannot be omitted.
  const parts = [rendered.content];
  for (const required of [computed.values.resumen_aviso, computed.values.cartera_detalle, computed.values.aviso_condicionado]) if (required && !rendered.content.includes(required)) parts.push(required);
  const content = parts.join('\n');
  if ([...content.matchAll(/\b(\d+(?:[.,]\d+)?)\s*%/g)].some(match => notice.stage !== 'prompt_payment' || Number(match[1].replace(',', '.')) !== 3)) throw new Error('La plantilla no puede inventar porcentajes de descuento condicionado.');
  return content;
}
