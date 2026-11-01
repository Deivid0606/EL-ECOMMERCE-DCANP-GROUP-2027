import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import PushSettings from '@/components/PushSettings';

const KYC_BUCKET = 'kyc-documents';
type DocKey = 'id_front_path' | 'id_back_path' | 'selfie_path';
const DOCS: { key: DocKey; label: string; hint: string }[] = [
  { key: 'id_front_path', label: 'Cédula (frente)', hint: 'Foto clara del frente, que se lean los datos.' },
  { key: 'id_back_path', label: 'Cédula (dorso)', hint: 'Foto clara del dorso.' },
  { key: 'selfie_path', label: 'Selfie con tu cédula', hint: 'Tu cara y la cédula en la mano, bien visibles.' },
];

export default function ProfileView() {
  const { user, profile, refreshProfile } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  const [form, setForm] = useState({
    name: '', phone: '', doc: '', addr: '',
    bank_name: '', bank_type: '', bank_num: '', bank_holder: '', bank_holder_ci: '',
    wallet_provider: '', wallet_number: '', wallet_holder: '', logo_url: '', sheet_url: '',
    payout_method: 'bank',
  });
  const [docs, setDocs] = useState<Record<DocKey, string>>({ id_front_path: '', id_back_path: '', selfie_path: '' });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [status, setStatus] = useState<{ ready: boolean; missing: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    const { data } = await (supabase as any).rpc('my_payout_status');
    if (data) setStatus({ ready: Boolean(data.ready), missing: data.missing || [] });
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('user_id', user.id).single()
      .then(async ({ data }) => {
        if (!data) return;
        const d: any = data;
        setForm({
          name: d.name || '', phone: d.phone || '', doc: d.doc || '', addr: d.addr || '',
          bank_name: d.bank_name || '', bank_type: d.bank_type || '',
          bank_num: d.bank_num || '', bank_holder: d.bank_holder || '',
          bank_holder_ci: d.bank_holder_ci || '',
          wallet_provider: d.wallet_provider || '', wallet_number: d.wallet_number || '',
          wallet_holder: d.wallet_holder || '', logo_url: d.logo_url || '',
          sheet_url: d.sheet_url || '', payout_method: d.payout_method || 'bank',
        });
        const nextDocs = { id_front_path: d.id_front_path || '', id_back_path: d.id_back_path || '', selfie_path: d.selfie_path || '' };
        setDocs(nextDocs);
        const urls: Record<string, string> = {};
        for (const k of Object.keys(nextDocs) as DocKey[]) {
          if (!nextDocs[k]) continue;
          const { data: signed } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(nextDocs[k], 600);
          if (signed?.signedUrl) urls[k] = signed.signedUrl;
        }
        setPreviews(urls);
      });
    void loadStatus();
  }, [user, loadStatus]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update(form as any).eq('user_id', user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success('Perfil guardado');
      refreshProfile();
      void loadStatus();
    }
  };

  const uploadDoc = async (key: DocKey, file: File | undefined) => {
    if (!user || !file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Subí una foto (JPG o PNG)');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('La foto pesa más de 10 MB');
      return;
    }
    setUploading(key);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${user.id}/${key.replace('_path', '')}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(KYC_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setUploading(null);
      toast.error(upErr.message);
      return;
    }
    const { error } = await supabase.from('profiles').update({ [key]: path } as any).eq('user_id', user.id);
    setUploading(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDocs((d) => ({ ...d, [key]: path }));
    setPreviews((p) => ({ ...p, [key]: URL.createObjectURL(file) }));
    toast.success('Foto guardada');
    void loadStatus();
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const needsPayout = role === 'VENDEDOR';

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-1">Perfil</h3>
      <p className="text-xs text-muted-foreground mb-3">Estos datos se usan para contacto y para <b>pago de comisiones</b>.</p>

      {status && (needsPayout || !status.ready) && (
        <div className={`mb-4 rounded-2xl border p-3 text-sm ${status.ready ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
          {status.ready ? (
            <b className="text-emerald-300">✅ Perfil completo: podés cobrar tus comisiones. Tus datos de cobro se envían solos con cada solicitud.</b>
          ) : (
            <>
              <b className="text-amber-300">⚠️ Para cobrar tus comisiones completá:</b>
              <div className="mt-1 text-xs">{status.missing.join(' · ')}</div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Personal */}
        <div className="app-card !p-4">
          <div className="font-extrabold mb-1.5">Datos personales</div>
          <label className="app-label">Nombre y apellido *</label>
          <input className="app-input" value={form.name} onChange={e => set('name', e.target.value)} />
          <label className="app-label">Email (de sesión)</label>
          <input className="app-input bg-secondary cursor-not-allowed" value={profile?.email || ''} readOnly />
          <label className="app-label">Teléfono *</label>
          <input className="app-input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="0981..." />
          <label className="app-label">Documento (CI/RUC) *</label>
          <input className="app-input" value={form.doc} onChange={e => set('doc', e.target.value)} />
          <label className="app-label">Dirección *</label>
          <input className="app-input" value={form.addr} onChange={e => set('addr', e.target.value)} />
          <label className="app-label">Logo URL (para Proveedor)</label>
          <input className="app-input" value={form.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://...logo.png" />
          <hr className="border-border my-3" />
          <label className="app-label">📊 Link de Google Sheets (pedidos Shopify)</label>
          <input className="app-input" value={form.sheet_url} onChange={e => set('sheet_url', e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
          <p className="text-[10px] text-muted-foreground mt-1">Pegá el link de tu hoja pública de Shopify para importar pedidos.</p>
        </div>

        {/* Cobro */}
        <div className="app-card !p-4">
          <div className="font-extrabold mb-1.5">Cobro de comisiones *</div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {([
              ['bank', '🏦 Cuenta bancaria'],
              ['wallet', '📱 Billetera'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`rounded-xl border p-2 text-sm font-bold ${form.payout_method === v ? 'border-primary bg-primary/10' : 'border-border'}`}
                onClick={() => set('payout_method', v)}
              >
                {label}
              </button>
            ))}
          </div>
          {form.payout_method === 'wallet' ? (
            <>
              <label className="app-label">Billetera *</label>
              <select className="app-input" value={form.wallet_provider} onChange={e => set('wallet_provider', e.target.value)}>
                <option value="">(seleccionar)</option>
                <option>Tigo Money</option>
                <option>Personal</option>
                <option>Bancard/Payphone</option>
                <option>UENO</option>
                <option>Binance Pay</option>
              </select>
              <label className="app-label">N° de billetera *</label>
              <input className="app-input" value={form.wallet_number} onChange={e => set('wallet_number', e.target.value)} />
              <label className="app-label">Titular *</label>
              <input className="app-input" value={form.wallet_holder} onChange={e => set('wallet_holder', e.target.value)} />
            </>
          ) : (
            <>
              <label className="app-label">Banco *</label>
              <input className="app-input" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
              <label className="app-label">Tipo de cuenta *</label>
              <select className="app-input" value={form.bank_type} onChange={e => set('bank_type', e.target.value)}>
                <option value="">(seleccionar)</option>
                <option>CAJA DE AHORRO</option>
                <option>CUENTA CORRIENTE</option>
              </select>
              <label className="app-label">N° de cuenta *</label>
              <input className="app-input" value={form.bank_num} onChange={e => set('bank_num', e.target.value)} />
              <label className="app-label">Titular *</label>
              <input className="app-input" value={form.bank_holder} onChange={e => set('bank_holder', e.target.value)} />
              <label className="app-label">CI del titular *</label>
              <input className="app-input" value={form.bank_holder_ci} onChange={e => set('bank_holder_ci', e.target.value)} />
            </>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">Estos datos se envían solos cuando pedís cobrar: no hace falta escribir alias ni cuentas en la solicitud.</p>
        </div>
      </div>

      {/* Identidad */}
      <div className="app-card !p-4 mt-4">
        <div className="font-extrabold mb-1">Verificación de identidad *</div>
        <p className="mb-3 text-xs text-muted-foreground">Sólo las ve el administrador. Son obligatorias para cobrar comisiones.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {DOCS.map((d) => (
            <label key={d.key} className="flex cursor-pointer flex-col gap-2 rounded-2xl border border-dashed border-border p-3 text-center text-xs hover:bg-secondary/40">
              <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-secondary/40">
                {previews[d.key] ? (
                  <img src={previews[d.key]} alt={d.label} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl">{d.key === 'selfie_path' ? '🤳' : '🪪'}</span>
                )}
              </div>
              <b>
                {docs[d.key] ? '✅ ' : ''}
                {d.label}
              </b>
              <span className="text-[10px] text-muted-foreground">{uploading === d.key ? 'Subiendo…' : docs[d.key] ? 'Tocá para cambiarla' : d.hint}</span>
              <input
                type="file"
                accept="image/*"
                capture={d.key === 'selfie_path' ? 'user' : 'environment'}
                className="hidden"
                disabled={uploading !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  void uploadDoc(d.key, f);
                }}
              />
            </label>
          ))}
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
