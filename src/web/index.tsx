/**
 * Renderer WEB del mapa de butacas (React DOM).
 *
 * La geometría no vive acá: vive en `../core`. Este archivo solo pinta lo que el
 * motor ya resolvió a píxeles.
 *
 * DOS COMPONENTES, una sola implementación:
 *   · <SeatMapView>  → solo vista. No acepta selección ni handlers: no se puede
 *                      volver interactivo por accidente.
 *   · <SeatMap>      → el mismo dibujo + selección.
 *
 * ESTILOS INLINE, no clases de utilidad. El posicionamiento (relative en el
 * contenedor, absolute en butacas y letras) es parte de la CORRECCIÓN del
 * componente, no de su estética: si dependiera de que el host genere clases de
 * Tailwind, alcanzaría con montarlo en un proyecto cuyo Tailwind no escanee este
 * paquete para que las butacas pierdan su contenedor y se apilen contra el
 * viewport. Verificado — pasó de verdad.
 *
 * RESPONSIVE — tres piezas que se combinan:
 *   1. la sala SIEMPRE entra a lo ancho (`ajuste: 'ancho'`), así nunca se
 *      deforma la escala para que algo «entre»;
 *   2. la PANTALLA va arriba y las filas bajan — SIEMPRE. Girar la sala 90° para
 *      que entre en un celular existe (`orientacion: 'vertical'`) pero NO es el
 *      default: al girar, la fila A queda a la izquierda y deja de coincidir con
 *      la barra de pantalla, y eso desorienta más de lo que gana;
 *   3. el ZOOM lo maneja quien mira. Es un multiplicador de la escala, así que
 *      no puede romper el dibujo: agranda los dos ejes por igual.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { calcularPlano, puedeElegir, TEMA_DEFAULT } from '../core';
import type {
  AjusteEscala,
  Butaca,
  EstadoButaca,
  FilaButacas,
  MotivoRechazo,
  Orientacion,
  PlanoSala,
  ReglasSeleccion,
  TemaButacas,
} from '../core';

const LABEL_W = 20;
/** Techo del lado de la butaca a zoom 1. En web una de 18 px se ve diminuta. */
const MAX_WEB = 32;
/** Por debajo de esto, `orientacion: 'auto'` considera la pantalla «angosta». */
const UMBRAL_ANGOSTO = 560;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASO = 0.5;

/** Mide el contenedor. Es el equivalente web del `onLayout` de RN. */
function useAnchoContenedor() {
  const ref = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAncho(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ancho };
}

export interface PropsVista {
  filas: FilaButacas[];
  /**
   * Cómo se elige la escala. Default `'ancho'`: la sala entra completa y no se
   * deforma nada. `'tactil'` fuerza un lado mínimo y desborda — solo si sabés
   * que lo querés; para tocar con el dedo es preferible el zoom.
   */
  ajuste?: AjusteEscala;
  /**
   * Cómo se acuesta la sala. Default `'horizontal'`: la PANTALLA arriba y las
   * filas bajando, que es como se lee un mapa de butacas.
   *
   * `'vertical'` la gira 90° (cada fila una columna) para que una sala ancha
   * entre en un celular. Tiene un costo que hay que aceptar a conciencia: la
   * fila A pasa a estar a la IZQUIERDA, no arriba, así que deja de coincidir con
   * la barra de pantalla. En mobile suele ser mejor no girar nada y usar el
   * zoom, que no cambia la orientación de nada.
   */
  orientacion?: Orientacion;
  /** Controles de zoom. Default: visibles. */
  zoomControls?: boolean;
  /** Zoom inicial. Default 1 (la sala entera). */
  zoomInicial?: number;
  /** Lado mínimo de la butaca en `ajuste: 'tactil'`. */
  minSeat?: number;
  /** Techo del lado de la butaca a zoom 1. */
  maxSeat?: number;
  /**
   * Número dentro de la butaca. `'auto'` (default) lo prende solo cuando la
   * butaca da el ancho: a la escala de sala entera el dígito no se lee y solo
   * ensucia el color, que es la señal que de verdad se usa. Con zoom aparece solo.
   */
  mostrarNumeros?: boolean | 'auto';
  /** Paleta. Se mergea sobre `TEMA_DEFAULT`, así podés pisar solo lo que quieras. */
  tema?: Partial<TemaButacas>;
  /** Texto de la barra de pantalla. `null` la esconde. */
  rotuloPantalla?: string | null;
  /** Alto máximo del área scrolleable, en px. Default: sin límite. */
  maxAlto?: number;
  className?: string;
  style?: CSSProperties;
}

