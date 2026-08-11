import { describe, it, expect } from 'vitest';
import { puedeElegir, alternar, depurarSeleccion } from './selection';
import type { Butaca } from './types';

const butaca = (n: string, s: Butaca['s'] = 'libre'): Butaca => ({ n, x: 0, y: 0, s, t: 0 });

const libre = butaca('A-1');
const vendida = butaca('A-2', 'vendida');
const bloqueada = butaca('A-3', 'bloqueada');

describe('puedeElegir', () => {
  it('una butaca libre se puede elegir', () => {
    expect(puedeElegir(libre, [])).toEqual({ ok: true });
  });

  it('una vendida no, y lo dice', () => {
    expect(puedeElegir(vendida, [])).toEqual({ ok: false, motivo: 'vendida' });
  });

  it('una bloqueada tampoco, con su propio motivo', () => {
    expect(puedeElegir(bloqueada, [])).toEqual({ ok: false, motivo: 'bloqueada' });
  });

  it('sin tope se puede seguir eligiendo', () => {
    expect(puedeElegir(libre, ['X-1', 'X-2', 'X-3'])).toEqual({ ok: true });
  });

  it('con el tope alcanzado el motivo es el límite, no el estado', () => {
    expect(puedeElegir(libre, ['X-1', 'X-2'], { max: 2 })).toEqual({
      ok: false,
      motivo: 'limite',
    });
  });

  it('justo debajo del tope todavía entra', () => {
    expect(puedeElegir(libre, ['X-1'], { max: 2 })).toEqual({ ok: true });
  });
});

describe('alternar', () => {
  it('agrega la butaca al final, respetando el orden de elección', () => {
    expect(alternar(libre, ['X-1'])).toEqual(['X-1', 'A-1']);
  });

  it('si ya estaba, la saca', () => {
    expect(alternar(libre, ['X-1', 'A-1'])).toEqual(['X-1']);
  });

  it('deseleccionar se permite aunque la butaca ya no esté libre', () => {
    // El mapa se refrescó y alguien te ganó de mano: tenés que poder sacarla.
    const ahoraVendida = butaca('A-1', 'vendida');
    expect(alternar(ahoraVendida, ['A-1'])).toEqual([]);
  });

  it('un click inválido devuelve el MISMO array (no dispara re-render)', () => {
    const previo = ['X-1'];
    expect(alternar(vendida, previo)).toBe(previo);
  });

  it('pasado el tope, el click rebota sin mutar', () => {
    const previo = ['X-1', 'X-2'];
    expect(alternar(libre, previo, { max: 2 })).toBe(previo);
  });

  it('no muta el array original', () => {
    const previo = ['X-1'];
    alternar(libre, previo);
    expect(previo).toEqual(['X-1']);
  });
});

describe('depurarSeleccion — el mapa se refrescó mientras el usuario elegía', () => {
  it('sin cambios devuelve la MISMA identidad', () => {
    const elegidas = ['A-1'];
    const r = depurarSeleccion(elegidas, [libre]);
    expect(r.elegidas).toBe(elegidas);
    expect(r.perdidas).toEqual([]);
  });

  it('saca las que se vendieron y las reporta', () => {
    const r = depurarSeleccion(['A-1', 'A-2'], [libre, butaca('A-2', 'vendida')]);
    expect(r.elegidas).toEqual(['A-1']);
    expect(r.perdidas).toEqual(['A-2']);
  });

  it('una butaca que desapareció del mapa también cuenta como perdida', () => {
    const r = depurarSeleccion(['A-1', 'FANTASMA'], [libre]);
    expect(r.elegidas).toEqual(['A-1']);
    expect(r.perdidas).toEqual(['FANTASMA']);
  });
});
