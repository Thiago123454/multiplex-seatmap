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
 * RESPONSIVE: el gutter de las letras queda FIJO y solo scrollea la zona de
 * butacas, así en un celular no perdés la referencia de fila mientras paneás.
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
  PlanoSala,
  ReglasSeleccion,
  TemaButacas,
} from '../core';

const LABEL_W = 20;
/** Lado mínimo de la butaca cuando hay que TOCARLA. */
const MIN_TACTIL = 28;
/**
 * Techo del lado de la butaca en web. Más alto que el del núcleo (18) porque en
 * una pantalla grande una butaca de 18 px se ve diminuta y el mapa deja de
 * crecer mucho antes de llenar el contenedor.
 */
const MAX_WEB = 32;

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
   * Cómo se elige la escala. Default: `'ancho'` en solo vista (la sala entra
   * entera) y `'tactil'` cuando el mapa es interactivo (la butaca nunca baja del
   * mínimo tocable y, si no entra, se scrollea). Se puede forzar.
   */
  ajuste?: AjusteEscala;
  /** Lado mínimo de la butaca en modo táctil. Default 28. */
  minSeat?: number;
  /** Techo del lado de la butaca, para que no se agrande al pedo en desktop. */
  maxSeat?: number;
  /**
   * Número dentro de la butaca. `'auto'` (default) lo prende solo cuando la
   * butaca da el ancho: a la escala de sala entera el dígito no se lee y solo
   * ensucia el color, que es la señal que de verdad se usa.
   */
  mostrarNumeros?: boolean | 'auto';
  /** Paleta. Se mergea sobre `TEMA_DEFAULT`, así podés pisar solo lo que quieras. */
  tema?: Partial<TemaButacas>;
  /** Texto de la barra superior. `null` la esconde. */
  rotuloPantalla?: string | null;
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
  ajuste,
  minSeat = MIN_TACTIL,
  maxSeat = MAX_WEB,
  mostrarNumeros = 'auto',
  tema,
  rotuloPantalla = 'Pantalla',
  className,
  style,
  elegidas,
  onToggle,
  onRechazo,
  reglas,
}: PropsSeleccion) {
  const { ref, ancho } = useAnchoContenedor();
  const interactivo = !!onToggle;
  // Si vas a TOCAR las butacas, el default es el modo táctil.
  const modo: AjusteEscala = ajuste ?? (interactivo ? 'tactil' : 'ancho');

  const t = useMemo(() => ({ ...TEMA_DEFAULT, ...tema }), [tema]);

  const plano = useMemo(
    () => calcularPlano(filas, { width: ancho, ajuste: modo, labelWidth: LABEL_W, minSeat, maxSeat }),
    [filas, ancho, modo, minSeat, maxSeat],
  );

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

  const fondo = (b: { estado: EstadoButaca }, elegida: boolean) =>
    elegida
      ? t.elegida
      : b.estado === 'libre'
        ? t.libre
        : b.estado === 'vendida'
          ? t.vendida
          : t.bloqueada;

  const tinta = (b: { estado: EstadoButaca }, elegida: boolean) =>
    elegida
      ? t.tintaElegida
      : b.estado === 'libre'
        ? t.tintaLibre
        : b.estado === 'vendida'
          ? t.tintaVendida
          : t.tintaBloqueada;

  return (
    // El ref va SIEMPRE en el contenedor, no dentro del `if (!plano)`: si no,
    // en el primer render no hay a quién medir y el ancho se queda en 0.
    <div ref={ref} className={className} style={{ width: '100%', ...style }}>
      {rotuloPantalla !== null && (
        <>
          {/* La pantalla está del lado del Y más chico. */}
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

      {plano && (
        // Gutter fijo + zona de butacas scrolleable. Separarlos es lo que hace
        // que en un celular no pierdas la fila mientras paneás en horizontal.
        //
        // Cuando la sala NO llena el contenedor (pasa siempre que muerde el techo
        // de `maxSeat`), el bloque se CENTRA. Si no, queda pegado a la izquierda
        // con un hueco al lado y parece que el componente está roto.
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            ...(plano.desborda
              ? {}
              : { width: plano.ancho, marginLeft: 'auto', marginRight: 'auto' }),
          }}
        >
          <div
            style={{ position: 'relative', flex: '0 0 auto', width: plano.labelWidth, height: plano.alto }}
          >
            {plano.lineas.map((l) => (
              <div
                key={`f${l.top}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: l.top,
                  width: plano.labelWidth - 5,
                  height: plano.h,
                  lineHeight: `${plano.h}px`,
                  textAlign: 'right',
                  fontSize: plano.fuenteLetra,
                  fontVariantNumeric: 'tabular-nums',
                  color: t.rotulo,
                }}
              >
                {l.letra}
              </div>
            ))}
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowX: plano.desborda ? 'auto' : 'visible',
              overflowY: 'hidden',
              overscrollBehaviorX: 'contain',
            }}
          >
            <div
              style={{
                position: 'relative',
                height: plano.alto,
                width: plano.ancho - plano.labelWidth,
              }}
            >
              {plano.lineas.map((l) =>
                l.butacas.map((b) => {
                  const elegida = elegidasSet?.has(b.n) ?? false;
                  const estilo: CSSProperties = {
                    position: 'absolute',
                    // `left` viene con el gutter incluido; acá el gutter es otro nodo.
                    left: b.left - plano.labelWidth,
                    top: b.top,
                    width: plano.w,
                    height: plano.h,
                    borderRadius: plano.redondeo,
                    background: fondo(b, elegida),
                    border: b.accesible
                      ? `${Math.max(1, plano.h * 0.16)}px solid ${t.accesible}`
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
                    color: tinta(b, elegida),
                    overflow: 'hidden',
                  };

                  // La condición accesible viaja en el texto: el anillo dorado no
                  // se lee con un lector de pantalla.
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
                        // Sin esto, en mobile el navegador se come el primer tap
                        // esperando a ver si es doble-tap para zoom.
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
              )}
            </div>
          </div>
        </div>
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
