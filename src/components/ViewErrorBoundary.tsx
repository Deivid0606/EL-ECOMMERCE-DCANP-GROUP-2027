import { Component, type ReactNode } from 'react';

// Si una actualización nueva borró los archivos de la versión que estaba abierta,
// cargar una pestaña falla: se recarga la página una vez (como mucho cada 30 s).
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|Loading chunk|error loading dynamically/i;
const RELOAD_KEY = 'dcanp_chunk_reload_at';

export const isChunkError = (e: unknown) => CHUNK_ERROR.test(String((e as Error)?.message || e || ''));

export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sin storage: se recarga igual */
  }
  window.location.reload();
  return true;
}

type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null };

/** Si una pestaña falla, muestra un aviso en vez de dejar toda la pantalla en negro. */
export default class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Error en la pestaña:', error);
    if (isChunkError(error)) reloadForNewVersion();
  }

  componentDidUpdate(prev: Props) {
    // Al cambiar de pestaña se vuelve a intentar.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const update = isChunkError(error);
    return (
      <div className="app-card mx-auto my-6 max-w-lg text-center">
        <div className="mb-2 text-4xl">{update ? '🔄' : '⚠️'}</div>
        <h3 className="mb-1 text-lg font-black">{update ? 'Hay una versión nueva de la app' : 'Esta pestaña tuvo un problema'}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {update
            ? 'Recargá para usar la última versión.'
            : 'Tocá «Reintentar» o cambiá de pestaña. El resto de la app sigue funcionando.'}
        </p>
        <div className="flex justify-center gap-2">
          {!update && (
            <button type="button" className="nav-btn" onClick={() => this.setState({ error: null })}>
              Reintentar
            </button>
          )}
          <button type="button" className="nav-btn active" onClick={() => window.location.reload()}>
            🔄 Recargar
          </button>
        </div>
        {!update && <p className="mt-3 break-words text-[10px] text-muted-foreground">{String(error.message || error).slice(0, 200)}</p>}
      </div>
    );
  }
}
