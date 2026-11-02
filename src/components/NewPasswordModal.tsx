import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isRecovering, setRecovering } from '@/lib/recoveryFlag';

/** Al entrar con el link de "olvidé mi contraseña" pide la contraseña nueva. */
export default function NewPasswordModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(isRecovering());
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecovering(true);
        setOpen(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!open || !user) return null;

  const save = async () => {
    if (pass.length < 6) return toast.error('Mínimo 6 caracteres');
    if (pass !== pass2) return toast.error('Las contraseñas no coinciden');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setSaving(false);
    if (error) return toast.error(error.message);
    setRecovering(false);
    setOpen(false);
    toast.success('🔑 Contraseña actualizada');
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-5 shadow-2xl">
        <h3 className="mb-1 text-lg font-black">🔑 Nueva contraseña</h3>
        <p className="mb-3 text-xs text-muted-foreground">Elegí una contraseña nueva para {user.email}.</p>
        <input type="password" className="app-input" placeholder="Contraseña nueva" value={pass} onChange={(e) => setPass(e.target.value)} />
        <input type="password" className="app-input mt-2" placeholder="Repetir contraseña" value={pass2} onChange={(e) => setPass2(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="nav-btn" disabled={saving} onClick={() => { setRecovering(false); setOpen(false); }}>Después</button>
          <button className="nav-btn active" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
