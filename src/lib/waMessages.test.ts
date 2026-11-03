import { describe, expect, it } from 'vitest';
import { customerMessageVariant } from './waMessages';

const order = {
  order_number: 'SHOPIFY123',
  customer_name: 'Norma Fleitas',
  city: 'Concepción',
  street: 'Cnel Martínez casi PJC',
  total_gs: 199000,
  items_json: [{ title: 'Cepillo 9 en 1', qty: 2, sale_gs: 199000 }],
};

describe('customerMessageVariant', () => {
  it('cada mensaje de la tanda es distinto', () => {
    const msgs = Array.from({ length: 12 }, (_, i) => customerMessageVariant(order, '0971800315', i));
    for (let i = 1; i < msgs.length; i++) expect(msgs[i]).not.toBe(msgs[i - 1]);
    expect(new Set(msgs).size).toBeGreaterThanOrEqual(7);
  });

  it('siempre lleva los datos del pedido y no muestra precio por producto', () => {
    for (let i = 0; i < 10; i++) {
      const m = customerMessageVariant(order, '0971800315', i);
      expect(m).toContain('Norma');
      expect(m).toContain('SHOPIFY123');
      expect(m).toContain('Cepillo 9 en 1 x2');
      expect(m).toContain('Concepción');
      expect(m).toContain('Cnel Martínez casi PJC');
      expect(m).toContain('Total: Gs 199.000');
      expect(m.match(/Gs/g)?.length).toBe(1);
    }
  });
});
