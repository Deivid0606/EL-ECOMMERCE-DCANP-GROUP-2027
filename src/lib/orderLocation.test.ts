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
