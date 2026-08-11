/**
 * Reglas de selección de butacas. Puras: deciden QUÉ se puede elegir, no cómo
 * se ve ni cómo se avisa.
 *
 * El rechazo devuelve un MOTIVO estable en vez de un booleano pelado, porque
 * «no podés elegir esa» y «ya llegaste al máximo» son cosas distintas para el
 * que está comprando y la UI necesita poder explicarlas. La copy vive en la UI:
 * acá solo viaja la clave.
 */

import type { Butaca, EstadoButaca } from './types';

export interface ReglasSeleccion {
  /** Tope de butacas por operación. `undefined` o 0 = sin tope. */
  max?: number;
  /**
   * Estados en los que se puede clickear. Por defecto solo `libre`:
   * una butaca vendida o bloqueada no se elige ni por error.
   */
  elegibles?: EstadoButaca[];
}

export type MotivoRechazo = 'vendida' | 'bloqueada' | 'limite';

/**
 * Campo opcional en vez de unión discriminada A PROPÓSITO.
 *
 * El ERP web compila con `strict: false`, y sin `strictNullChecks` TypeScript
 * no narrowea `{ok: true} | {ok: false, motivo}` por el discriminante: leer
 * `r.motivo` en la rama del `else` da TS2339. Como este núcleo lo consumen los
 * dos proyectos (mobile sí es strict), la forma tiene que funcionar en ambos.
 */
export interface ResultadoElegir {
  ok: boolean;
  /** Presente solo cuando `ok` es false. */
  motivo?: MotivoRechazo;
}

const ELEGIBLES_DEFAULT: EstadoButaca[] = ['libre'];

/**
 * ¿Se puede AGREGAR esta butaca a la selección actual?
 *
 * Ojo: no contempla el caso «ya está elegida» — eso no es agregar, es sacar, y
 * sacar siempre se puede (ver `alternar`).
 */
export function puedeElegir(
  butaca: Butaca,
  elegidas: readonly string[],
  reglas: ReglasSeleccion = {},
): ResultadoElegir {
  const elegibles = reglas.elegibles ?? ELEGIBLES_DEFAULT;

  if (!elegibles.includes(butaca.s)) {
    // 'libre' no puede caer acá salvo que alguien lo saque de `elegibles`; en
    // ese caso el motivo honesto es el estado que tiene.
    return { ok: false, motivo: butaca.s === 'bloqueada' ? 'bloqueada' : 'vendida' };
  }

  const max = reglas.max ?? 0;
  if (max > 0 && elegidas.length >= max) return { ok: false, motivo: 'limite' };

  return { ok: true };
}

/**
 * Alterna una butaca en la selección. Devuelve un array NUEVO; si la operación
 * no es válida devuelve el mismo array (identidad estable ⇒ el render no se
 * repite al rebotar un click inválido).
 *
 * Deseleccionar siempre se permite, aunque el estado de la butaca ya no sea
 * elegible: si el mapa se refrescó y alguien te ganó de mano, tenés que poder
 * sacarla igual.
 */
export function alternar(
  butaca: Butaca,
  elegidas: readonly string[],
  reglas: ReglasSeleccion = {},
): string[] {
  if (elegidas.includes(butaca.n)) return elegidas.filter((n) => n !== butaca.n);
  if (!puedeElegir(butaca, elegidas, reglas).ok) return elegidas as string[];
  return [...elegidas, butaca.n];
}

/**
 * Saca de la selección las butacas que dejaron de estar libres.
 *
 * Se usa al refrescar el mapa: entre que el usuario eligió y confirmó, otro
 * puesto pudo vender esa misma butaca. Devuelve el mismo array si no cambió
 * nada, así el caso normal (que es el 99%) no dispara re-render.
 */
export function depurarSeleccion(
  elegidas: readonly string[],
  butacas: readonly Butaca[],
  reglas: ReglasSeleccion = {},
): { elegidas: string[]; perdidas: string[] } {
  const elegibles = reglas.elegibles ?? ELEGIBLES_DEFAULT;
  const porId = new Map(butacas.map((b) => [b.n, b]));

  const perdidas = elegidas.filter((n) => {
    const b = porId.get(n);
    // Si la butaca desapareció del mapa, también la perdimos.
    return !b || !elegibles.includes(b.s);
  });

  if (perdidas.length === 0) return { elegidas: elegidas as string[], perdidas };
  return { elegidas: elegidas.filter((n) => !perdidas.includes(n)), perdidas };
}
