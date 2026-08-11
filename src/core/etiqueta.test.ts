import { describe, it, expect } from 'vitest';
import { parseEtiqueta, formatearEtiqueta } from './etiqueta';

describe('parseEtiqueta', () => {
  it('el caso normal: fila con letra', () => {
    expect(parseEtiqueta('E-1')).toEqual({ fila: 'E', numero: '1' });
    expect(parseEtiqueta('E-12')).toEqual({ fila: 'E', numero: '12' });
  });

  it('🔴 fila NUMÉRICA — las 7 salas de Belgrano', () => {
    // Es el caso que la regex del relay (^[A-Za-z]+) no matchea.
    expect(parseEtiqueta('1-16')).toEqual({ fila: '1', numero: '16' });
    expect(parseEtiqueta('2-14')).toEqual({ fila: '2', numero: '14' });
  });

  it('fila de dos letras', () => {
    expect(parseEtiqueta('AA-3')).toEqual({ fila: 'AA', numero: '3' });
  });

  it('corta por el ÚLTIMO separador', () => {
    expect(parseEtiqueta('A-B-3')).toEqual({ fila: 'A-B', numero: '3' });
  });

  it('conserva ceros a la izquierda (por eso el número es string)', () => {
    expect(parseEtiqueta('E-01')).toEqual({ fila: 'E', numero: '01' });
  });

  it('tolera espacios', () => {
    expect(parseEtiqueta('  E-1  ')).toEqual({ fila: 'E', numero: '1' });
  });

  it('fallback para etiquetas pegadas', () => {
    expect(parseEtiqueta('E12')).toEqual({ fila: 'E', numero: '12' });
  });

  it('devuelve null cuando no puede, en vez de inventar', () => {
    expect(parseEtiqueta('')).toBeNull();
    expect(parseEtiqueta(null)).toBeNull();
    expect(parseEtiqueta(undefined)).toBeNull();
    expect(parseEtiqueta('-')).toBeNull();
    expect(parseEtiqueta('-5')).toBeNull();
    expect(parseEtiqueta('E-')).toBeNull();
    expect(parseEtiqueta('SIN_SEPARADOR')).toBeNull();
  });
});

describe('formatearEtiqueta', () => {
  it('es la inversa del parseo', () => {
    const e = parseEtiqueta('E-12')!;
    expect(formatearEtiqueta(e.fila, e.numero)).toBe('E-12');
  });
});
