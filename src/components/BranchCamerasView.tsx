import { useEffect, useState } from 'react';
import { Camera, CameraOff, Info, Loader2, Plus, RefreshCw, Save, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

type BranchCamera = {
  id: string;
  owner_user_id: string;
  name: string;
  branch_name: string;
  local_ip: string | null;
  rtsp_port: number;
  notes: string;
  stream_id: string;
  created_at: string;
};
const empty = { name: '', branch_name: 'Sucursal principal', local_ip: '', rtsp_port: 554, notes: '' };
const validPrivateIpv4 = (input: string) => {
  const x = input.trim();
  const parts = x.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export default function BranchCamerasView() {
  const { user, profile } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  const permitted = Boolean(user && profile?.approved && (role === 'ADMIN' || role === 'PROVEEDOR'));
  const [cameras, setCameras] = useState<BranchCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    if (!permitted || !user) { setCameras([]); return; }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from('branch_cameras')
      .select('id,owner_user_id,name,branch_name,local_ip,rtsp_port,notes,stream_id,created_at')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) { toast.error('No se pudieron cargar las cámaras: ' + error.message); return; }
    setCameras((data || []) as BranchCamera[]);
  };
  useEffect(() => { void load(); }, [user?.id, permitted]);

  const startAdd = () => { setEditing(null); setForm(empty); setOpenForm(true); };
  const startEdit = (camera: BranchCamera) => {
    setEditing(camera.id);
    setForm({
      name: camera.name, branch_name: camera.branch_name,
      local_ip: camera.local_ip || '', rtsp_port: camera.rtsp_port,
      notes: camera.notes || '',
    });
    setOpenForm(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!permitted || !user || saving) return;
    const name = form.name.trim(), branch = form.branch_name.trim(), ip = form.local_ip.trim();
    if (name.length < 2 || branch.length < 2) { toast.error('Completá nombre de cámara y sucursal.'); return; }
    if (ip && !validPrivateIpv4(ip)) { toast.error('Ingresá una IP privada válida como 192.168.18.26.'); return; }
    if (!Number.isInteger(Number(form.rtsp_port)) || Number(form.rtsp_port) < 1 || Number(form.rtsp_port) > 65535) {
      toast.error('Puerto RTSP inválido.'); return;
    }
    if (form.notes.length > 500) { toast.error('Las observaciones no pueden superar 500 caracteres.'); return; }
    setSaving(true);
    const payload = { name, branch_name: branch, local_ip: ip || null, rtsp_port: Number(form.rtsp_port), notes: form.notes.trim() };
    const query = (supabase as any).from('branch_cameras');
    const { error } = editing
      ? await query.update(payload).eq('id', editing).eq('owner_user_id', user.id)
      : await query.insert({ ...payload, owner_user_id: user.id });
    setSaving(false);
    if (error) { toast.error('No se pudo guardar: ' + error.message); return; }
    toast.success(editing ? 'Cámara actualizada' : 'Cámara registrada');
    setOpenForm(false);
    setEditing(null);
    await load();
  };
  const remove = async (camera: BranchCamera) => {
    if (!user || !permitted || !window.confirm('¿Eliminar la cámara «' + camera.name + '» de tu sucursal?')) return;
    const { error } = await (supabase as any).from('branch_cameras').delete().eq('id', camera.id).eq('owner_user_id', user.id);
    if (error) { toast.error('No se pudo eliminar: ' + error.message); return; }
    toast.success('Cámara eliminada');
    await load();
  };
  if (!permitted) return (
    <div className="app-card p-8 text-center space-y-3">
      <ShieldCheck className="mx-auto h-10 w-10 text-slate-500" />
      <h2 className="text-xl font-bold">Sucursal · Acceso restringido</h2>
      <p>Solo ADMIN y PROVEEDOR con cuenta aprobada pueden administrar sus cámaras.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-700 bg-[#101827] p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-500/15 p-3"><Camera className="h-7 w-7 text-sky-300" /></span>
            <div>
              <h2 className="text-2xl font-black">📹 Sucursal</h2>
              <p className="text-xs text-slate-400">Tus cámaras privadas · {role === 'ADMIN' ? 'Administrador' : 'Proveedor'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="nav-btn inline-flex items-center gap-2" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
            </button>
            <button className="nav-btn active inline-flex items-center gap-2" onClick={startAdd}>
              <Plus className="h-4 w-4" /> Nueva cámara
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-slate-300">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          Cada cuenta ve únicamente sus propias cámaras. Las contraseñas RTSP nunca se guardan aquí ni se muestran en la web.
        </div>
      </div>

      {cameras.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-500/40 bg-card p-10 text-center space-y-3">
          <CameraOff className="mx-auto h-10 w-10 text-slate-500" />
          <h3 className="font-bold">Todavía no tenés cámaras registradas.</h3>
          <p className="text-sm text-muted-foreground">Registrá tu cámara iCSee/VMS, asignale un nombre y sucursal.</p>
          <button className="nav-btn active" onClick={startAdd}>+ Registrar primera cámara</button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cameras.map(camera => (
          <div key={camera.id} className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827] text-white">
            <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-black/60 p-5 text-center">
              <CameraOff className="h-11 w-11 text-slate-500" />
              <span className="text-sm font-bold">Transmisión no conectada</span>
              <p className="max-w-xs text-xs text-slate-400">
                Se requiere un puente de video RTSP → WebRTC/HLS con acceso autenticado.
              </p>
            </div>
            <div className="space-y-3 p-4">
              <div><h3 className="font-bold text-lg">{camera.name}</h3><p className="text-xs text-slate-400">{camera.branch_name}</p></div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Wifi className="h-4 w-4 text-sky-300" />
                {camera.local_ip || 'IP local pendiente'} · RTSP {camera.rtsp_port}
              </div>
              {camera.notes && <p className="text-sm text-slate-300">{camera.notes}</p>}
              <div className="flex gap-2 border-t border-slate-700 pt-3">
                <button className="nav-btn flex-1" onClick={() => startEdit(camera)}>Editar</button>
                <button className="nav-btn !text-rose-300" aria-label={'Eliminar '+camera.name} onClick={() => void remove(camera)}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-bold"><Info className="h-4 w-4" /> Próximo paso para ver video en vivo</div>
        <p className="mt-1 text-muted-foreground">
          Tu cámara ya transmite por RTSP local. Para verla desde cualquier dispositivo, necesitás un servidor de video
          confiable en la misma red de la sucursal (por ejemplo MediaMTX) con conexión segura hacia la web y autorización
          por usuario. Vercel no puede acceder directamente a direcciones 192.168.x.x.
        </p>
        <p className="mt-1 text-muted-foreground">No abras el puerto RTSP al público, ni ingreses contraseñas en este formulario.</p>
      </div>

      {openForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-auto bg-black/70 p-4" onClick={() => setOpenForm(false)}>
          <form onSubmit={e => void save(e)} onClick={e => e.stopPropagation()}
            className="w-full max-w-xl space-y-4 rounded-2xl border border-slate-600 bg-[#101827] p-5 text-white shadow-2xl">
            <h3 className="text-xl font-extrabold">{editing ? 'Editar cámara' : 'Registrar cámara iCSee / VMS'}</h3>
            <label className="block space-y-1 text-sm">Nombre de cámara
              <input required minLength={2} maxLength={100} className="app-input w-full" placeholder="Corredor / Depósito" value={form.name}
                onChange={e=>setForm({...form,name:e.target.value})}/>
            </label>
            <label className="block space-y-1 text-sm">Sucursal
              <input required minLength={2} maxLength={100} className="app-input w-full" placeholder="Sucursal principal" value={form.branch_name}
                onChange={e=>setForm({...form,branch_name:e.target.value})}/>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-sm">IP privada de cámara
                <input className="app-input w-full" inputMode="decimal" placeholder="192.168.18.26" value={form.local_ip}
                  onChange={e=>setForm({...form,local_ip:e.target.value})}/>
              </label>
              <label className="block space-y-1 text-sm">Puerto RTSP
                <input className="app-input w-full" type="number" min="1" max="65535" value={form.rtsp_port}
                  onChange={e=>setForm({...form,rtsp_port:Number(e.target.value)})}/>
              </label>
            </div>
            <label className="block space-y-1 text-sm">Observaciones (opcional)
              <textarea className="app-input w-full" rows={2} maxLength={500} value={form.notes}
                onChange={e=>setForm({...form,notes:e.target.value})}/>
            </label>
            <p className="rounded-lg bg-slate-900 p-3 text-xs text-amber-200">
              Solo guardamos IP local y metadatos. La transmisión estará deshabilitada hasta conectar un gateway seguro.
              No pegues URL RTSP con usuario/contraseña.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="nav-btn" onClick={()=>setOpenForm(false)}>Cancelar</button>
              <button type="submit" className="nav-btn active inline-flex items-center gap-2" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4"/>}
                {saving ? 'Guardando…' : 'Guardar cámara'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
