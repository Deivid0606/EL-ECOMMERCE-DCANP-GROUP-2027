import { describe, expect, it } from 'vitest';
import { addDaysKey, pyDateKey, pyEnd, pyStart } from './pyTime';

describe('pyTime', () => {
  it('a las 22:00 de Paraguay sigue siendo el mismo día (no el de UTC)', () => {
    // 2026-11-01 22:00 en Paraguay = 2026-11-02 01:00 UTC
    expect(pyDateKey(new Date('2026-11-02T01:00:00Z'))).toBe('2026-11-01');
  });
  it('rango del día en hora de Paraguay', () => {
    expect(pyStart('2026-11-01')).toBe('2026-11-01T00:00:00-03:00');
    expect(pyEnd('2026-11-01')).toBe('2026-11-01T23:59:59.999-03:00');
  });
  it('suma días', () => {
    expect(addDaysKey('2026-11-01', -7)).toBe('2026-10-25');
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('installPyTimeZone', () => {
  it('muestra la hora de Paraguay aunque el dispositivo esté en otra zona', async () => {
    const { installPyTimeZone } = await import('./pyTime');
    installPyTimeZone();
    const d = new Date('2026-11-02T01:30:00Z'); // 22:30 del 1/11 en Paraguay
    expect(d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', hour12: false })).toBe('22:30');
    expect(d.toLocaleDateString('es-PY')).toBe('1/11/2026');
    expect(new Intl.DateTimeFormat('es-PY', { hour: '2-digit', hour12: false }).format(d)).toBe('22');
    expect(new Intl.DateTimeFormat('es-PY') instanceof Intl.DateTimeFormat).toBe(true);
    // Si se pide otra zona, se respeta.
    expect(d.toLocaleTimeString('es-PY', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false })).toBe('01:30');
  });
});
