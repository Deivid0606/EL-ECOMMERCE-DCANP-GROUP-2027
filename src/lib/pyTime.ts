// Hora de Paraguay para toda la app (America/Asuncion), sin depender de la zona
// horaria del celular/compu ni de UTC.
export const PY_TZ = 'America/Asuncion';

/** Fecha "AAAA-MM-DD" en Paraguay. */
export function pyDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Hoy en Paraguay. */
export const pyToday = () => pyDateKey();

/** Suma días a una fecha "AAAA-MM-DD". */
export function addDaysKey(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Hace N días (en Paraguay). */
export const pyDaysAgo = (n: number) => addDaysKey(pyToday(), -n);

/** Primer día del mes actual (en Paraguay). */
export const pyFirstOfMonth = () => `${pyToday().slice(0, 8)}01`;

/** Diferencia con UTC de Paraguay para ese día, ej. "-03:00". */
export function pyOffset(day: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: PY_TZ, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${day}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')?.value;
    const m = name?.match(/GMT([+-]\d{2}):?(\d{2})?/);
    if (m) return `${m[1]}:${m[2] || '00'}`;
  } catch {
    // Navegador sin longOffset: Paraguay usa UTC-3.
  }
  return '-03:00';
}

/** Inicio del día en Paraguay, para filtrar fechas en la base. */
export const pyStart = (day: string) => `${day}T00:00:00${pyOffset(day)}`;
/** Fin del día en Paraguay, para filtrar fechas en la base. */
export const pyEnd = (day: string) => `${day}T23:59:59.999${pyOffset(day)}`;

/**
 * Hace que todas las fechas/horas que muestra la app (toLocaleString,
 * toLocaleDateString, toLocaleTimeString e Intl.DateTimeFormat) salgan en hora
 * de Paraguay si no se indicó otra zona.
 */
export function installPyTimeZone() {
  const g = globalThis as any;
  if (g.__pyTimeZoneInstalled) return;
  g.__pyTimeZoneInstalled = true;
  const withTz = (options?: Intl.DateTimeFormatOptions) => ({ ...(options || {}), timeZone: options?.timeZone || PY_TZ });
  const proto = Date.prototype as any;
  (['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const).forEach((method) => {
    const original = proto[method];
    proto[method] = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return original.call(this, locales, withTz(options));
    };
  });
  const OriginalDTF = Intl.DateTimeFormat;
  const PatchedDTF = function (this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new OriginalDTF(locales, withTz(options));
  } as unknown as typeof Intl.DateTimeFormat;
  (PatchedDTF as any).prototype = OriginalDTF.prototype;
  (PatchedDTF as any).supportedLocalesOf = OriginalDTF.supportedLocalesOf;
  (Intl as any).DateTimeFormat = PatchedDTF;
}
