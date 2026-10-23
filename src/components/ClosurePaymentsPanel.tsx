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
  const [orderList, setOrderList] = useState<any[]>([]);
  const [destination, setDestination] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
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
    if (isDelivery) {
      const { data: options, error: optionError } = await (supabase as any).rpc('list_delivery_bank_destinations');
      setCatalog(options || []);
      setCatalogError(optionError ? 'No se pudieron consultar las cuentas bancarias: ' + optionError.message : '');
      if (optionError) toast.error('No se pudieron cargar las cuentas de destino. Ejecutá el SQL de esta actualización.');
    }
    // La cuenta que se edita la determina bankTarget, no necesariamente el usuario conectado.
    // No sobrescribimos el formulario durante recargas para evitar perder cambios sin guardar.
    if (isDelivery) {
      const { data, error } = await supabase.from('orders').select('id,order_number,status,status2,total_gs,delivery_fee_gs,provider_emails_list,delivery_settled,assigned_delivery')
        .ilike('assigned_delivery', email).in('status',['ENTREGADO','ENCOMIENDA ENTREGADA']).eq('delivery_settled',false).limit(300);
      if (error) toast.error(error.message);
      setOrderList(data || []);
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
  const selected = eligible.filter(o=>checked.includes(o.id));
  const total = selected.reduce((s,o)=>s+Math.max(0,Number(o.total_gs||0)-Number(o.delivery_fee_gs||0)),0);
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
  const submit = async () => {
    if (!destination || !selected.length) {toast.error('Elegí destinatario y pedidos');return;}
    setBusy(true);
    try {
      const {data:id,error}=await supabase.rpc('submit_delivery_closure',{p_destination_user_id:destination,p_order_ids:selected.map(o=>o.id)});
      if(error) throw error;
      toast.success('Cierre creado. Adjuntá el comprobante abajo para enviarlo a revisión.');
      setChecked([]);await reload();
      document.getElementById('closure-submissions')?.scrollIntoView({behavior:'smooth'});
    } catch(e:any){toast.error(e.message || 'No se creó el cierre');}finally{setBusy(false);}
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
      <p className="text-xs text-muted-foreground">Seleccioná a quién rendir. Solo aparecerán pedidos entregados y sin rendir correspondientes a ese destinatario.</p>
      <select className="app-input w-full" value={destination} onChange={e=>{setDestination(e.target.value);setChecked([])}}>
        <option value="">Seleccionar cuenta de destino</option>{catalog.map(b=><option key={b.owner_user_id} value={b.owner_user_id}>{b.owner_name || b.owner_email || 'Destinatario'} ({b.owner_role === 'ADMIN' ? 'Administrador' : 'Proveedor'}) — {b.bank_name}</option>)}
      </select>
      {catalogError && <p className="text-sm text-red-600" role="alert">{catalogError}</p>}
      {!catalogError && catalog.length === 0 && <p className="text-sm text-amber-700">No hay cuentas bancarias disponibles para este delivery. El administrador debe guardar la cuenta para uno o más proveedores en Cierres y verificar que el proveedor esté aprobado.</p>}
      {dest && <div className="bg-muted rounded-lg p-3 text-sm">Titular: <b>{dest.bank_holder}</b> · Banco: <b>{dest.bank_name}</b> · Cuenta: <b>{dest.bank_account}</b> · CI: {dest.bank_ci||'—'} · Alias: <b>{dest.bank_alias||'—'}</b>{dest.bank_alias && <button className="nav-btn ml-2" onClick={()=>{void navigator.clipboard.writeText(dest.bank_alias);toast.success('Alias copiado')}}>Copiar alias</button>}</div>}
      {dest && eligible.length === 0 && <p className="text-sm text-amber-700">No se encontraron pedidos entregados, sin rendir y asignados a este delivery para la cuenta seleccionada. Revisá la asignación del delivery y el destinatario de los pedidos.</p>}
      <div className="max-h-56 overflow-auto space-y-1">{eligible.map(o=><label key={o.id} className="flex gap-2 items-center text-sm p-2 border-b border-border"><input type="checkbox" checked={checked.includes(o.id)} onChange={e=>setChecked(old=>e.target.checked?[...old,o.id]:old.filter(x=>x!==o.id))}/><span className="flex-1">#{o.order_number||o.id.slice(0,8)}</span><b>Gs {nf(Math.max(0,Number(o.total_gs||0)-Number(o.delivery_fee_gs||0)))}</b></label>)}</div>
      <p className="font-bold">Seleccionados: {selected.length} — Total estimado: Gs {nf(total)}</p>
      <p className="text-xs text-muted-foreground">El servidor validará y calculará nuevamente los importes antes de registrar. Los pedidos de encomienda requieren verificar las tarifas configuradas.</p>
      <button className="nav-btn active" disabled={busy||!selected.length} onClick={submit}>Finalicé mi día — Crear cierre</button>
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