export interface PropsSeleccion extends PropsVista {
  /** Butacas elegidas, por `n`. */
  elegidas?: readonly string[];
  onToggle?: (butaca: Butaca) => void;
  /** Se llama cuando un click rebota, para que la UI pueda explicar por qué. */
  onRechazo?: (motivo: MotivoRechazo, butaca: Butaca) => void;
  reglas?: ReglasSeleccion;
}

function SeatMapBase({
  filas,
  ajuste = 'ancho',
  orientacion = 'horizontal',
  zoomControls = true,
  zoomInicial = 1,
  minSeat,
  maxSeat = MAX_WEB,
  mostrarNumeros = 'auto',
  tema,
  rotuloPantalla = 'Pantalla',
  maxAlto,
  className,
  style,
  elegidas,
  onToggle,
  onRechazo,
  reglas,
}: PropsSeleccion) {
  const { ref, ancho } = useAnchoContenedor();
  const [zoom, setZoom] = useState(zoomInicial);
  const interactivo = !!onToggle;

  const t = useMemo(() => ({ ...TEMA_DEFAULT, ...tema }), [tema]);

  const plano = useMemo(() => {
    const base = { ajuste, orientacion, labelWidth: LABEL_W, minSeat, maxSeat, zoom };
    return calcularPlano(filas, { ...base, width: ancho });
  }, [filas, ancho, ajuste, orientacion, minSeat, maxSeat, zoom]);

  // Índice para devolver la butaca de dominio en el callback: el plano solo
  // carga píxeles a propósito.
  const porId = useMemo(() => {
    const m = new Map<string, Butaca>();
    for (const f of filas) for (const b of f.butacas) m.set(b.n, b);
    return m;
  }, [filas]);

  const elegidasSet = useMemo(() => (elegidas ? new Set(elegidas) : null), [elegidas]);

  const handleClick = (n: string) => {
    const b = porId.get(n);
    if (!b || !onToggle) return;
    // Deseleccionar siempre se puede; solo se valida el alta.
    if (elegidasSet?.has(n)) return onToggle(b);
    const r = puedeElegir(b, elegidas ?? [], reglas);
    if (r.ok) onToggle(b);
    else if (r.motivo) onRechazo?.(r.motivo, b);
  };

  const conNumeros = mostrarNumeros === 'auto' ? !!plano?.numerosLegibles : !!mostrarNumeros;
  const vertical = plano?.orientacion === 'vertical';

  const fondo = (estado: EstadoButaca, elegida: boolean) =>
    elegida ? t.elegida : estado === 'libre' ? t.libre : estado === 'vendida' ? t.vendida : t.bloqueada;

  const tinta = (estado: EstadoButaca, elegida: boolean) =>
    elegida
      ? t.tintaElegida
      : estado === 'libre'
        ? t.tintaLibre
        : estado === 'vendida'
          ? t.tintaVendida
          : t.tintaBloqueada;

  const butacas =
    plano &&
    plano.lineas.flatMap((l) =>
      l.butacas.map((b) => {
        const elegida = elegidasSet?.has(b.n) ?? false;
        const estilo: CSSProperties = {
          position: 'absolute',
          left: b.left,
          top: b.top,
          width: plano.w,
          height: plano.h,
          borderRadius: plano.redondeo,
          background: fondo(b.estado, elegida),
          border: b.accesible
            ? `${Math.max(1, Math.min(plano.w, plano.h) * 0.16)}px solid ${t.accesible}`
            : 'none',
          boxSizing: 'border-box',
          padding: 0,
          margin: 0,
          // Centra el número sin romper el posicionamiento absoluto.
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: plano.fuenteNumero,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          color: tinta(b.estado, elegida),
          overflow: 'hidden',
        };

        // La condición accesible viaja en el texto: el anillo dorado no se lee
        // con un lector de pantalla.
        const etiqueta =
          `Fila ${b.fila}, butaca ${b.numero}` +
          (b.accesible ? ', accesible' : '') +
          `, ${elegida ? 'elegida' : b.estado}`;

        const contenido = conNumeros ? b.numero : null;

        if (!interactivo) {
          return (
            <div key={b.n} style={estilo} title={etiqueta} aria-label={etiqueta}>
              {contenido}
            </div>
          );
        }

        return (
          <button
            key={b.n}
            type="button"
            style={{
              ...estilo,
              cursor: b.estado === 'libre' ? 'pointer' : 'not-allowed',
              // Sin esto, en mobile el navegador se come el primer tap esperando
              // a ver si es doble-tap para zoom.
              touchAction: 'manipulation',
            }}
            onClick={() => handleClick(b.n)}
            aria-pressed={elegida}
            aria-label={etiqueta}
            title={etiqueta}
          >
            {contenido}
          </button>
        );
      }),
    );

  // El rótulo de fila: a la izquierda de su renglón en horizontal, arriba de su
  // columna en vertical.
  const rotulos =
    plano &&
    plano.lineas.map((l) => (
      <div
        key={`f${l.top}-${l.left}`}
        style={{
          position: 'absolute',
          ...(vertical
            ? {
                left: l.left,
                top: 0,
                width: plano.w,
                height: plano.labelWidth - 4,
                textAlign: 'center',
                lineHeight: `${plano.labelWidth - 4}px`,
              }
            : {
                left: 0,
                top: l.top,
                width: plano.labelWidth - 5,
                height: plano.h,
                textAlign: 'right',
                lineHeight: `${plano.h}px`,
              }),
          fontSize: plano.fuenteLetra,
          fontVariantNumeric: 'tabular-nums',
          color: t.rotulo,
        }}
      >
        {l.letra}
      </div>
    ));

  const caja = plano && (
    <div style={{ position: 'relative', width: plano.ancho, height: plano.alto }}>
      {rotulos}
      {butacas}
    </div>
  );

  // El área que scrollea. Con zoom > 1 el plano supera al contenedor en los dos
  // ejes; `touchAction: 'pan-x pan-y'` deja panear con el dedo sin que el
  // navegador se quede el gesto.
  const scroller = (
    <div
      style={{
        overflow: 'auto',
        overscrollBehavior: 'contain',
        touchAction: 'pan-x pan-y',
        maxHeight: maxAlto,
      }}
    >
      {/* Cuando la sala NO llena el contenedor (pasa siempre que muerde el techo
          de `maxSeat`), el bloque se CENTRA. Si no, queda pegado a la izquierda
          con un hueco al lado y parece que está roto. */}
      <div style={plano && plano.ancho < ancho ? { width: plano.ancho, margin: '0 auto' } : undefined}>
        {caja}
      </div>
    </div>
  );

  return (
    // El ref va SIEMPRE en el contenedor, no dentro del `if (!plano)`: si no, en
    // el primer render no hay a quién medir y el ancho se queda en 0.
    <div ref={ref} className={className} style={{ width: '100%', ...style }}>
      {zoomControls && (
        <Zoom valor={zoom} onCambio={setZoom} color={t.rotulo} borde={t.pantalla} />
      )}

      {/* La PANTALLA va SIEMPRE arriba, en las dos orientaciones: es la
          convención con la que todo el mundo lee un mapa de butacas y moverla
          de lugar al girar la sala desorienta más de lo que informa.
          (Ojo: con la sala girada, el lado que mira a la pantalla es el
          IZQUIERDO — la fila A queda a la izquierda. La barra de arriba es
          rótulo de lectura, no la posición física.) */}
      {rotuloPantalla !== null && (
        <>
          <div style={{ height: 6, borderRadius: 999, margin: '0 8px 10px', background: t.pantalla }} />
          <div
            style={{
              textAlign: 'center',
              marginBottom: 16,
              textTransform: 'uppercase',
              fontSize: 9,
              letterSpacing: 2,
              color: t.rotulo,
            }}
          >
            {rotuloPantalla}
          </div>
        </>
      )}

      {plano && scroller}
    </div>
  );
}

