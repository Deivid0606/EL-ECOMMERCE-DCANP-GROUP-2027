import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { etaMinutes, parseCoords } from './tracking';

describe('parseCoords', () => {
  it.each([
    ['-25.3092412, -57.6325831', -25.3092412, -57.6325831],
    ['-25.3092412,-57.6325831', -25.3092412, -57.6325831],
    ['https://www.google.com/maps/place/Luque/@-25.2701,-57.4877,15z/data=x', -25.2701, -57.4877],
    ['https://maps.google.com/?q=-25.30924,-57.63258', -25.30924, -57.63258],
    ['https://maps.google.com/maps?q=-25.30924%2C-57.63258&z=17', -25.30924, -57.63258],
    ['https://www.google.com/maps/search/?api=1&query=-25.30924,-57.63258', -25.30924, -57.63258],
    ['https://www.google.com/maps/place/x/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d-25.3092412!4d-57.6325831', -25.3092412, -57.6325831],
  ])('lee %s', (text, lat, lng) => {
    expect(parseCoords(text)).toEqual({ lat, lng });
  });

  it('rechaza textos sin coordenadas', () => {
    expect(parseCoords('Calle Palma 123, Luque')).toBeNull();
    expect(parseCoords('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
  });
});

describe('etaMinutes', () => {
  it('estima minutos en moto', () => {
    const { km, minutes } = etaMinutes({ lat: -25.29, lng: -57.53 }, { lat: -25.27, lng: -57.49 });
    expect(km).toBeGreaterThan(4);
    expect(minutes).toBeGreaterThan(5);
    expect(minutes).toBeLessThan(30);
  });
});
