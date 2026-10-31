import { Monitor, MonitorSmartphone, Smartphone, Tablet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { EffectiveLayout, LayoutMode } from '@/hooks/useLayoutMode';

interface AppHeaderProps {
  onRefresh: () => void;
  lastUpdate: string;
  layout?: EffectiveLayout;
  mode?: LayoutMode;
  onModeChange?: (mode: LayoutMode) => void;
}

const MODES: Array<{ id: LayoutMode; label: string; Icon: typeof Monitor }> = [
  { id: 'auto', label: 'Automático', Icon: MonitorSmartphone },
  { id: 'pc', label: 'PC', Icon: Monitor },
  { id: 'tablet', label: 'Tablet', Icon: Tablet },
  { id: 'mobile', label: 'Celular', Icon: Smartphone },
];

export function LayoutSwitcher({
  mode,
  onChange,
  compact,
}: {
  mode: LayoutMode;
  onChange: (mode: LayoutMode) => void;
  compact?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-xl border border-border bg-secondary/40 p-0.5" role="group" aria-label="Vista">
      {MODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={`Vista ${label}`}
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold transition ${
            mode === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="h-4 w-4" />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

export default function AppHeader({ onRefresh, lastUpdate, layout = 'pc', mode = 'auto', onModeChange }: AppHeaderProps) {
  const { profile, signOut } = useAuth();
  const isMobile = layout === 'mobile';

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <img
          src="https://cdn.shopify.com/s/files/1/0885/3012/5095/files/Captura_de_pantalla_2026-01-12_023843.jpg?v=1768196352"
          alt="DCANP GROUP Logo"
          className="h-10 w-10 shrink-0 rounded-[10px] object-cover"
        />
        <span className={`truncate font-extrabold tracking-wide ${isMobile ? 'text-lg' : 'text-[22px]'}`}>
          {isMobile ? 'DCANP GROUP' : 'EL-ECOMMERCE DCANP GROUP'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onModeChange && <LayoutSwitcher mode={mode} onChange={onModeChange} compact={layout !== 'pc'} />}

        <div className="flex items-center gap-2">
          {layout === 'pc' && (
            <span className="text-xs text-muted-foreground">
              Última actualización: {lastUpdate}
            </span>
          )}
          <button className="nav-btn text-xs px-2.5 py-1.5" onClick={onRefresh} title={`Actualizar · ${lastUpdate}`}>
            ↻
          </button>
        </div>

        {profile && (
          <div className="flex items-center gap-2">
            {!isMobile && <span className="chip max-w-[220px] truncate">{profile.email}</span>}
            <button className="nav-btn" onClick={signOut}>Salir</button>
          </div>
        )}
      </div>
    </div>
  );
}
