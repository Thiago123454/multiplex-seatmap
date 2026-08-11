/**
 * Motor de geometría del mapa de butacas. Puro: sin React, sin DOM, sin RN.
 *
 * DECISIÓN DE DIBUJO: las butacas se posicionan por sus coordenadas X e Y REALES
 * del POS, con UNA SOLA escala para los dos ejes. No se empaquetan en una grilla.
 *
 * Empaquetar sería más simple pero borraría la geometría de la sala, que es
 * justamente lo que le permite a un acomodador ubicarse. Con las coordenadas
 * reales salen gratis, y verificadas contra la Sala 4 de un cine real:
 *   · el PASILLO HORIZONTAL entre bloques — las filas B-E van cada 23 unidades y
 *     entre E y F hay un salto de 58;
 *   · el PASILLO CENTRAL — dentro de F..J falta el tramo 412→506 (2 anchos);
 *   · la fila «Z» (el par accesible) comparte la Y de la F, así que cae en la
 *     MISMA línea en vez de inventarse un renglón propio.
 * Una sola escala para ambos ejes mantiene además la proporción de la sala: una
 * sala ancha se ve ancha.
 *
 * 🔴 POR QUÉ ESTO NO ES UNA GRILLA (y por qué ninguna librería de grilla sirve):
 * barrido de 28 salas reales — el paso en X va de 30 a 33 y el de Y de 22 a 33, y
 * NO coinciden; 15 salas mandan filas partidas en dos alturas; una sala tiene 293
 * butacas y 30 alturas distintas para 15 filas; y otra tiene un pasillo central de
 * ~4,4 anchos de butaca. Una grilla no puede expresar 4,4 lugares vacíos ni una
 * fila a dos alturas.
 */

import type {
  Butaca,
  FilaButacas,
  LineaSala,
  LineaPlano,
  OpcionesPlano,
  PlanoSala,
} from './types';
import { parseEtiqueta } from './etiqueta';

const LABEL_W = 20; // gutter de la letra de fila
const MIN_SEAT = 24; // piso táctil por defecto; solo aplica con ajuste 'tactil'
const MAX_SEAT = 18;
/** Proporción de la celda que ocupa la butaca; el resto es el aire que las separa. */
const LLENADO = 0.86;

/**
 * Hasta qué distancia en Y dos butacas son la MISMA línea física, como fracción
 * del paso horizontal.
 *
 * Dos criterios que parecían mejores y están mal, los dos verificados contra 28
 * salas reales:
 *
 *   · «la mitad del paso típico entre filas» — en una sala 4D TODAS las filas
 *     vienen partidas (el bloque izquierdo a Y, el derecho a Y+1), así que la
 *     mediana de los saltos es 1 y la tolerancia se anula justo donde más falta;
 *   · «cortar donde más salta la escala» — en otra sala el PASILLO mide 58 contra
 *     23 de fila: 2,5×, el mismo orden de salto que separa al ruido de una fila.
 *     El criterio lee el pasillo como si fuera la frontera y colapsa cada bloque
 *     en UNA línea.
 *
 * Lo que sí separa limpio los dos mundos es la proporción contra el paso en X,
 * porque las butacas no cambian de tamaño: el ruido medido va de 1 a 6 unidades
 * (≤0,2 del paso) y la separación real entre filas nunca bajó de 22 (≥0,7). A
 * 0,35 el corte queda con margen de los dos lados y no depende de que la sala
 * tenga pasillo, ni de cuántas filas vengan partidas.
 */
export const TOL_LINEA = 0.35;

