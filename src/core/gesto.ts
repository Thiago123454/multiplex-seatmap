/**
 * Matemática del pinch. PURA: sin React, sin DOM, sin React Native.
 *
 * 🔑 Vive acá, y no duplicada a mano en cada renderer, porque este renglón ya se
 * rompió tres veces seguidas y las tres se podrían haber atrapado con un test de
 * veinte líneas:
 *
 *   1. El clamp se comía zoom que quedaba guardado en la separación de los dedos
 *      (zona muerta enorme + restitución bit a bit del encuadre al reabrir).
 *   2. Al arreglar (1) rebaseando la foto, la foto empezó a perseguir a los dedos
 *      hacia abajo: con las yemas pegadas quedaba anclada en `pin.d` ~12 px y
 *      desde ahí 3 px de temblor eran +25 % de zoom.
 *   3. El primer intento de arreglar (2) puso el piso sobre el `d` que la foto
 *      GUARDA, condicionado a estar en el fondo. Tapaba el agujero solo a esa
 *      altura de zoom: con la vista adentro y la foto tomada con los dedos
 *      pegados, el mismo síntoma volvía igual.
 *
 * Los tres son el mismo bug —la ganancia del pinch es `1/pin.d` y nadie la
 * acotaba— y los tres se colaron porque la fórmula vivía duplicada a mano en los
 * dos renderers, sin un solo test. Acá se decide UNA vez y se testea.
 */

/**
 * Separación (px) por debajo de la cual el pinch deja de ganar sensibilidad.
 *
 * 🔴 El pinch mide zoom por COCIENTE (`z = pin.z * d / pin.d`), así que la
 * ganancia relativa es `dz/z = dd/pin.d`: un `pin.d` chico es una singularidad.
 * Con las yemas pegadas (`pin.d` ~12 px medidos en device, o 1 px cuando el
 * digitalizador encima los dos contactos) abrir 3 px valía +25 % de zoom y 18 px
 * te mandaban del 100 % al tope.
 *
 * El piso NO va sobre el `d` que la foto guarda —eso solo tapa el agujero a la
 * altura de zoom donde el clamp está mordiendo, y deja la misma singularidad
 * viva en cualquier otra— sino sobre la GANANCIA, en `pasoPinch`.
 *
 * Es poco más que `DEDO` (46), la constante con la que los renderers miden «el
 * ancho de un dedo». Bajarlo a 46 es un cambio de un literal si el smoke test en
 * device dice que el gesto quedó pesado con los dedos juntos. No subirlo sin
 * volver a medir.
 */
export const PINCH_MIN = 56;

/** Los dos topes del zoom. `zFit` = la sala entera entra = el 100 % de la UI. */
export interface TopesZoom {
  zFit: number;
  zMax: number;
}

/** Encuadre de la vista: traslación en px del visor + escala. */
export interface Encuadre {
  x: number;
  y: number;
  z: number;
}

/**
 * Foto congelada del pinch: contra esto se mide cada frame del gesto.
 *
 * `cx`/`cy` son el punto medio de los dedos en coordenadas del visor, y `x`/`y`/`z`
 * el encuadre que había al sacarla.
 */
export interface FotoPinch extends Encuadre {
  /** Separación de los dedos. Nunca 0 (ver `separacion`). */
  d: number;
  cx: number;
  cy: number;
}

/** Un frame del gesto: el encuadre que pide, y si hubo que recortarlo. */
export interface PasoPinch extends Encuadre {
  /**
   * El clamp mordió: `z` no es lo que pidieron los dedos. Quien llame tiene que
   * volver a sacar la foto (ver `fotoPinch`), o el zoom recortado queda guardado
   * en la separación de los dedos y vuelve entero al reabrirlos.
   */
  mordio: boolean;
}

/** El zoom que se puede dar, dentro de los topes. */
export function limitarZoom(z: number, { zFit, zMax }: TopesZoom): number {
  return Math.min(zMax, Math.max(zFit, z));
}

/**
 * Separación entre dos dedos, saneada.
 *
 * 🔴 El `|| 1` es el ÚNICO saneador de la cadena: dos contactos exactamente
 * encimados dan `hypot` 0 y todo lo que sigue divide por eso. Tiene que estar
 * acá, antes de cualquier `Math.max`, porque `Math.max(NaN, n)` propaga el NaN.
 */
export function separacion(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by) || 1;
}

/** Foto del pinch con la separación `d`, el centro `cx`/`cy` y el encuadre `enc`. */
export function fotoPinch(d: number, cx: number, cy: number, enc: Encuadre): FotoPinch {
  return { d, cx, cy, z: enc.z, x: enc.x, y: enc.y };
}

/**
 * Un frame de pinch: qué encuadre pide el gesto con los dedos en `d` y su punto
 * medio en `cx`/`cy`.
 *
 * El punto medio de los dedos queda clavado bajo ellos: `k` es cuánto creció el
 * zoom respecto de la foto, y el encuadre se recalcula para que el punto del
 * plano que estaba en el medio siga estándolo.
 */
export function pasoPinch(
  pin: FotoPinch,
  d: number,
  cx: number,
  cy: number,
  topes: TopesZoom,
): PasoPinch {
  // 🔴 El piso va sobre la GANANCIA, no sobre el `d` que la foto guarda: se
  // corre la escala de separaciones lo justo para que el denominador nunca baje
  // de `PINCH_MIN`, así que la ganancia relativa `1/(d + off)` queda acotada en
  // 1/56 = 1.79 %/px por más pegadas que estén las yemas.
  //
  // 🔑 El MISMO `off` va en los dos términos, y de ahí salen las tres propiedades
  // que hacen que esto no necesite ningún caso especial:
  //   · `d === pin.d` da EXACTAMENTE `pin.z`, así que con los dedos quietos el
  //     mapa no deriva — ni en el fondo ni contra `zMax`. Por eso el piso puede
  //     ser incondicional: no hay tope donde inflar el gesto lo haga moverse solo.
  //   · con `pin.d >= PINCH_MIN`, `off` es 0 y esto es `d / pin.d` bit a bit: un
  //     pinch normal no se entera de que esta línea existe.
  //   · el gesto responde desde el primer píxel, no hay recorrido muerto.
  const off = Math.max(0, PINCH_MIN - pin.d);
  const bruto = pin.z * ((d + off) / (pin.d + off)); // lo que PIDIÓ el gesto
  const z = limitarZoom(bruto, topes); // lo que se puede dar
  const k = z / pin.z;
  return {
    x: cx - (pin.cx - pin.x) * k,
    y: cy - (pin.cy - pin.y) * k,
    z,
    // 🔑 El `!==` no necesita epsilon: `Math.min`/`Math.max` devuelven EL MISMO
    // double cuando no clampean, así que un pinch que no toca los topes queda
    // bit-idéntico y no dispara ningún rebase.
    mordio: Number.isFinite(bruto) && z !== bruto,
  };
}
