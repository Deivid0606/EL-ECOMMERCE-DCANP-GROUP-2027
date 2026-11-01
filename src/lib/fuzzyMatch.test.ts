import { describe, expect, it } from 'vitest';
import { resolveCity, titleSimilarity } from './fuzzyMatch';

const cities = [
  { city: 'Asunción', price: 35000, departamento: 'Central' },
  { city: 'San Lorenzo', price: 35000, departamento: 'Central' },
  { city: 'Ciudad del este ', price: 45000, departamento: 'Alto Paraná' },
  { city: 'Fernando de la Mora', price: 35000, departamento: 'Central' },
  { city: 'Ita', price: 55000, departamento: 'Central' },
  { city: 'Itaugua', price: 45000, departamento: 'Central' },
  { city: 'Capiata', price: 45000, departamento: 'Central' },
  { city: 'Mariano Roque Alonso', price: 40000, departamento: 'Central' },
  { city: 'Pedro Juan Caballero', price: 50000, departamento: 'Amambay' },
];

describe('resolveCity', () => {
  it.each([
    ['asuncion', 'Asunción'],
    ['ASUNSION', 'Asunción'],
    ['san lorenso', 'San Lorenzo'],
    ['Barrio Reducto, San Lorenzo', 'San Lorenzo'],
    ['CDE', 'Ciudad del este '],
    ['ciudad del este km 7', 'Ciudad del este '],
    ['Fdo de la mora', 'Fernando de la Mora'],
    ['fernando de la mora zona norte', 'Fernando de la Mora'],
    ['ita', 'Ita'],
    ['itagua', 'Itaugua'],
    ['capiatá', 'Capiata'],
    ['MRA', 'Mariano Roque Alonso'],
    ['pedro juan', 'Pedro Juan Caballero'],
  ])('%s → %s', (raw, expected) => {
    expect(resolveCity(raw, cities)?.city).toBe(expected);
  });

  it('no inventa ciudades', () => {
    expect(resolveCity('Encarnación', cities)).toBeNull();
    expect(resolveCity('', cities)).toBeNull();
  });
});

describe('titleSimilarity', () => {
  it('reconoce títulos parecidos', () => {
    expect(titleSimilarity('Linterna potente con zoom', 'LINTERNA POTENTE CON ZOOM LED')).toBeGreaterThan(0.7);
    expect(titleSimilarity('Pelador multifuncion', 'Linterna potente')).toBe(0);
  });
});
