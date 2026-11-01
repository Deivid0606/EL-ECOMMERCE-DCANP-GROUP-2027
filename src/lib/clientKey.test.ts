import { describe, expect, it } from 'vitest';

// Copia de la regla usada en WithGuidesView para verificarla.
const normalizeClientName = (v: any) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const normalizePhone = (value: any): string => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('595')) digits = digits.slice(3);
  digits = digits.replace(/^0+/, '');
  return digits.length >= 6 ? digits.slice(-9) : '';
};
const clientKey = (name: any, phone: any) => {
  const n = normalizeClientName(name).replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();
  const p = normalizePhone(phone);
  return n && p ? `${n}|${p}` : '';
};

describe('clientKey', () => {
  it('mismo cliente con distinto formato', () => {
    expect(clientKey('María  López', '0981 123-456')).toBe(clientKey('MARIA LOPEZ', '+595981123456'));
  });
  it('mismo nombre, otro celular: distintos', () => {
    expect(clientKey('Juan Pérez', '0981111111')).not.toBe(clientKey('Juan Perez', '0982222222'));
  });
  it('sin celular no se marca', () => {
    expect(clientKey('Juan Pérez', '')).toBe('');
  });
});
