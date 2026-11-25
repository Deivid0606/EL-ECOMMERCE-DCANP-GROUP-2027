import { useCallback, useEffect, useState } from 'react';
import { ANDROID_APP_EXTERNAL_URL, DcanpPerms, hasPermsPlugin, isNativeApp, needsAutostart, type PermsStatus } from '@/lib/nativeApp';

/**
 * 📱 Asistente de la app de Android: pide uno por uno los permisos para que el
 * delivery siga en el mapa con la pantalla apagada (ubicación, notificaciones,
 * batería sin restricciones e inicio automático en Xiaomi/Huawei/Oppo/Vivo).
 * Si la app instalada es vieja (sin el asistente), ofrece actualizarla.
 */

const AUTOSTART_KEY = 'dcanp-autostart-ok';
const SNOOZE_KEY = 'dcanp-setup-snooze';

export default function AppSetupGuard() {
  const native = isNativeApp();
  const plugin = hasPermsPlugin();
  const [st, setSt] = useState<PermsStatus | null>(null);
  const [autostartOk, setAutostartOk] = useState(() => {
    try {
      return localStorage.getItem(AUTOSTART_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [snoozed, setSnoozed] = useState(() => {
    try {
      return sessionStorage.getItem(SNOOZE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const refresh = useCallback(async () => {
    if (!plugin) return;
    try {
      const s = await DcanpPerms.status();
      setSt((prev) => {
        // Avisa a la ubicación en vivo que ahora sí hay permisos.
        if (prev && (prev.location !== s.location || prev.notifications !== s.notifications)) {
          window.dispatchEvent(new Event('dcanp-perms-updated'));
        }
        return s;
      });
    } catch {
      /* sin plugin */
    }
  }, [plugin]);

  // Al volver de la pantalla de permisos del celular se revisa otra vez.
  useEffect(() => {
    if (!plugin) return;
    void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const t = window.setInterval(() => void refresh(), 2500);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(t);
    };
  }, [plugin, refresh]);

  if (!native) return null;

  // App vieja: no trae el asistente → actualizar.
  if (!plugin) {
    return (
      <a
        href={ANDROID_APP_EXTERNAL_URL}
        className="fixed inset-x-3 bottom-3 z-[1500] flex items-center gap-3 rounded-2xl border border-emerald-400/50 bg-slate-950/95 p-3 text-sm text-white shadow-2xl"
      >
        <span className="text-2xl">⬆️</span>
        <span className="min-w-0 flex-1">
          <b>Hay una versión nueva de la app</b>
          <span className="block text-xs text-slate-300">Configura sola los permisos para que sigas en el mapa con la pantalla apagada.</span>
        </span>
        <span className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black">Actualizar</span>
      </a>
    );
  }

  if (!st || snoozed) return null;

  const autostart = needsAutostart(st.manufacturer);
  const steps = [
    {
      key: 'location',
      ok: st.location,
      icon: '📍',
      title: 'Ubicación',
      text: 'Para que admin y clientes vean tu 🛵. Elegí «Mientras se usa la app» y «Precisa».',
      action: () => DcanpPerms.requestLocation(),
    },
    {
      key: 'notifications',
      ok: st.notifications,
      icon: '🔔',
      title: 'Notificaciones',
      text: 'El aviso fijo «compartiendo tu ubicación» mantiene la app activa con la pantalla apagada.',
      action: () => DcanpPerms.requestNotifications(),
    },
    {
      key: 'battery',
      ok: st.battery,
      icon: '🔋',
      title: 'Batería sin restricciones',
      text: 'Si no, el celular corta la app para ahorrar batería. Tocá «Permitir».',
      action: () => DcanpPerms.requestBattery(),
    },
    ...(autostart
      ? [
          {
            key: 'autostart',
            ok: autostartOk,
            icon: '🚀',
            title: 'Inicio automático',
            text: `En ${st.manufacturer} activá «Inicio automático» para DCANP Delivery y volvé acá.`,
            action: async () => {
              await DcanpPerms.openAutostart();
              try {
                localStorage.setItem(AUTOSTART_KEY, '1');
              } catch {
                /* sin storage */
              }
              setAutostartOk(true);
            },
          },
        ]
      : []),
  ];
  const pending = steps.filter((s) => !s.ok);
  if (!pending.length) return null;

  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-950 p-5 text-white shadow-2xl">
        <div className="text-center text-4xl">🛵</div>
        <h3 className="mt-1 text-center text-lg font-black">Configurá la app (una sola vez)</h3>
        <p className="mt-1 text-center text-xs text-slate-400">Así seguís en el mapa aunque bloquees el celular o uses WhatsApp / Waze.</p>
        <div className="mt-4 space-y-2">
          {steps.map((s, i) => (
            <div key={s.key} className={`flex items-center gap-3 rounded-2xl border p-3 ${s.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-white/10 bg-slate-900'}`}>
              <span className="text-2xl">{s.ok ? '✅' : s.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">
                  {i + 1}. {s.title}
                </div>
                {!s.ok && <div className="text-[11px] leading-tight text-slate-400">{s.text}</div>}
              </div>
              {!s.ok && (
                <button
                  type="button"
                  className="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black"
                  onClick={() => void s.action().then(() => window.setTimeout(() => void refresh(), 800))}
                >
                  Permitir
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-4 w-full py-2 text-xs font-bold text-slate-400"
          onClick={() => {
            setSnoozed(true);
            try {
              sessionStorage.setItem(SNOOZE_KEY, '1');
            } catch {
              /* sin storage */
            }
          }}
        >
          Después
        </button>
        <button type="button" className="w-full py-1 text-[11px] text-slate-500 underline" onClick={() => void DcanpPerms.openAppSettings()}>
          Abrir los ajustes de la app
        </button>
      </div>
    </div>
  );
}