function Zoom({
  valor,
  onCambio,
  color,
  borde,
}: {
  valor: number;
  onCambio: (v: number) => void;
  color: string;
  borde: string;
}) {
  const clamp = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(v.toFixed(2))));
  const btn: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: `1px solid ${borde}`,
    background: 'transparent',
    color,
    fontSize: 15,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    touchAction: 'manipulation',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <button
        type="button"
        style={{ ...btn, opacity: valor <= ZOOM_MIN ? 0.4 : 1 }}
        onClick={() => onCambio(clamp(valor - ZOOM_PASO))}
        disabled={valor <= ZOOM_MIN}
        aria-label="Alejar"
      >
        −
      </button>
      <button
        type="button"
        style={{ ...btn, opacity: valor >= ZOOM_MAX ? 0.4 : 1 }}
        onClick={() => onCambio(clamp(valor + ZOOM_PASO))}
        disabled={valor >= ZOOM_MAX}
        aria-label="Acercar"
      >
        +
      </button>
      <span style={{ fontSize: 11, color, minWidth: 34, fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(valor * 100)}%
      </span>
      {valor !== 1 && (
        <button
          type="button"
          style={{ ...btn, width: 'auto', padding: '0 8px', fontSize: 11 }}
          onClick={() => onCambio(1)}
        >
          Ver toda
        </button>
      )}
    </div>
  );
}

