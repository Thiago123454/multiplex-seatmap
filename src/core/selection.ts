/**
 * Reglas de selección de butacas. Puras: deciden QUÉ se puede elegir, no cómo
 * se ve ni cómo se avisa.
 *
 * El rechazo devuelve un MOTIVO estable en vez de un booleano pelado, porque
 * «no podés elegir esa» y «ya llegaste al máximo» son cosas distintas para el
 * que está comprando y la UI necesita poder explicarlas. La copy vive en la UI:
 * acá solo viaja la clave.
 */

import type { Butaca, EstadoButaca, LineaPlano } from './types';

export interface ReglasSeleccion {
  /** Tope de butacas por operación. `undefined` o 0 = sin tope. */
  max?: number;
  /**
   * Estados en los que se puede clickear. Por defecto solo `libre`:
   * una butaca vendida o bloqueada no se elige ni por error.
   */
  elegibles?: EstadoButaca[];
}

export type MotivoRechazo = 'vendida' | 'bloqueada' | 'limite' | 'hueco';

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

/** Dos butacas son vecinas si su separación no supera esto, en anchos de butaca. */
const VECINAS = 1.7;

/**
 * Cuenta las butacas libres que quedan SUELTAS: un solo lugar vacío rodeado de
 * ocupado/elegido, o contra el borde de su bloque. Un hueco de uno no lo compra
 * nadie, así que es plata que la sala pierde.
 *
 * 🔑 **Se usa comparando ANTES contra DESPUÉS, y solo se rechaza si SUBE.** La
 * sala ya viene con huecos de otras ventas; rechazar por el total dejaría al que
 * vende sin poder elegir nada en una sala medio llena.
 *
 * Trabaja sobre las líneas YA resueltas a píxeles y no sobre las butacas crudas,
 * porque es ahí donde el PASILLO se ve: dos butacas separadas por más de
 * `VECINAS` anchos no son vecinas, así que la última butaca antes del pasillo no
 * cuenta como suelta por tener el pasillo al lado.
 */
export function contarHuecos(
  lineas: readonly LineaPlano[],
  elegidas: readonly string[] | ReadonlySet<string>,
  anchoButaca: number,
): number {
  const sel = elegidas instanceof Set ? elegidas : new Set(elegidas as readonly string[]);
  let huecos = 0;

  for (const l of lineas) {
    const bs = [...l.butacas].sort((a, b) => a.left - b.left);
    let run = 0;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      const libre = b.estado === 'libre' && !sel.has(b.n);
      const corte = i + 1 >= bs.length || bs[i + 1].left - b.left > anchoButaca * VECINAS;
      if (libre) run++;
      if (!libre || corte) {
        if (run === 1) huecos++;
        run = 0;
      }
    }
  }

  return huecos;
}

/**
 * ¿Elegir `butaca` deja alguna butaca suelta que antes no lo estaba?
 *
 * Envuelve `contarHuecos` en la comparación antes/después, que es la única forma
 * correcta de usarlo. Devuelve `true` si hay que rechazar.
 */
export function dejaButacaSuelta(
  lineas: readonly LineaPlano[],
  elegidas: readonly string[],
  n: string,
  anchoButaca: number,
): boolean {
  const antes = contarHuecos(lineas, elegidas, anchoButaca);
  const despues = contarHuecos(lineas, [...elegidas, n], anchoButaca);
  return despues > antes;
}
