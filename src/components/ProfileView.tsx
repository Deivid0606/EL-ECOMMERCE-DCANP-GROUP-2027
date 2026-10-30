import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import PushSettings from '@/components/PushSettings';

export default function ProfileView() {
  const { user, profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    name: '', phone: '', doc: '', addr: '',
    bank_name: '', bank_type: '', bank_num: '', bank_holder: '', bank_holder_ci: '',
    wallet_provider: '', wallet_number: '', wallet_holder: '', logo_url: '', sheet_url: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('user_id', user.id).single()
      .then(({ data }) => {
        if (data) setForm({
          name: data.name || '', phone: data.phone || '', doc: data.doc || '', addr: data.addr || '',
          bank_name: data.bank_name || '', bank_type: data.bank_type || '',
          bank_num: data.bank_num || '', bank_holder: data.bank_holder || '',
          bank_holder_ci: data.bank_holder_ci || '',
          wallet_provider: data.wallet_provider || '', wallet_number: data.wallet_number || '',
          wallet_holder: data.wallet_holder || '', logo_url: data.logo_url || '',
          sheet_url: (data as any).sheet_url || '',
        });
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update(form).eq('user_id', user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('Perfil guardado'); refreshProfile(); }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-1">Perfil</h3>
      <p className="text-xs text-muted-foreground mb-4">Estos datos se usan para contacto y para <b>pago de comisiones</b>.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Personal */}
        <div className="app-card !p-4">
          <div className="font-extrabold mb-1.5">Datos personales</div>
          <label className="app-label">Nombre</label>
          <input className="app-input" value={form.name} onChange={e => set('name', e.target.value)} />
          <label className="app-label">Email (de sesión)</label>
          <input className="app-input bg-secondary cursor-not-allowed" value={profile?.email || ''} readOnly />
          <label className="app-label">Teléfono</label>
          <input className="app-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+595..." />
          <label className="app-label">Documento (CI/RUC)</label>
          <input className="app-input" value={form.doc} onChange={e => set('doc', e.target.value)} />
          <label className="app-label">Dirección</label>
          <input className="app-input" value={form.addr} onChange={e => set('addr', e.target.value)} />
          <label className="app-label">Logo URL (para Proveedor)</label>
          <input className="app-input" value={form.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://...logo.png" />
          <hr className="border-border my-3" />
          <label className="app-label">📊 Link de Google Sheets (pedidos Shopify)</label>
          <input className="app-input" value={form.sheet_url} onChange={e => set('sheet_url', e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          <p className="text-[10px] text-muted-foreground mt-1">Pegá el link de tu hoja pública de Shopify para importar pedidos.</p>
        </div>

        {/* Banking */}
        <div className="app-card !p-4">
          <div className="font-extrabold mb-1.5">Pago de comisiones</div>
          <div className="flex gap-2 mb-2">
            <span className="chip">Banco</span>
            <span className="chip">o Billetera</span>
          </div>
          <label className="app-label">Banco</label>
          <input className="app-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
          <label className="app-label">Tipo de cuenta</label>
          <select className="app-input" value={form.bank_type} onChange={e => set('bank_type', e.target.value)}>
            <option value="">(seleccionar)</option>
            <option>CAJA DE AHORRO</option>
            <option>CUENTA CORRIENTE</option>
          </select>
          <label className="app-label">N° de cuenta</label>
          <input className="app-input" value={form.bank_num} onChange={e => set('bank_num', e.target.value)} />
          <label className="app-label">Titular</label>
          <input className="app-input" value={form.bank_holder} onChange={e => set('bank_holder', e.target.value)} />
          <label className="app-label">CI del titular</label>
          <input className="app-input" value={form.bank_holder_ci} onChange={e => set('bank_holder_ci', e.target.value)} />

          <hr className="border-border my-3" />

          <label className="app-label">Proveedor billetera</label>
          <select className="app-input" value={form.wallet_provider} onChange={e => set('wallet_provider', e.target.value)}>
            <option value="">(ninguno)</option>
            <option>Tigo Money</option>
            <option>Personal</option>
            <option>Bancard/Payphone</option>
            <option>UENO</option>
            <option>Binance Pay</option>
          </select>
          <label className="app-label">N° billetera / Alias</label>
          <input className="app-input" value={form.wallet_number} onChange={e => set('wallet_number', e.target.value)} />
          <label className="app-label">Titular billetera</label>
          <input className="app-input" value={form.wallet_holder} onChange={e => set('wallet_holder', e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-2.5 mt-4">
        <button className="nav-btn active" onClick={save} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <span className="chip text-[10px]">Solo actualiza tus datos</span>
      </div>

      <PushSettings />
    </div>
  );
}
