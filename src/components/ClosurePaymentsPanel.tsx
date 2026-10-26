import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);
const validFile = (f: File) => ['image/jpeg','image/png','image/webp','application/pdf'].includes(f.type) && f.size <= 8 * 1024 * 1024;

type Props = { role: string; email: string; userId?: string };
export default function ClosurePaymentsPanel({ role, email, userId }: Props) {
  const [banks, setBanks] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [recovery, setRecovery] = useState<any[]>([]);
  const [orphans, setOrphans] = useState<any[]>([]);
  const [orderList, setOrderList] = useState<any[]>([]);
  const [deliveryFees, setDeliveryFees] = useState<any[]>([]);
  const [feesLoadError, setFeesLoadError] = useState('');
  const [destination, setDestination] = useState('');
  const [newReceipt, setNewReceipt] = useState<File | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const emptyBank = {bank_name:'',bank_account:'',bank_holder:'',bank_ci:'',bank_alias:''};
  const [bank, setBank] = useState(emptyBank);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [applyToOwnAccount, setApplyToOwnAccount] = useState(false);
  const [providers, setProviders] = useState<{user_id:string; name:string|null; email:string|null}[]>([]);
  const canOwnBank = role === 'ADMIN' || role === 'PROVEEDOR';
  const isDelivery = role === 'DELIVERY';
  const reload = async () => {
    const [b,p,h] = await Promise.all([
      supabase.from('closure_bank_destinations').select('*'),
      supabase.from('profiles').select('user_id,email,name'),
      supabase.from('delivery_closure_submissions').select('*').order('created_at',{ascending:false}).limit(100),
    ]);
    if (b.error || h.error) { toast.error(b.error?.message || h.error?.message || 'Ejecutá primero el SQL adjunto'); return; }
    setBanks(b.data || []); setProfiles(p.data || []); setHistory(h.data || []);
    if (isDelivery || role === 'ADMIN') {
      const drafts = await supabase.from('delivery_closure_recovery' as any).select('*').order('created_at', { ascending: false }).limit(100);
      if (drafts.error) toast.error('No se pudo consultar recuperación de cierres: ' + drafts.error.message);
      else setRecovery(drafts.data || []);
    }
    if (role === 'ADMIN') {
      const missing = await (supabase as any).rpc('list_unlinked_closure_receipts');
      if (missing.error) toast.error('No se pudieron consultar comprobantes sin cierre: ' + missing.error.message);
      else setOrphans(missing.data || []);
    }
    if (isDelivery) {
      const { data: options, error: optionError } = await (supabase as any).rpc('list_delivery_bank_destinations');
      setCatalog(options || []);
      setCatalogError(optionError ? 'No se pudieron consultar las cuentas bancarias: ' + optionError.message : '');
      if (optionError) toast.error('No se pudieron cargar las cuentas de destino. Ejecutá el SQL de esta actualización.');
    }
    // La cuenta que se edita la determina bankTarget, no necesariamente el usuario conectado.
    // No sobrescribimos el formulario durante recargas para evitar perder cambios sin guardar.
    if (isDelivery) {
      const feeResult = await (supabase as any).rpc('get_closure_delivery_fees');
      if (feeResult.error) {
        setFeesLoadError('No se pudieron consultar las tarifas: ' + feeResult.error.message);
        setDeliveryFees([]);
      } else {
        setFeesLoadError('');
        setDeliveryFees(feeResult.data || []);
      }
      const { data, error } = await supabase.from('orders').select('id,order_number,status,status2,total_gs,delivery_fee_gs,city,provider_emails_list,delivery_settled,assigned_delivery')
        .ilike('assigned_delivery', email).in('status',['ENTREGADO','ENCOMIENDA ENTREGADA']) .eq('delivery_settled',false).range(0,499);
      if (error) { toast.error(error.message); setOrderList([]); return; }
      const all = [...(data || [])];
      let offset = 500;
      while (all.length === offset && offset < 5000) {
        const page = await supabase.from('orders').select('id,order_number,status,status2,total_gs,delivery_fee_gs,city,provider_emails_list,delivery_settled,assigned_delivery')
          .ilike('assigned_delivery', email).in('status',['ENTREGADO','ENCOMIENDA ENTREGADA']).eq('delivery_settled',false).range(offset, offset+499);
        if (page.error) { toast.error('No se pudieron cargar todos los pedidos: '+page.error.message); setOrderList([]); return; }
        all.push(...(page.data || []));
        if ((page.data || []).length < 500) break;
        offset += 500;
      }
      setOrderList(all);
    }
  };
  useEffect(()=>{ if (email) void reload(); },[email,role,userId]);
  useEffect(()=>{
    if(role !== 'ADMIN') return;
    (async()=>{
      const {data:roles,error}=await supabase.from('user_roles').select('user_id,role').eq('role','PROVEEDOR').eq('approved',true);
      if(error){toast.error('No se pudo cargar la lista de proveedores: '+error.message);return;}
      const ids=[...new Set((roles||[]).map(r=>r.user_id))];
      if(!ids.length){setProviders([]);return;}
      const {data:people,error:profilesError}=await supabase.from('profiles').select('user_id,name,email').in('user_id',ids);
      if(profilesError){toast.error('No se pudieron cargar los proveedores: '+profilesError.message);return;}
      setProviders(people||[]);
    })();
  },[role]);
  useEffect(()=>{
    if (role !== 'PROVEEDOR' || !userId) return;
    const saved = banks.find(b=>b.owner_user_id===userId);
    setBank(saved ? {bank_name:saved.bank_name||'',bank_account:saved.bank_account||'',bank_holder:saved.bank_holder||'',bank_ci:saved.bank_ci||'',bank_alias:saved.bank_alias||''} : {bank_name:'',bank_account:'',bank_holder:'',bank_ci:'',bank_alias:''});
  },[role,userId,banks]);
  const dest = catalog.find(b=>b.owner_user_id===destination);
  const destEmail = dest?.owner_email || ''; 
  const eligible = useMemo(() => orderList.filter(o => {
    if (!dest || !destEmail) return false;
    if (dest.owner_role === 'ADMIN') return true;
    // Para un proveedor, mostrar solamente pedidos donde aparece su email.
    const value = String(o.provider_emails_list || '').toLowerCase();
    return value.split(/[,;\s]+/).map(x => x.trim()).includes(String(destEmail).toLowerCase());
  }), [orderList, dest, destEmail]);
  // Regla obligatoria: se incluyen TODOS los pedidos elegibles del destinatario.
  const selected = eligible;
  const normalize = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const feeInfo = (o: any) => {
    const frozen = Number(o.delivery_fee_gs || 0);
    if (frozen > 0) return { fee: frozen, configured: true };
    const matching = deliveryFees.find(f => normalize(f.delivery_email) === normalize(o.assigned_delivery) && normalize(f.city) === normalize(o.city));
    return { fee: Number(matching?.fee_gs || 0), configured: Boolean(matching) };
  };
  const orderLimitReached = orderList.length >= 5000;
  const selectedMissingRate = selected.some(o => !feeInfo(o).configured);
  const collected = selected.reduce((sum,o)=>sum+(o.status === 'ENTREGADO' ? Number(o.total_gs || 0) : 0),0);
  const deliveryPay = selected.reduce((sum,o)=>sum+feeInfo(o).fee,0);
  const total = collected - deliveryPay;
  const saveBank = async () => {
    const targets = role === 'ADMIN'
      ? [...new Set([...selectedProviderIds, ...(applyToOwnAccount && userId ? [userId] : [])])]
      : userId ? [userId] : [];
    if (!targets.length || !bank.bank_name.trim() || !bank.bank_account.trim() || !bank.bank_holder.trim()) {
      toast.error('Seleccioná al menos un destinatario y completá banco, cuenta y titular'); return;
    }
    if (role !== 'ADMIN' && (targets.length !== 1 || targets[0] !== userId)) {
      toast.error('Solo podés editar tu propia cuenta'); return;
    }
    if (role === 'ADMIN' && targets.some(id => id !== userId && !providers.some(p => p.user_id === id))) {
      toast.error('Uno de los proveedores seleccionados no está autorizado'); return;
    }
    if (role === 'ADMIN' && !confirm(`¿Guardar estos mismos datos bancarios para ${targets.length} destinatario(s)? Esto reemplazará los datos previos de los seleccionados.`)) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      // Se guardan los mismos datos para cada destinatario seleccionado.
      // No se alteran las cuentas de los proveedores no seleccionados.
      const rows = targets.map(owner_user_id => ({ owner_user_id, ...bank, updated_at: now }));
      const { error } = await supabase.from('closure_bank_destinations').upsert(rows, { onConflict: 'owner_user_id' });
      if (error) throw error;
      toast.success(`Datos bancarios guardados para ${targets.length} destinatario(s)`);
      await reload();
    } catch (e: any) { toast.error(e.message || 'No se pudieron guardar los datos bancarios'); }
    finally { setBusy(false); }
  };
  const upload = async (folder: string, id: string, file: File) => {
    if (!validFile(file)) throw new Error('Archivo inválido: JPG, PNG, WEBP o PDF hasta 8 MB');
    const ext = file.type==='application/pdf'?'pdf':file.type.split('/')[1];
    const path=`${folder}/${id}/${crypto.randomUUID()}.${ext}`;
    const {error}=await supabase.storage.from('financial-receipts').upload(path,file,{contentType:file.type,upsert:false});
    if(error) throw error;
    return path;
  };
  const finishRecovery = async (draft: any) => {
    setBusy(true);
    try {
      const { data: found, error: findError } = await supabase.from('delivery_closure_submissions').select('id').eq('receipt_path', draft.receipt_path).limit(1);
      if (findError) throw findError;
      if (found?.length) {
        await supabase.from('delivery_closure_recovery' as any).update({status:'COMPLETADO',last_error:null}).eq('id',draft.id);
        toast.success('Este comprobante ya pertenece a un cierre; no se duplicó.');
        await reload(); return;
      }
      const { data: fileData, error: fileError } = await supabase.storage.from('financial-receipts').info(draft.receipt_path);
      if (fileError || !fileData) throw new Error('El archivo todavía no está cargado. Volvé a seleccionarlo y realizá un nuevo envío.');
      const { error } = await (supabase as any).rpc('submit_delivery_closure_with_receipt', {
        p_destination_user_id:draft.destination_user_id,
        p_order_ids:draft.order_ids,
        p_receipt_path:draft.receipt_path
      });
      if (error) throw error;
      await supabase.from('delivery_closure_recovery' as any).update({status:'COMPLETADO',last_error:null}).eq('id',draft.id);
      toast.success('Cierre registrado correctamente. Pendiente de aprobación.');
      setNewReceipt(null); await reload();
    } catch(e:any) {
      await supabase.from('delivery_closure_recovery' as any).update({last_error:e.message||'Error desconocido'}).eq('id',draft.id);
      toast.error('Cierre NO registrado: '+(e.message||'Error desconocido'));
      await reload();
    } finally {setBusy(false);}
  };
  const submit = async () => {
    if (!destination || !selected.length) { toast.error('Seleccioná un proveedor que tenga pedidos entregados pendientes de rendición'); return; }
    if (!newReceipt || !validFile(newReceipt)) { toast.error('Adjuntá un comprobante válido de hasta 8 MB'); return; }
    if (feesLoadError || selectedMissingRate || total < 0 || orderLimitReached) { toast.error('Revisá las tarifas y el saldo del cierre'); return; }
    if (!userId) { toast.error('No se identificó tu usuario'); return; }
    if (!confirm(`¿Confirmás que transferiste Gs ${nf(total)} al destinatario seleccionado?`)) return;
    setBusy(true);
    try {
      const ext = newReceipt.type === 'application/pdf' ? 'pdf' : newReceipt.type.split('/')[1];
      const path = `closure-pending/${userId}/${crypto.randomUUID()}.${ext}`;
      const {data: draft,error: draftError} = await supabase.from('delivery_closure_recovery' as any).insert({
        delivery_user_id:userId, destination_user_id:destination,
        order_ids:selected.map(o=>o.id),receipt_path:path,status:'PREPARADO'
      }).select('*').single();
      if (draftError) throw draftError;
      const {error: uploadError} = await supabase.storage.from('financial-receipts').upload(path,newReceipt,{contentType:newReceipt.type,upsert:false});
      if(uploadError) {
        await supabase.from('delivery_closure_recovery' as any).update({last_error:'Falló carga: '+uploadError.message}).eq('id',(draft as any).id);
        throw uploadError;
      }
      await supabase.from('delivery_closure_recovery' as any).update({status:'ARCHIVO_CARGADO'}).eq('id',(draft as any).id);
      const {error} = await (supabase as any).rpc('submit_delivery_closure_with_receipt', {
        p_destination_user_id:destination,p_order_ids:selected.map(o=>o.id),p_receipt_path:path
      });
      if(error) {
        await supabase.from('delivery_closure_recovery' as any).update({last_error:error.message}).eq('id',(draft as any).id);
        throw error;
      }
      await supabase.from('delivery_closure_recovery' as any).update({status:'COMPLETADO',last_error:null}).eq('id',(draft as any).id);
      toast.success('Cierre registrado con comprobante, pendiente de aprobación.');
      setNewReceipt(null);await reload();
    } catch(e:any) {
      toast.error('No se registró el cierre: '+(e.message||'Error desconocido')+'. Revisá Recuperación de cierres antes de volver a subir el archivo.');
      await reload();
    } finally {setBusy(false);}
  };
  const attach = async (id:string) => {
    const file=files[id];if(!file){toast.error('Elegí un comprobante');return;}
    setBusy(true);
    try {const path=await upload('closure',id,file);const {error}=await supabase.rpc('attach_delivery_closure_receipt',{p_closure_id:id,p_path:path});if(error)throw error;toast.success('Comprobante enviado para revisión');await reload();}
    catch(e:any){toast.error(e.message)}finally{setBusy(false);}
  };
  const reopen = async(id:string)=>{
    setBusy(true); const {error}=await supabase.rpc('reopen_rejected_delivery_closure',{p_closure_id:id}); setBusy(false);
    if(error)toast.error(error.message);else {toast.success('Cierre reabierto; adjuntá nuevo comprobante');await reload();}
  };
  const review = async(id:string,approve:boolean)=>{
    const reason=approve?'':prompt('Motivo del rechazo:') || '';
    if(!approve && !reason.trim())return;
    if(approve&&!confirm('¿Confirmás que recibiste el importe correcto? Se rendirán todos los pedidos del cierre.'))return;
    setBusy(true);
    const {error}=await supabase.rpc('review_delivery_closure',{p_closure_id:id,p_approve:approve,p_reason:reason});
    setBusy(false);if(error)toast.error(error.message);else{toast.success(approve?'Cierre aprobado. Pedidos rendidos.':'Cierre rechazado');await reload();}
  };
  const seeReceipt=async(path:string)=>{
    const {data,error}=await supabase.storage.from('financial-receipts').createSignedUrl(path,60);
    if(error||!data?.signedUrl){toast.error(error?.message||'Sin acceso al comprobante');return;}
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
  };
  return <div className="app-card !p-4 my-4 space-y-4">
    <div className="flex justify-between items-center"><h4 className="font-extrabold">🏦 Rendiciones con comprobantes</h4><button className="nav-btn" onClick={reload}>Actualizar</button></div>
    {canOwnBank && <section className="border border-border rounded-xl p-3 space-y-2">
      <h5 className="font-bold">{role==='ADMIN'?'Configurar cuentas bancarias para cierres':'Mis datos bancarios para recibir cierres'}</h5>
      {role==='ADMIN' && <div className="space-y-2">
        <p className="block text-sm font-semibold">Seleccioná todos los proveedores que utilizarán esta cuenta bancaria</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="nav-btn" onClick={()=>setSelectedProviderIds(providers.map(p=>p.user_id))}>Seleccionar todos ({providers.length})</button>
          <button type="button" className="nav-btn" onClick={()=>setSelectedProviderIds([])}>Limpiar selección</button>
        </div>
        <div className="max-h-52 overflow-y-auto border border-border rounded-lg p-2 space-y-2">
          {providers.length===0 && <p className="text-xs text-muted-foreground">No se encontraron proveedores aprobados.</p>}
          {providers.map(p=><label key={p.user_id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selectedProviderIds.includes(p.user_id)} onChange={e=>setSelectedProviderIds(old=>e.target.checked?[...old,p.user_id]:old.filter(id=>id!==p.user_id))}/>
            <span>{p.name||p.email||'Proveedor'} {p.email ? `— ${p.email}` : ''}</span>
          </label>)}
        </div>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={applyToOwnAccount} onChange={e=>setApplyToOwnAccount(e.target.checked)}/> Incluir también mi cuenta de administrador</label>
        <p className="text-xs text-muted-foreground">Seleccionados: {selectedProviderIds.length + (applyToOwnAccount ? 1 : 0)}. Se copiarán los mismos datos a cada proveedor marcado. Los proveedores no seleccionados conservan su cuenta actual.</p>
        <p className="text-xs text-amber-700">Si un proveedor ya tiene datos bancarios guardados, al confirmar serán reemplazados por estos datos.</p>
      </div>}
      <div className="grid md:grid-cols-2 gap-2">
        <input className="app-input" placeholder="Banco" value={bank.bank_name} onChange={e=>setBank({...bank,bank_name:e.target.value})}/>
        <input className="app-input" placeholder="Número de cuenta" value={bank.bank_account} onChange={e=>setBank({...bank,bank_account:e.target.value})}/>
        <input className="app-input" placeholder="Titular" value={bank.bank_holder} onChange={e=>setBank({...bank,bank_holder:e.target.value})}/>
        <input className="app-input" placeholder="CI del titular (opcional)" value={bank.bank_ci} onChange={e=>setBank({...bank,bank_ci:e.target.value})}/>
        <input className="app-input" placeholder="Alias bancario (opcional)" value={bank.bank_alias} onChange={e=>setBank({...bank,bank_alias:e.target.value})}/>
      </div><button className="nav-btn active" disabled={busy} onClick={saveBank}>{role==='ADMIN'?`Guardar para ${selectedProviderIds.length + (applyToOwnAccount ? 1 : 0)} destinatario(s)`:'Guardar mis datos bancarios'}</button>
    </section>}
    {isDelivery && <section className="border border-border rounded-xl p-3 space-y-3">
      <h5 className="font-bold">🚚 Finalicé mi día — Hacer cierre</h5>
      <p className="text-xs text-muted-foreground">Seleccioná el proveedor o destinatario. Todos sus pedidos entregados y pendientes de rendición se incluyen obligatoriamente; no se permiten cierres parciales.</p>
      <select className="app-input w-full" value={destination} onChange={e=>{setDestination(e.target.value);setNewReceipt(null)}}>
        <option value="">Seleccionar cuenta de destino</option>{catalog.map(b=><option key={b.owner_user_id} value={b.owner_user_id}>{b.owner_name || b.owner_email || 'Destinatario'} ({b.owner_role === 'ADMIN' ? 'Administrador' : 'Proveedor'}) — {b.bank_name}</option>)}
      </select>
      {catalogError && <p className="text-sm text-red-600" role="alert">{catalogError}</p>}
      {!catalogError && catalog.length === 0 && <p className="text-sm text-amber-700">No hay cuentas bancarias disponibles para este delivery. El administrador debe guardar la cuenta para uno o más proveedores en Cierres y verificar que el proveedor esté aprobado.</p>}
      {dest && <div className="bg-muted rounded-lg p-3 text-sm">Titular: <b>{dest.bank_holder}</b> · Banco: <b>{dest.bank_name}</b> · Cuenta: <b>{dest.bank_account}</b> · CI: {dest.bank_ci||'—'} · Alias: <b>{dest.bank_alias||'—'}</b>{dest.bank_alias && <button className="nav-btn ml-2" onClick={()=>{void navigator.clipboard.writeText(dest.bank_alias);toast.success('Alias copiado')}}>Copiar alias</button>}</div>}
      {dest && eligible.length === 0 && <p className="text-sm text-amber-700">No se encontraron pedidos entregados, sin rendir y asignados a este delivery para la cuenta seleccionada. Revisá la asignación del delivery y el destinatario de los pedidos.</p>}
      <div className="max-h-56 overflow-auto space-y-1">{eligible.map(o=><label key={o.id} className="flex gap-2 items-center text-sm p-2 border-b border-border"><input type="checkbox" checked disabled aria-label="Pedido incluido obligatoriamente"/><span className="flex-1">#{o.order_number||o.id.slice(0,8)}</span><b>Gs {nf((o.status === 'ENTREGADO' ? Number(o.total_gs || 0) : 0) - feeInfo(o).fee)}</b></label>)}</div>
      <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
        <p>Pedidos incluidos obligatoriamente: <b>{selected.length} de {eligible.length}</b></p>
        <p>Total cobrado en pedidos normales: <b>Gs {nf(collected)}</b></p>
        <p>Ganancia del delivery (incluye encomiendas): <b>− Gs {nf(deliveryPay)}</b></p>
        <p className="text-lg font-extrabold">Monto NETO a transferir: Gs {nf(Math.max(0,total))}</p>
      </div>
      {orderLimitReached && <p className="text-sm text-red-600">Hay demasiados pedidos para procesar de una vez. Contactá al administrador: no se permitirá rendir solo una parte.</p>}
      {feesLoadError && <p className="text-sm text-red-600">{feesLoadError}</p>}
      {selectedMissingRate && <p className="text-sm text-red-600">Hay pedidos sin tarifa de delivery registrada para su ciudad. Configurá las tarifas antes del cierre.</p>}
      {total < 0 && <p className="text-sm text-red-600">La ganancia del delivery supera el dinero cobrado. Este cierre no puede generar una transferencia negativa; debe resolverse el saldo con administración.</p>}
      <p className="text-xs text-muted-foreground">El servidor verificará las tarifas y volverá a calcular el neto. Encomiendas entregadas: no se suma el precio del pedido; solo se descuenta su tarifa.</p>
      <div className="rounded-lg border border-border p-3 space-y-2">
        <label htmlFor="closure-new-receipt" className="block text-sm font-bold">📎 Comprobante de transferencia (obligatorio)</label>
        <input id="closure-new-receipt" className="block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>{
          const f=e.target.files?.[0]||null;
          if(f && !validFile(f)){toast.error('Solo JPG, PNG, WEBP o PDF hasta 8 MB');setNewReceipt(null);e.target.value='';return;}
          setNewReceipt(f);
        }}/>
        <p className="text-xs text-muted-foreground">{newReceipt ? `Archivo listo: ${newReceipt.name}` : 'Todos los pedidos del proveedor están incluidos. Transferí el monto neto y adjuntá el comprobante antes de finalizar.'}</p>
      </div>
      <button className="nav-btn active" disabled={busy||!selected.length||!newReceipt||Boolean(feesLoadError)||selectedMissingRate||total<0||orderLimitReached} onClick={submit}>{busy?'Enviando cierre...':'✅ Finalicé mi día — Enviar cierre con comprobante'}</button>
    </section>}
    {(isDelivery || role==='ADMIN') && <section className="border border-border rounded-xl p-3 space-y-2">
      <h5 className="font-bold">🛟 Recuperación de cierres incompletos</h5>
      <p className="text-xs text-muted-foreground">Estos registros no son pagos aprobados ni pedidos rendidos. El reintento vuelve a validar pedidos y monto en Supabase.</p>
      {recovery.filter(d=>d.status!=='COMPLETADO').length===0 && <p className="text-sm">Sin intentos incompletos registrados desde esta actualización.</p>}
      {recovery.filter(d=>d.status!=='COMPLETADO').map(d=><div key={d.id} className="border border-border p-2 rounded-lg text-sm space-y-1">
        <p><b>{new Date(d.created_at).toLocaleString('es-PY')}</b> · {d.status}</p>
        <p>Pedidos declarados: {d.order_ids?.length||0} · Destinatario: {d.destination_user_id}</p>
        {d.last_error && <p className="text-red-600 break-words">Error: {d.last_error}</p>}
        {d.delivery_user_id === userId && <button type="button" className="nav-btn active" disabled={busy||d.status==='PREPARADO'} onClick={()=>finishRecovery(d)}>Reintentar registro con el mismo comprobante</button>}
        {d.status==='PREPARADO' && <p className="text-amber-700">La subida no se confirmó. Verificá el archivo antes de intentar otra transferencia.</p>}
      </div>)}
    </section>}
    {role==='ADMIN' && <section className="border border-border rounded-xl p-3 space-y-2">
      <h5 className="font-bold">🔎 Comprobantes sin cierre asociado — conciliación</h5>
      <p className="text-xs text-amber-700">Estos archivos no acreditan que el dinero haya llegado. Verificá manualmente transferencia, monto, destinatario y pedidos antes de cualquier ajuste.</p>
      {orphans.length===0 && <p className="text-sm">No se encontraron archivos sueltos.</p>}
      {orphans.map(o=><div key={o.receipt_path} className="border-b border-border p-2 text-sm space-y-1">
        <p>{o.delivery_email||o.delivery_user_id||'Sin identificar'} · {new Date(o.uploaded_at).toLocaleString('es-PY')}</p>
        <p className="text-xs break-all">{o.receipt_path}</p>
        <button type="button" className="nav-btn" onClick={()=>seeReceipt(o.receipt_path)}>Ver archivo</button>
      </div>)}
    </section>}
    <section id="closure-submissions" className="space-y-3"><h5 className="font-bold">📋 Cierres y comprobantes</h5>
      {history.length===0 && <p className="text-sm text-muted-foreground">Sin cierres registrados.</p>}
      {history.map(c=><div key={c.id} className="border border-border rounded-xl p-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-2 justify-between"><b>Cierre {c.id.slice(0,8)} · Gs {nf(Number(c.amount_gs||0))}</b><span className="badge-status">{c.status}{!c.receipt_path && c.status==='PENDIENTE'?' · Falta comprobante':''}</span></div>
        <p>Delivery: {c.delivery_email} · Destinatario: {c.destination_email}</p>
        <p className="text-xs">{new Date(c.created_at).toLocaleString('es-PY')}</p>
        {c.receipt_path && <button className="nav-btn" onClick={()=>seeReceipt(c.receipt_path)}>📄 Ver comprobante</button>}
        {c.delivery_email.toLowerCase()===email.toLowerCase() && c.status==='PENDIENTE' && !c.receipt_path && <div className="flex flex-wrap items-center gap-2"><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setFiles(old=>({...old,[c.id]:e.target.files?.[0]||null}))}/><button className="nav-btn active" disabled={busy||!files[c.id]} onClick={()=>attach(c.id)}>Subir comprobante y enviar</button></div>}
        {(role==='ADMIN'||(role==='PROVEEDOR'&&c.destination_email.toLowerCase()===email.toLowerCase())) && c.status==='PENDIENTE' && c.receipt_path && <div className="flex gap-2"><button className="nav-btn active" disabled={busy} onClick={()=>review(c.id,true)}>✅ Aprobar y rendir pedidos</button><button className="nav-btn" disabled={busy} onClick={()=>review(c.id,false)}>Rechazar</button></div>}
        {c.status==='RECHAZADO' && <p className="text-xs">Motivo: {c.rejection_reason}</p>}
        {c.status==='RECHAZADO' && c.delivery_email.toLowerCase()===email.toLowerCase() && <button className="nav-btn" disabled={busy} onClick={()=>reopen(c.id)}>Corregir comprobante y reenviar</button>}
      </div>)}
    </section>
  </div>;
}
