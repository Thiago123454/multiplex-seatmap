/**
 * Mapa de butacas — tipos compartidos.
 *
 * El origen del dato es el POS del cine, que entrega cada butaca con sus
 * coordenadas X e Y ABSOLUTAS de la sala. No es una grilla: el paso en X no
 * coincide con el de Y, las filas pueden venir partidas en dos alturas y los
 * pasillos miden fracciones de butaca. Ver `layout.ts`.
 */

export type EstadoButaca = 'libre' | 'vendida' | 'bloqueada';

export interface Butaca {
  /** Etiqueta física de la butaca, tal cual la lee el acomodador: 'B-12'. */
  n: string;
  x: number;
  y: number;
  s: EstadoButaca;
  /** 1 = butaca especial (accesible / movilidad reducida). */
  t: number;
  /**
   * Fila y número explícitos. Opcionales: si no vienen se derivan de `n`
   * (ver `etiqueta.ts`). Sirven para una fuente que no sea el POS, o para
   * pisar el parseo en una sala con etiquetas raras.
   */
  fila?: string;
  numero?: string;
}

export interface FilaButacas {
  fila: string;
  y: number;
  butacas: Butaca[];
}

/**
 * Una línea horizontal de la sala. Puede juntar más de una «fila» del POS:
 * el anexo accesible suele venir como fila propia a una Y de uno o dos píxeles
 * de distancia, y es la MISMA línea física.
 */
export interface LineaSala {
  /** Y cruda a la que se dibuja toda la línea (la del grupo mayoritario). */
  y: number;
  /** Letra a rotular: la de la fila que más butacas aporta a la línea. */
  letra: string;
  butacas: Butaca[];
}

/** Butaca ya resuelta a píxeles, lista para pintar sin más cuentas. */
export interface ButacaPlano {
  /** Etiqueta completa, la identidad de la butaca en la sala: 'B-12'. */
  n: string;
  /**
   * Fila de ESTA butaca — no la de la línea donde se dibuja. Difieren cuando el
   * anexo accesible comparte línea con su fila: la Z de una sala se dibuja en la
   * línea rotulada 'F', pero su fila es 'Z' y el ticket dice 'Z'.
   */
  fila: string;
  /** Número dentro de la fila. Es lo que se imprime dentro de la butaca. */
  numero: string;
  estado: EstadoButaca;
  accesible: boolean;
  /** px desde el borde izquierdo del plano (ya incluye el gutter de la letra). */
  left: number;
  /** px desde el borde superior del plano. */
  top: number;
}

export interface LineaPlano {
  letra: string;
  top: number;
  butacas: ButacaPlano[];
}

/**
 * Cómo se elige la escala del dibujo. Es LA decisión responsive.
 *
 * - `'ancho'`  — la sala entra completa en el contenedor. Sirve para MIRAR: no
 *   hay que scrollear, pero en un celular la butaca puede quedar en 10 px.
 * - `'tactil'` — la butaca nunca baja de `minSeat`, aunque la sala no entre y
 *   haya que scrollear en horizontal. Es lo que hay que usar para ELEGIR: un
 *   blanco de 10 px no se puede tocar con el dedo.
 */
export type AjusteEscala = 'ancho' | 'tactil';

/**
 * El plano completo en píxeles. Es lo único que consume un renderer: no le
 * queda ninguna decisión de geometría, solo pintar rectángulos.
 */
export interface PlanoSala {
  lineas: LineaPlano[];
  /** Ancho de la butaca. Distinto del alto A PROPÓSITO — ver `layout.ts`. */
  w: number;
  /** Alto de la butaca. */
  h: number;
  /** Alto total del plano. */
  alto: number;
  /** Ancho total ocupado, gutter incluido. */
  ancho: number;
  /** Radio sugerido para la esquina de la butaca. */
  redondeo: number;
  /** Tamaño de fuente sugerido para la letra de fila. */
  fuenteLetra: number;
  /** Tamaño de fuente sugerido para el número DENTRO de la butaca. */
  fuenteNumero: number;
  /**
   * `false` cuando la butaca quedó tan chica que el número no se lee. A la escala
   * de «ver la sala entera» la butaca puede caer a 5-8 px: ahí imprimir el número
   * es ruido gris, no información. El renderer lo usa para decidir solo.
   */
  numerosLegibles: boolean;
  /** Gutter reservado a la izquierda para la letra. */
  labelWidth: number;
  /**
   * `true` cuando el plano es más ancho que el contenedor y hay que scrollear.
   * Solo puede pasar con `ajuste: 'tactil'`. El renderer lo usa para avisar.
   */
  desborda: boolean;
}

export interface OpcionesPlano {
  /** Ancho disponible en px (del contenedor). Obligatorio. */
  width: number;
  /** Ver `AjusteEscala`. Default `'ancho'`. */
  ajuste?: AjusteEscala;
  /** Gutter de la letra de fila. */
  labelWidth?: number;
  /**
   * Lado mínimo de la butaca. En `ajuste: 'tactil'` es un piso duro: la escala
   * crece hasta respetarlo y el plano desborda. En `'ancho'` no se usa.
   */
  minSeat?: number;
  /** Techo del lado de la butaca, para que no se agrande al pedo en desktop. */
  maxSeat?: number;
  /** Proporción de la celda que ocupa la butaca; el resto es el aire que separa. */
  llenado?: number;
}

/**
 * Paleta del mapa. Va por parámetro y no importada de un tema concreto: este
 * paquete no puede depender del design system de ninguna app.
 *
 * Los NEUTROS (vendida, bloqueada, rótulo, pantalla) conviene atarlos al tema
 * del host para que sigan light/dark. Los SEMÁNTICOS (libre, elegida,
 * accesible) conviene dejarlos fijos: tienen que significar lo mismo siempre.
 */
export interface TemaButacas {
  libre: string;
  vendida: string;
  bloqueada: string;
  elegida: string;
  /** Anillo de la butaca accesible. No reemplaza el estado, lo anota. */
  accesible: string;
  /** Tinta del número, una por fondo: tiene que contrastar contra CADA uno. */
  tintaLibre: string;
  tintaVendida: string;
  tintaBloqueada: string;
  tintaElegida: string;
  /** Letra de fila del gutter. */
  rotulo: string;
  /** Barra que representa la pantalla del cine. */
  pantalla: string;
}

export const TEMA_DEFAULT: TemaButacas = {
  libre: '#5BD6A0',
  vendida: '#E5E7EB',
  bloqueada: '#9CA3AF',
  elegida: '#8A2BAE',
  accesible: '#F9C000',
  tintaLibre: '#0B3B2A',
  tintaVendida: '#9CA3AF',
  tintaBloqueada: '#FFFFFF',
  tintaElegida: '#FFFFFF',
  rotulo: '#9CA3AF',
  pantalla: '#E5E7EB',
};
