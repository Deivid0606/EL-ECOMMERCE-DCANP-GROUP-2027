import { describe, expect, it } from 'vitest';
import { orderLocationText } from './orderLocation';

describe('orderLocationText', () => {
  it('encuentra links de Google Maps y coordenadas que pegó el vendedor', () => {
    expect(orderLocationText({ street: 'Casa verde https://maps.app.goo.gl/AbC123 frente a la plaza' })).toBe('https://maps.app.goo.gl/AbC123');
    expect(orderLocationText({ obs: 'ubicación: -25.3092, -57.6325' })).toBe('-25.3092, -57.6325');
    expect(orderLocationText({ district: 'https://www.google.com/maps/place/@-25.28,-57.63,17z' })).toContain('google.com/maps');
    expect(orderLocationText({ street: 'Mcal López 1234 casi Brasil' })).toBeNull();
  });
});

import { canSendTracking, hasStreetAddress } from './orderLocation';

describe('hasStreetAddress / canSendTracking', () => {
  it('acepta direcciones de calle reales', () => {
    expect(hasStreetAddress({ street: 'Cnel Martínez casi Pedro Juan Caballero' })).toBe(true);
    expect(hasStreetAddress({ street: 'Teresa Roa Caballero entre Lomas Valentinas y 15 de agosto' })).toBe(true);
    expect(hasStreetAddress({ street: 'Mcal López 1234' })).toBe(true);
    expect(hasStreetAddress({ street: 'Barrio San Miguel', district: 'calle 3' })).toBe(true);
  });
  it('rechaza lo que no es una dirección', () => {
    expect(hasStreetAddress({ street: 'Ruc 1.250.945' })).toBe(false);
    expect(hasStreetAddress({ street: '1234' })).toBe(false);
    expect(hasStreetAddress({ street: '-' })).toBe(false);
    expect(hasStreetAddress({ street: '' })).toBe(false);
    expect(hasStreetAddress({ street: 'Luque' })).toBe(false);
  });
  it('con link de Maps siempre se puede', () => {
    expect(canSendTracking({ street: 'Ruc 1.250.945', obs: 'https://maps.app.goo.gl/x1' })).toBe(true);
    expect(canSendTracking({ street: 'Ruc 1.250.945' })).toBe(false);
  });
});
