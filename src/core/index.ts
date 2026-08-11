/**
 * Núcleo del mapa de butacas. PURO: sin React, sin DOM, sin React Native.
 *
 * Se puede usar solo (para calcular un plano en el server, en un test o para
 * dibujar en canvas/SVG) sin arrastrar ningún renderer.
 */

export type {
  EstadoButaca,
  Butaca,
  FilaButacas,
  LineaSala,
  ButacaPlano,
  LineaPlano,
  PlanoSala,
  OpcionesPlano,
  AjusteEscala,
  Orientacion,
  TemaButacas,
} from './types';
export { TEMA_DEFAULT } from './types';

export {
  calcularPlano,
  agruparPorAltura,
  agruparEnLineas,
  resolverIdentidad,
  pasoEnX,
  mediana,
  TOL_LINEA,
} from './layout';

export { parseEtiqueta, formatearEtiqueta } from './etiqueta';
export type { Etiqueta } from './etiqueta';

export { puedeElegir, alternar, depurarSeleccion } from './selection';
export type { ReglasSeleccion, MotivoRechazo, ResultadoElegir } from './selection';
