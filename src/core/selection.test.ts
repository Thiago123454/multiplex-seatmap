import { describe, it, expect } from 'vitest';
import {
  puedeElegir,
  alternar,
  depurarSeleccion,
  contarHuecos,
  dejaButacaSuelta,
} from './selection';
import type { Butaca, LineaPlano } from './types';

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

describe('contarHuecos / dejaButacaSuelta', () => {
  /** Una línea a píxeles: `libre` = 'l', vendida = 'v', ancho de butaca 10, paso 12. */
  const linea = (patron: string, fila = 'A'): LineaPlano => ({
    letra: fila,
    top: 0,
    left: 0,
    butacas: patron.split('').map((c, i) => ({
      n: `${fila}-${i + 1}`,
      fila,
      numero: String(i + 1),
      estado: c === 'v' ? ('vendida' as const) : ('libre' as const),
      accesible: false,
      left: i * 12,
      top: 0,
    })),
  });
  const W = 10;

  it('una fila entera libre no tiene huecos', () => {
    expect(contarHuecos([linea('lllll')], [], W)).toBe(0);
  });

  it('un libre solo entre dos vendidas ES un hueco', () => {
    expect(contarHuecos([linea('vlv')], [], W)).toBe(1);
  });

  it('dos libres juntos no son un hueco', () => {
    expect(contarHuecos([linea('vllv')], [], W)).toBe(0);
  });

  it('el libre del borde también cuenta si queda solo', () => {
    expect(contarHuecos([linea('lvvv')], [], W)).toBe(1);
  });

  it('una butaca ELEGIDA cuenta como ocupada', () => {
    // 'l l l' con la del medio elegida ⇒ las dos de los costados quedan sueltas.
    expect(contarHuecos([linea('lll')], ['A-2'], W)).toBe(2);
  });

  it('🔴 el PASILLO corta el bloque: la de al lado no queda suelta', () => {
    // Dos bloques de 2, separados por más de 1,7 anchos.
    const l: LineaPlano = {
      letra: 'A',
      top: 0,
      left: 0,
      butacas: [0, 12, 60, 72].map((x, i) => ({
        n: `A-${i + 1}`,
        fila: 'A',
        numero: String(i + 1),
        estado: 'libre' as const,
        accesible: false,
        left: x,
        top: 0,
      })),
    };
    // Cuatro libres en dos bloques de dos: ningún bloque queda en 1.
    expect(contarHuecos([l], [], W)).toBe(0);
    // Si elijo una de un bloque, la otra de ESE bloque queda suelta — una sola.
    expect(contarHuecos([l], ['A-1'], W)).toBe(1);
  });

  it('suma los huecos de todas las líneas', () => {
    expect(contarHuecos([linea('vlv', 'A'), linea('vlv', 'B')], [], W)).toBe(2);
  });

  describe('dejaButacaSuelta — la comparación antes/después', () => {
    it('rechaza la elección que deja una suelta', () => {
      // 'lll': elegir la del medio deja dos sueltas donde no había ninguna.
      expect(dejaButacaSuelta([linea('lll')], [], 'A-2', W)).toBe(true);
    });

    it('acepta la que no empeora nada', () => {
      expect(dejaButacaSuelta([linea('lllll')], [], 'A-1', W)).toBe(false);
    });

    it('🔑 NO rechaza por huecos que ya venían de otras ventas', () => {
      // La sala ya tiene un hueco propio ('vlv' al principio). Elegir lejos de
      // ahí no lo empeora, así que tiene que dejarse.
      const l = linea('vlv' + 'llllll');
      expect(contarHuecos([l], [], W)).toBeGreaterThan(0);
      expect(dejaButacaSuelta([l], [], 'A-4', W)).toBe(false);
    });

    it('elegir contiguo a lo ya elegido no deja sueltas', () => {
      expect(dejaButacaSuelta([linea('llllll')], ['A-1'], 'A-2', W)).toBe(false);
    });
  });
});
