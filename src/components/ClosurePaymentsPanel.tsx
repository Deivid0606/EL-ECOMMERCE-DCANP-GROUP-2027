import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);
const validFile = (f: File) => ['image/jpeg','image/png','image/webp','application/pdf'].includes(f.type) && f.size <= 8 * 1024 * 1024;

type Props = { role: string; email: string; userId?: string };
export default function ClosurePaymentsPanel({ role, email, userId }: Props) {
  const [banks, setBanks] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [orderList, setOrderList] = useState<any[]>([]);
  const [destination, setDestination] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState({bank_name:'',bank_account:'',bank_holder:'',bank_ci:''});
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
    const own = (b.data || []).find(x => x.owner_user_id===userId);
    if (own) setBank({bank_name:own.bank_name, bank_account:own.bank_account,bank_holder:own.bank_holder,bank_ci:own.bank_ci || ''});
    if (isDelivery) {
      const { data, error } = await supabase.from('orders').select('id,order_number,status,status2,total_gs,delivery_fee_gs,provider_emails_list,delivery_settled,assigned_delivery')
        .ilike('assigned_delivery', email).in('status',['ENTREGADO','ENCOMIENDA ENTREGADA']).eq('delivery_settled',false).limit(300);
      if (error) toast.error(error.message);
      setOrderList(data || []);
    }
  };
  useEffect(()=>{ if (email) void reload(); },[email,role,userId]);
  const dest = banks.find(b=>b.owner_user_id===destination);
  const destEmail = profiles.find(p=>p.user_id===destination)?.email || '';
  const eligible = useMemo(()=>orderList.filter(o=>{
    const owner = profiles.find(p=>p.user_id===destination);
    if (!owner) return false;
    if (owner.email.toLowerCase()===email.toLowerCase()) return false;
    const normalized = String(o.provider_emails_list || '').toLowerCase();
    // Un ADMIN puede centralizar el cobro; proveedor solo recibe pedidos propios.
    return profiles.some(p=>p.user_id===destination && banks.some(b=>b.owner_user_id===destination)) &&
      (owner.user_id===destination && (owner.email.toLowerCase()===destEmail.toLowerCase())) &&
      (normalized.includes(destEmail.toLowerCase()) || bankRoles[owner.user_id]==='ADMIN');
  }),[orderList,profiles,banks,destination,destEmail]);
  const [bankRoles,setBankRoles] = useState<Record<string,string>>({});
  useEffect(()=>{
    const ids=banks.map(b=>b.owner_user_id);
    if (!ids.length) return;
    supabase.from('user_roles').select('user_id,role').in('user_id',ids).eq('approved',true).then(({data})=>{
      setBankRoles(Object.fromEntries((data||[]).map(x=>[x.user_id,x.role])));
    });
  },[banks]);
  const selected = eligible.filter(o=>checked.includes(o.id));
  const total = selected.reduce((s,o)=>s+Math.max(0,Number(o.total_gs||0)-Number(o.delivery_fee_gs||0)),0);
  const saveBank = async () => {
    if (!userId || !Object.values(bank).slice(0,3).every(v=>v.trim())) { toast.error('Completá banco, cuenta y titular'); return; }
    setBusy(true);
    const { error } = await supabase.from('closure_bank_destinations').upsert({owner_user_id:userId,...bank,updated_at:new Date().toISOString()});
    setBusy(false); if (error) toast.error(error.message); else { toast.success('Cuenta bancaria guardada'); reload(); }
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
      <h5 className="font-bold">Mis datos bancarios para recibir cierres</h5>
      <div className="grid md:grid-cols-2 gap-2">
        <input className="app-input" placeholder="Banco" value={bank.bank_name} onChange={e=>setBank({...bank,bank_name:e.target.value})}/>
        <input className="app-input" placeholder="Número de cuenta" value={bank.bank_account} onChange={e=>setBank({...bank,bank_account:e.target.value})}/>
        <input className="app-input" placeholder="Titular" value={bank.bank_holder} onChange={e=>setBank({...bank,bank_holder:e.target.value})}/>
        <input className="app-input" placeholder="CI del titular (opcional)" value={bank.bank_ci} onChange={e=>setBank({...bank,bank_ci:e.target.value})}/>
      </div><button className="nav-btn active" disabled={busy} onClick={saveBank}>Guardar mis datos bancarios</button>
    </section>}
    {isDelivery && <section className="border border-border rounded-xl p-3 space-y-3">
      <h5 className="font-bold">🚚 Finalicé mi día — Hacer cierre</h5>
      <p className="text-xs text-muted-foreground">Seleccioná a quién rendir. Solo aparecerán pedidos entregados y sin rendir correspondientes a ese destinatario.</p>
      <select className="app-input w-full" value={destination} onChange={e=>{setDestination(e.target.value);setChecked([])}}>
        <option value="">Seleccionar cuenta de destino</option>{banks.filter(b=>profiles.some(p=>p.user_id===b.owner_user_id && p.email.toLowerCase()!==email.toLowerCase())).map(b=><option key={b.owner_user_id} value={b.owner_user_id}>{profiles.find(p=>p.user_id===b.owner_user_id)?.name || profiles.find(p=>p.user_id===b.owner_user_id)?.email} — {b.bank_name}</option>)}
      </select>
      {dest && <div className="bg-muted rounded-lg p-3 text-sm">Titular: <b>{dest.bank_holder}</b> · Banco: <b>{dest.bank_name}</b> · Cuenta: <b>{dest.bank_account}</b> · CI: {dest.bank_ci||'—'}</div>}
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
