import { describe, expect, it } from 'vitest';
import { colorSolido, familiaNativa } from './css';
import { TEMA_DEFAULT, TEMA_OSCURO } from './types';

describe('familiaNativa', () => {
  it('saca la primera familia real de un stack', () => {
    expect(familiaNativa("'Barlow', system-ui, sans-serif")).toBe('Barlow');
    expect(familiaNativa('"Space Grotesk", Roboto')).toBe('Space Grotesk');
  });

  it('un stack que ARRANCA genérico pide la fuente del sistema, no la primera concreta', () => {
    // `Roboto` y `Segoe UI` acá NO son un pedido tipográfico: son la fuente del
    // sistema de Android y de Windows escritas a mano para navegadores que no
    // entienden `system-ui`. Quedarse con una es pedirle a Android una fuente de
    // Windows.
    expect(familiaNativa('system-ui, -apple-system, Roboto, sans-serif')).toBeUndefined();
  });

  it('devuelve undefined cuando el stack es TODO genérico', () => {
    // Es el caso del tema claro: pedir la fuente del sistema es no pedir ninguna.
    expect(familiaNativa('system-ui, -apple-system, sans-serif')).toBeUndefined();
    expect(familiaNativa(undefined)).toBeUndefined();
    expect(familiaNativa('')).toBeUndefined();
    expect(familiaNativa('  ,  ,  ')).toBeUndefined();
  });

  it('el stack del TEMA_DEFAULT no pide ninguna fuente y el del OSCURO pide Barlow', () => {
    expect(familiaNativa(TEMA_DEFAULT.fuente)).toBeUndefined();
    expect(familiaNativa(TEMA_DEFAULT.fuenteDisplay)).toBeUndefined();
    expect(familiaNativa(TEMA_OSCURO.fuente)).toBe('Barlow');
    expect(familiaNativa(TEMA_OSCURO.fuenteDisplay)).toBe('Barlow Condensed');
  });

  it('no se queda con las comillas ni con los espacios', () => {
    expect(familiaNativa("  'Barlow Condensed'  , serif")).toBe('Barlow Condensed');
  });
});

describe('colorSolido', () => {
  it('deja pasar lo que ya es un color', () => {
    expect(colorSolido('#E5E7EB')).toBe('#E5E7EB');
    expect(colorSolido('transparent')).toBe('transparent');
    expect(colorSolido('rgba(255,255,255,.94)')).toBe('rgba(255,255,255,.94)');
    expect(colorSolido('hsl(210, 40%, 50%)')).toBe('hsl(210, 40%, 50%)');
  });

  it('colapsa un gradiente al tramo del MEDIO, no a un extremo', () => {
    // Los extremos de la pantalla son casi negro y casi blanco: los dos mienten.
    expect(colorSolido(TEMA_OSCURO.pantalla)).toBe('#4A4A4E');
  });

  it('el fondo del tema oscuro y el del claro sobreviven intactos', () => {
    expect(colorSolido(TEMA_OSCURO.fondo)).toBe('#0C0C0D');
    expect(colorSolido(TEMA_DEFAULT.fondo)).toBe('transparent');
    expect(colorSolido(TEMA_DEFAULT.pantalla)).toBe('#E5E7EB');
  });

  it('devuelve undefined cuando no hay ningún color que sacar', () => {
    expect(colorSolido('none')).toBeUndefined();
    expect(colorSolido(undefined)).toBeUndefined();
    expect(colorSolido('   ')).toBeUndefined();
    expect(colorSolido('url(fondo.png)')).toBeUndefined();
  });

  it('aguanta un gradiente escrito con rgb() en vez de hex', () => {
    expect(colorSolido('linear-gradient(0deg, rgb(0,0,0) 0%, rgb(120,120,120) 50%, rgb(255,255,255) 100%)')).toBe(
      'rgb(120,120,120)',
    );
  });

  it('TODA clave de color del tema oscuro se puede pintar en React Native', () => {
    // El tema oscuro es el que trae CSS: si alguna clave quedara sin traducir,
    // el renderer nativo la pasaría cruda a `backgroundColor` y no pintaría nada.
    const claves = ['fondo', 'libre', 'libreBorde', 'vendida', 'bloqueada', 'elegida', 'accesible', 'pantalla', 'panel', 'panelBorde'] as const;
    for (const k of claves) {
      const solido = colorSolido(TEMA_OSCURO[k]);
      expect(solido, `clave ${k}`).toBeDefined();
      expect(solido, `clave ${k}`).not.toContain('gradient');
    }
  });
});
