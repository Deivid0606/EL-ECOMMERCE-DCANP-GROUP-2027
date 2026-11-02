import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function UsersView() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [loading, setLoading] = useState(true);

  const loadUsers = async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    // Última conexión, ventas, comisión pendiente y perfil de cobro (sólo admin).
    const { data: overview } = await (supabase as any).rpc('admin_users_overview');
    const ov = new Map<string, any>(((overview || []) as any[]).map((o) => [o.user_id, o]));

    const merged = (profiles || []).map(p => {
      const r = (roles || []).find(r => r.user_id === p.user_id);
      return { ...p, role: r?.role || 'PENDIENTE', approved: r?.approved || false, role_id: r?.id, overview: ov.get(p.user_id) };
    });
    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const viewDocs = async (o: any) => {
    const paths = [o?.id_front_path, o?.id_back_path, o?.selfie_path].filter(Boolean);
    if (!paths.length) { toast.info('Todavía no subió fotos de su cédula'); return; }
    for (const path of paths) {
      const { data } = await supabase.storage.from('kyc-documents').createSignedUrl(path, 300);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
    }
  };

  const lastSeen = (iso?: string | null) => {
    if (!iso) return 'Nunca';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    const when = new Date(iso).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    return days <= 0 ? `Hoy ${when.split(' ').pop()}` : days === 1 ? `Ayer · ${when}` : `Hace ${days} días · ${when}`;
  };

  const filtered = users.filter(u => {
    if (filterRole && u.role !== filterRole) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q);
  });

  const approveUser = async (userId: string) => {
    const { error } = await supabase.from('user_roles').update({ approved: true }).eq('user_id', userId);
    if (error) toast.error(error.message);
    else { toast.success('Usuario aprobado'); loadUsers(); }
  };

  const rejectUser = async (userId: string) => {
    if (!confirm('¿Estás seguro de rechazar este usuario? Se eliminará su rol.')) return;
    const { error } = await supabase.from('user_roles').delete().eq('user_id', userId);
    if (error) toast.error(error.message);
    else { toast.success('Usuario rechazado'); loadUsers(); }
  };

  const setPassword = async (u: any) => {
    const pass = window.prompt(`🔑 Contraseña nueva para ${u.name || u.email} (${u.email})\nMínimo 6 caracteres. Después pasásela al usuario.`);
    if (pass === null) return;
    if (pass.trim().length < 6) { toast.error('Mínimo 6 caracteres'); return; }
    const { data, error } = await supabase.functions.invoke('admin-set-password', { body: { user_id: u.user_id, password: pass.trim() } });
    const msg = (data as any)?.error || error?.message;
    if (msg) { toast.error(msg); return; }
    toast.success(`🔑 Contraseña cambiada para ${u.email}. Ya puede entrar con la nueva.`, { duration: 8000 });
  };

  const revokeUser = async (userId: string) => {
    if (!confirm('¿Revocar acceso a este usuario?')) return;
    const { error } = await supabase.from('user_roles').update({ approved: false }).eq('user_id', userId);
    if (error) toast.error(error.message);
    else { toast.success('Acceso revocado'); loadUsers(); }
  };

  const changeRole = async (userId: string, newRole: string) => {
    const { error } = await supabase.from('user_roles').update({ role: newRole as any }).eq('user_id', userId);
    if (error) toast.error(error.message);
    else { toast.success('Rol actualizado'); loadUsers(); }
  };

  const kpis = {
    total: users.length,
    pending: users.filter(u => !u.approved).length,
    vendors: users.filter(u => u.role === 'VENDEDOR').length,
    delivery: users.filter(u => u.role === 'DELIVERY').length,
  };

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">👥 Gestión de Usuarios</h3>

      <div className="grid-kpi mb-4">
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Total usuarios</div><div className="text-[22px] font-extrabold">{kpis.total}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Pendientes</div><div className="text-[22px] font-extrabold">{kpis.pending}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Vendedores</div><div className="text-[22px] font-extrabold">{kpis.vendors}</div></div>
        <div className="kpi-card"><div className="text-xs text-muted-foreground mb-1">Delivery</div><div className="text-[22px] font-extrabold">{kpis.delivery}</div></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input className="app-input flex-1 min-w-[200px]" placeholder="🔎 Buscar por nombre, email, rol..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="app-input !w-auto" value={filterRole} onChange={e => setFilterRole(e.target.value)}>
          <option value="">Todos los roles</option>
          <option value="ADMIN">ADMIN</option>
          <option value="VENDEDOR">VENDEDOR</option>
          <option value="DELIVERY">DELIVERY</option>
          <option value="DESPACHANTE">DESPACHANTE</option>
          <option value="PROVEEDOR">PROVEEDOR</option>
        </select>
        <button className="nav-btn active" onClick={loadUsers}>Filtrar</button>
      </div>

      <div className="overflow-auto">
        <table className="app-table min-w-[1300px]">
          <thead>
            <tr>
              <th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Última conexión</th><th className="text-right">Ventas</th><th className="text-right">Comisión pendiente</th><th>Perfil de cobro</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td className="text-sm">{u.name}</td>
                <td className="text-sm">{u.email}</td>
                <td>
                  <select className="app-input !w-auto !py-1 !px-2 text-xs" value={u.role}
                    onChange={e => changeRole(u.user_id, e.target.value)}>
                    <option value="ADMIN">ADMIN</option>
                    <option value="VENDEDOR">VENDEDOR</option>
                    <option value="DELIVERY">DELIVERY</option>
                    <option value="DESPACHANTE">DESPACHANTE</option>
                    <option value="PROVEEDOR">PROVEEDOR</option>
                  </select>
                </td>
                <td>
                  <span className={`badge-status ${u.approved ? 'badge-entregado' : 'badge-pendiente'}`}>
                    {u.approved ? 'Aprobado' : 'Pendiente'}
                  </span>
                </td>
                <td className="text-xs whitespace-nowrap">{lastSeen(u.overview?.last_sign_in_at)}</td>
                <td className="text-right text-xs">
                  {u.overview?.sales ? (
                    <>
                      <b>{u.overview.sales}</b>
                      <span className="text-muted-foreground"> · {u.overview.delivered} entregadas</span>
                    </>
                  ) : '—'}
                </td>
                <td className={`text-right text-xs font-bold ${Number(u.overview?.pending_commission || 0) > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                  {Number(u.overview?.pending_commission || 0) > 0 ? `Gs ${new Intl.NumberFormat('es-PY').format(Math.round(u.overview.pending_commission))}` : '—'}
                </td>
                <td className="text-xs">
                  {u.role === 'VENDEDOR' ? (
                    u.overview?.payout_ready ? (
                      <span className="text-emerald-400">✅ Completo</span>
                    ) : (
                      <span className="text-amber-400" title={(u.overview?.payout_missing || []).join(', ')}>
                        ⚠️ Faltan {(u.overview?.payout_missing || []).length}
                      </span>
                    )
                  ) : <span className="text-muted-foreground">—</span>}
                  {(u.overview?.id_front_path || u.overview?.selfie_path) && (
                    <button type="button" className="ml-1 underline" onClick={() => void viewDocs(u.overview)}>🪪 Ver</button>
                  )}
                </td>
                <td>
                  <div className="flex gap-1">
                    {!u.approved && (
                      <button className="nav-btn active text-xs !py-1 !px-2" onClick={() => approveUser(u.user_id)}>
                        ✅ Aprobar
                      </button>
                    )}
                    {!u.approved && (
                      <button className="nav-btn text-xs !py-1 !px-2 !bg-destructive/20 hover:!bg-destructive/40 text-destructive" onClick={() => rejectUser(u.user_id)}>
                        ❌ Rechazar
                      </button>
                    )}
                    <button className="nav-btn text-xs !py-1 !px-2" title="Poner contraseña nueva" onClick={() => void setPassword(u)}>
                      🔑 Contraseña
                    </button>
                    {u.approved && (
                      <button className="nav-btn text-xs !py-1 !px-2" onClick={() => revokeUser(u.user_id)}>
                        Revocar acceso
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
