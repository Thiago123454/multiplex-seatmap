/**
 * La etiqueta de la butaca (`n`) es el `SeatNumber` del POS Cinestar y viene como
 * **`<fila>-<numero>`**: `E-1`, `E-2`, `1-16`, `2-14`.
 *
 * 🔴 **La fila puede ser LETRA o NÚMERO.** En 7 de las 10 salas de Belgrano
 * (4, 5, 6, 7, 8, 10 y la Mixta) es numérica. Un `^([A-Za-z]+)` no matchea — es
 * exactamente el bug por el que el relay manda `fila: "?"` en esas salas. Cualquier
 * cosa que parsee esto tiene que aceptar las dos formas.
 *
 * Por eso la fila y el número de cada butaca se sacan de ACÁ y no del agrupado que
 * manda el servidor: la etiqueta es el dato crudo del POS y no pasó por esa regex.
 */

export interface Etiqueta {
  /** Letra o número de fila, tal cual viene: 'E', '1', 'AA'. */
  fila: string;
  /** Número de butaca dentro de la fila. String: puede traer ceros a la izquierda. */
  numero: string;
}

/** Separador del `SeatNumber` de Cinestar. */
const SEP = '-';

/** Fallback para etiquetas pegadas tipo 'E12' (no vistas en el parque, por las dudas). */
const PEGADA = /^([A-Za-z]+|\d+?)(\d+)$/;

/**
 * Parte `n` en fila + número. Devuelve `null` si no se puede — el llamador decide
 * el fallback, que acá no se puede elegir bien (depende de la geometría).
 *
 * Corta por el ÚLTIMO separador, no por el primero: una fila 'AA-B-3' es rara pero
 * el número siempre es el último tramo.
 */
export function parseEtiqueta(n: string | null | undefined): Etiqueta | null {
  if (!n) return null;
  const s = String(n).trim();
  if (!s) return null;

  const i = s.lastIndexOf(SEP);
  if (i > 0 && i < s.length - 1) {
    const fila = s.slice(0, i).trim();
    const numero = s.slice(i + 1).trim();
    if (fila && numero) return { fila, numero };
  }

  const m = PEGADA.exec(s);
  if (m) return { fila: m[1], numero: m[2] };

  return null;
}

/** Rearma la etiqueta. `formatearEtiqueta('E', '1')` → `'E-1'`. */
export function formatearEtiqueta(fila: string, numero: string | number): string {
  return `${fila}${SEP}${numero}`;
}