export function mediana(v: number[]): number {
  if (v.length === 0) return 1;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Clave del Map con más ocurrencias. Empate: la primera, que ya viene ordenada. */
function dominante<T>(cuenta: Map<T, number>, fallback: T): T {
  let mejor = fallback;
  let max = -1;
  for (const [k, n] of cuenta) if (n > max) { max = n; mejor = k; }
  return mejor;
}

/**
 * Fila y número de UNA butaca, por orden de confianza:
 *
 *   1. lo explícito (`butaca.fila` / `butaca.numero`), si el backend lo manda;
 *   2. lo parseado de la etiqueta `n`, que es el dato CRUDO del POS;
 *   3. el agrupado que mandó el servidor / la línea donde cae.
 *
 * 🔑 El parseo va ANTES del agrupado del servidor a propósito. Un backend puede
 * deducir la fila con una regex que no acepte filas numéricas y mandar `fila: "?"`
 * para toda la sala; la etiqueta (`1-16`) sigue siendo correcta. Sacar la fila de
 * la etiqueta arregla el rótulo sin tocar el backend.
 */
export function resolverIdentidad(
  butaca: Butaca,
  filaDelServidor: string,
  ordinalEnLinea: number,
): { fila: string; numero: string } {
  const parsed = parseEtiqueta(butaca.n);
  // '?' es el fallback típico cuando la regex del backend no matcheó: no es fila.
  const delServidor = filaDelServidor && filaDelServidor !== '?' ? filaDelServidor : '';

  return {
    fila: butaca.fila || parsed?.fila || delServidor || '',
    numero: butaca.numero || parsed?.numero || String(ordinalEnLinea),
  };
}

/** Indexa las butacas por su Y EXACTA. Base de todo lo demás. */
export function agruparPorAltura(butacas: readonly Butaca[]): Map<number, Butaca[]> {
  const porAltura = new Map<number, Butaca[]>();
  for (const b of butacas) {
    const bs = porAltura.get(b.y);
    if (bs) bs.push(b);
    else porAltura.set(b.y, [b]);
  }
  return porAltura;
}

/**
 * Paso en X, medido POR ALTURA EXACTA.
 *
 * Butacas con la misma Y exacta son sí o sí de la misma línea, así que sus
 * diferencias de X dan el paso sin depender de cómo agrupó el servidor. Eso
 * importa: si el backend mete la sala entera en una sola fila «?», midiendo el
 * paso ahí sale 1 y el mapa se desarma. Midiendo por altura sale 30.
 */
export function pasoEnX(porAltura: Map<number, Butaca[]>): number {
  const pitches: number[] = [];
  for (const bs of porAltura.values()) {
    const xs = bs.map((b) => b.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) pitches.push(xs[i] - xs[i - 1]);
  }
  return mediana(pitches);
}

/**
 * Agrupa las Y crudas en LÍNEAS VISUALES.
 *
 * Una fila puede venir partida en Y por uno o dos píxeles, y el anexo accesible
 * puede NO compartir la Y exacta de su fila. Agrupando por Y exacto eso dibujaba
 * renglones fantasma y APILABA DOS LETRAS en el mismo lugar del gutter.
 */
export function agruparEnLineas(
  filas: FilaButacas[],
  porAltura: Map<number, Butaca[]>,
  pitchX: number,
): LineaSala[] {
  const ys = [...porAltura.keys()].sort((a, b) => a - b);
  if (ys.length === 0) return [];

  const tol = pitchX * TOL_LINEA;
  const grupos: number[][] = [[ys[0]]];
  for (let i = 1; i < ys.length; i++) {
    const g = grupos[grupos.length - 1];
    if (ys[i] - g[g.length - 1] <= tol) g.push(ys[i]);
    else grupos.push([ys[i]]);
  }

  // Fila que el SERVIDOR le asignó a cada butaca, para el último fallback.
  const filaDelServidor = new Map<string, string>();
  for (const f of filas) for (const b of f.butacas) filaDelServidor.set(b.n, f.fila);

  return grupos.map((g) => {
    const bs = g.flatMap((y) => porAltura.get(y) ?? []);

    // La línea se dibuja a la Y donde está el grueso de las butacas: así el
    // cuerpo de la fila no se mueve ni un píxel y el anexo (la Z accesible, la
    // butaca suelta) se alinea con él.
    const porY = new Map<number, number>();
    for (const b of bs) porY.set(b.y, (porY.get(b.y) ?? 0) + 1);

    // Y la letra es la de la fila que más aporta: si una línea la forman la I
    // (14 butacas) y la Z (2 accesibles) ⇒ se rotula «I», que es como la lee el
    // acomodador. Se cuenta la fila RESUELTA, no la que mandó el servidor.
    const porFila = new Map<string, number>();
    for (const b of bs) {
      const fila = resolverIdentidad(b, filaDelServidor.get(b.n) ?? '', 0).fila;
      if (fila) porFila.set(fila, (porFila.get(fila) ?? 0) + 1);
    }

    return { y: dominante(porY, g[0]), letra: dominante(porFila, ''), butacas: bs };
  });
}

/**
 * Resuelve la sala entera a píxeles. Devuelve `null` si no hay nada que dibujar
 * (sala vacía o contenedor todavía sin medir), que es el caso real del primer
 * render antes del layout.
 */
export function calcularPlano(
  filas: FilaButacas[],
  opciones: OpcionesPlano,
): PlanoSala | null {
  const {
    width,
    ajuste = 'ancho',
    orientacion = 'horizontal',
    labelWidth = LABEL_W,
    minSeat = MIN_SEAT,
    maxSeat = MAX_SEAT,
    llenado = LLENADO,
    zoom = 1,
  } = opciones;

  const butacas = filas.flatMap((f) => f.butacas);
  if (butacas.length === 0 || width <= 0) return null;

  const porAltura = agruparPorAltura(butacas);
  const pitchX = pasoEnX(porAltura);
  const lineas = agruparEnLineas(filas, porAltura, pitchX);
  if (lineas.length === 0) return null;

  const xs = butacas.map((b) => b.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = lineas[0].y;
  const y1 = lineas[lineas.length - 1].y;

  // Paso en Y: sobre las líneas ya resueltas, no sobre las Y crudas — si no, el
  // ruido de las filas partidas lo tira a 1. La mediana aguanta además el salto
  // del pasillo, que a un promedio lo desvirtúa.
  const dy: number[] = [];
  for (let i = 1; i < lineas.length; i++) dy.push(lineas[i].y - lineas[i - 1].y);
  const pitchY = dy.length ? mediana(dy) : pitchX;

  // ── LA ESCALA ────────────────────────────────────────────────────────────
  // 🔴 El tamaño de la butaca se DERIVA de la escala; no se clampea aparte.
  //    Clampearlo por separado es lo que hacía que en un contenedor chico las
  //    butacas crecieran hasta un mínimo mientras la separación seguía
  //    achicándose: se pisaban entre sí. Derivándolo, el ancho de la butaca es
  //    `llenado` (<1) veces la celda, así que NUNCA puede tapar a la de al lado.

  // ── ORIENTACIÓN ──────────────────────────────────────────────────────────
  // En vertical la sala se acuesta 90°: la profundidad de filas se mapea al
  // ANCHO de la pantalla y las butacas de una fila BAJAN. En un celular la sala
  // (ancha y baja) entra a lo largo y se scrollea con el pulgar, que es el gesto
  // natural, en vez de en horizontal.
  const spanX = x1 - x0; // butacas a lo largo de la fila
  const spanY = y1 - y0; // profundidad de filas
  const vertical =
    orientacion === 'vertical' ||
    // `auto`: solo cuando de verdad conviene — pantalla angosta Y sala más ancha
    // que profunda. Se mira el ancho y no el alto porque el alto del contenedor
    // suele depender del propio dibujo (sería circular).
    (orientacion === 'auto' && width < 560 && spanX > spanY);

  // El gutter de rótulos se come ancho en horizontal y alto en vertical.
  const gutterEnAncho = vertical ? 0 : labelWidth;
  const gutterEnAlto = vertical ? labelWidth : 0;

  // Paso de la sala que se mapea a cada eje de la PANTALLA.
  const pasoEnAncho = vertical ? pitchY : pitchX;
  const pasoEnAlto = vertical ? pitchX : pitchY;
  const spanEnAncho = vertical ? spanY : spanX;
  const spanEnAlto = vertical ? spanX : spanY;

  // +paso para que la última butaca entre entera y no se corte contra el borde.
  const disponible = Math.max(1, width - gutterEnAncho - 2);
  const escalaAjuste = disponible / (spanEnAncho + pasoEnAncho);

  // Techo: que en una pantalla grande la butaca no se agrande al pedo.
  const escalaTecho = maxSeat / (Math.max(pitchX, pitchY) * llenado);
  let escala = Math.min(escalaAjuste, escalaTecho);

  if (ajuste === 'tactil') {
    // Piso duro: el lado MENOR de la butaca tiene que llegar a `minSeat`. Gana
    // sobre el techo — un blanco que no se puede tocar no es un mapa usable.
    escala = Math.max(escala, minSeat / (Math.min(pitchX, pitchY) * llenado));
  }

  // ZOOM: multiplica la escala ya resuelta.
  //
  // 🔑 Es un MULTIPLICADOR sobre la escala, no un tamaño de butaca. Por eso no
  // puede romper el dibujo: los dos ejes se escalan por el mismo factor, así que
  // la proporción de la sala, los pasillos y la relación butaca/separación
  // quedan intactos. Cambia cuánto ves, nunca la forma de lo que ves.
  escala *= zoom;

  // 🔴 LAS FILAS ESTÁN MÁS JUNTAS QUE LAS BUTACAS. El paso en X es 32 unidades
  //    pero en Y es 23. Dibujar la butaca CUADRADA al ancho del pitch de X la
  //    hace más alta que la separación entre filas ⇒ cada fila se monta sobre la
  //    siguiente y el mapa se ve como una mancha de rayas verticales en vez de
  //    butacas sueltas. Por eso la butaca es RECTANGULAR: ancho del pitch de X,
  //    alto del de Y, misma escala para los dos.
  const w = pasoEnAncho * escala * llenado;
  const h = pasoEnAlto * escala * llenado;

  const filaDelServidor = new Map<string, string>();
  for (const f of filas) for (const b of f.butacas) filaDelServidor.set(b.n, f.fila);

  const lineasPlano: LineaPlano[] = lineas.map((l) => {
    // La línea (la fila de la sala) es un renglón en horizontal y una COLUMNA en
    // vertical: por eso su offset cambia de eje.
    const offsetLinea = (l.y - y0) * escala;
    const top = vertical ? gutterEnAlto : offsetLinea;

    // El ordinal es el ÚLTIMO fallback del número: posición dentro de la línea,
    // de izquierda a derecha. Solo se usa si la etiqueta no trajo número.
    const ordenados = [...l.butacas].sort((a, b) => a.x - b.x);
    const ordinal = new Map(ordenados.map((b, i) => [b.n, i + 1]));

    return {
      letra: l.letra,
      // En vertical el rótulo de la línea se ubica por su LEFT (es una columna);
      // el renderer lo lee de la primera butaca. `top` queda al ras del gutter.
      top,
      left: vertical ? offsetLinea : gutterEnAncho,
      butacas: l.butacas.map((b) => {
        const id = resolverIdentidad(b, filaDelServidor.get(b.n) ?? '', ordinal.get(b.n) ?? 1);
        const offsetButaca = (b.x - x0) * escala;
        return {
          n: b.n,
          fila: id.fila,
          numero: id.numero,
          estado: b.s,
          accesible: b.t === 1,
          left: gutterEnAncho + (vertical ? offsetLinea : offsetButaca),
          top: gutterEnAlto + (vertical ? offsetButaca : offsetLinea),
        };
      }),
    };
  });

  // El número va DENTRO de la butaca, así que lo limita el lado más chico. Por
  // debajo de ~9 px de alto el dígito deja de leerse y solo ensucia el color,
  // que es la señal que de verdad usa el acomodador.
  const fuenteNumero = Math.max(6, Math.min(14, Math.min(h * 0.62, w * 0.55)));
  const ancho = gutterEnAncho + spanEnAncho * escala + w;
  const alto = gutterEnAlto + spanEnAlto * escala + h;

  return {
    lineas: lineasPlano,
    w,
    h,
    alto,
    ancho,
    redondeo: Math.max(1.5, Math.min(w, h) * 0.22),
    fuenteLetra: Math.max(7, Math.min(13, h * 0.72)),
    fuenteNumero,
    numerosLegibles: h >= 9 && w >= 11,
    labelWidth,
    orientacion: vertical ? 'vertical' : 'horizontal',
    // Un píxel de tolerancia: los redondeos de coma flotante no son desborde.
    desborda: ancho > width + 1,
  };
}