/**
 * Mapa de butacas **solo vista**. No acepta selección ni handlers — no se puede
 * volver interactivo sin cambiar de componente, que es justamente la garantía
 * que se quiere para reportes, pantallas y el mapa de un acomodador.
 */
export function SeatMapView(props: PropsVista) {
  return <SeatMapBase {...props} />;
}

/** Mapa de butacas con selección. Para elegir al vender. */
export function SeatMap(props: PropsSeleccion) {
  return <SeatMapBase {...props} />;
}

export function SeatMapLeyenda({
  bloqueadas = 0,
  conSeleccion,
  tema,
}: {
  bloqueadas?: number;
  conSeleccion?: boolean;
  tema?: Partial<TemaButacas>;
}) {
  const t = { ...TEMA_DEFAULT, ...tema };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 16 }}>
      <Item color={t.libre} label="Libre" />
      {conSeleccion && <Item color={t.elegida} label="Elegida" />}
      <Item color={t.vendida} label="Vendida" />
      {/* La bloqueada solo se explica si existe: si no hay ninguna, es ruido. */}
      {bloqueadas > 0 && <Item color={t.bloqueada} label="Bloqueada" />}
      <Item color="transparent" label="Accesible" ring={t.accesible} />
    </div>
  );
}

function Item({ color, label, ring }: { color: string; label: string; ring?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 11,
          height: 11,
          borderRadius: 3,
          background: color,
          border: ring ? `2px solid ${ring}` : undefined,
          boxSizing: 'border-box',
        }}
      />
      <span style={{ fontSize: 11.5, opacity: 0.8 }}>{label}</span>
    </div>
  );
}

export type { PlanoSala };
export { UMBRAL_ANGOSTO };
