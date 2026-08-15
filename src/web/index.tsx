/**
 * Renderer WEB del mapa de butacas (React DOM).
 *
 * La geometría no vive acá: vive en `../core`. Este archivo es la CAPA DE VISTA.
 *
 * DOS COMPONENTES, una sola implementación:
 *   · <SeatMapView>  → solo vista. No acepta selección ni handlers: no se puede
 *                      volver interactivo por accidente.
 *   · <SeatMap>      → el mismo dibujo + selección.
 *
 * ── Las decisiones de esta capa ───────────────────────────────────────────
 *
 * 1. 🔑 **EL ZOOM ES UN `transform`, NO UN RECÁLCULO.** El plano se calcula UNA
 *    vez por tamaño de contenedor (con `zoom: 1`) y el zoom es `scale()` sobre
 *    un solo nodo. Es exactamente lo mismo que el multiplicador de escala del
 *    core —los dos ejes por el mismo factor, así que la proporción de la sala no
 *    se toca— pero lo compone la GPU: un pinch sobre 292 butacas no reconcilia
 *    292 nodos de React por frame. `OpcionesPlano.zoom` del core sigue estando
 *    para quien quiera render sin transform (server, canvas, PDF).
 *
 * 2. **100 % = la sala entera.** El piso del zoom es el encuadre que muestra
 *    toda la sala y el techo es la escala a la que la butaca llega a 46 px, que
 *    es el tamaño con el que un dedo no falla. Un rango fijo 1-4 sobraba en una
 *    sala chica y no alcanzaba en una de 292.
 *
 * 3. **La PANTALLA vive FUERA del área que se transforma.** Es la referencia
 *    física de la sala: se acercan y panean las butacas, la pantalla se queda
 *    quieta, a todo el ancho y arriba de todo.
 *
 * 4. **Tap sobre butaca chica = acercar, no elegir.** Por debajo de 22 px, tocar
 *    acerca esa zona hasta 38 px. Elegir a 8 px no es elegir, es adivinar — y el
 *    rebote se paga en la caja.
 *
 * 5. **El zoom es de mobile.** Debajo de 768 px aparecen los controles y los
 *    gestos. En desktop la sala entra entera a una escala en la que la butaca ya
 *    se clickea con el mouse.
 *
 * 6. **Un solo tab stop.** Los 292 botones dejaron de ser 292 paradas de
 *    tabulación: se entra una vez y adentro se navega con flechas (roving
 *    tabindex), Enter/Espacio para elegir.
 *
 * ESTILOS INLINE, no clases de utilidad. El posicionamiento (relative en el
 * contenedor, absolute en las butacas) es parte de la CORRECCIÓN del componente:
 * si dependiera de que el host genere clases de Tailwind, alcanzaría con montarlo
 * en un proyecto cuyo Tailwind no escanee este paquete para que las butacas
 * pierdan su contenedor y se apilen contra el viewport. Verificado — pasó.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import {
  calcularPlano,
  puedeElegir,
  dejaButacaSuelta,
  contarHuecos,
  TEMA_DEFAULT,
  fotoPinch,
  limitarZoom,
  pasoPinch,
  separacion,
} from '../core';
import type {
  Butaca,
  ButacaPlano,
  EstadoButaca,
  FilaButacas,
  FotoPinch,
  MotivoRechazo,
  PlanoSala,
  ReglasSeleccion,
  TemaButacas,
} from '../core';

/** Techo del lado de la butaca en el plano base (antes del zoom). */
const MAX_SEAT = 32;
/** Por debajo de este lado en px, un tap ACERCA en vez de elegir. */
const TAP_MIN = 22;
/** A cuánto lleva la butaca ese tap de acercamiento. */
const TAP_OBJ = 38;
/** Lado con el que un dedo no falla. Define el techo del zoom. */
const DEDO = 46;
/** Debajo de esto hay gestos y controles de zoom. */
const MOVIL = 768;
/** Cuánto puede pasarse «ver toda la sala» de la escala base cuando sobra lugar. */
const HOLGURA_FIT = 1.35;

/* ── geometría derivada ──────────────────────────────────────────────────── */

interface Geo {
  plano: PlanoSala;
  /** Escala a la que la sala entra entera. Es el 100 % de la UI. */
  zFit: number;
  zMax: number;
  /** Lado menor de la butaca en el plano base. */
  lado: number;
  /** Butacas por línea, ordenadas de izquierda a derecha (navegación). */
  orden: ButacaPlano[][];
  /** Centro visual de la sala. */
  ejeX: number;
}

function derivar(plano: PlanoSala, vw: number, vh: number): Geo {
  const lado = Math.min(plano.w, plano.h);

  // «Ver toda la sala». Se permite pasar un poco de la escala base (que ya topa
  // en maxSeat) cuando sobra lugar: en un desktop ancho la sala quedaba flotando
  // en el medio con la mitad del alto vacío. El tope mantiene el espíritu del
  // techo del core —que la butaca no crezca al pedo— y sigue siendo un factor
  // único para los dos ejes.
  const zFit = Math.min(HOLGURA_FIT, vw / plano.ancho, vh / plano.alto);
  const zMax = Math.max(zFit * 1.8, DEDO / lado);

  const orden = plano.lineas.map((l) => [...l.butacas].sort((a, b) => a.left - b.left));

  // 🔑 Eje visual de la sala: el centro de la fila MÁS LARGA, no el de la caja.
  // El anexo accesible cuelga un par de butacas bien a la derecha, y centrar por
  // la caja corre todo el cuerpo de la sala hacia la izquierda.
  let larga = plano.lineas[0];
  for (const l of plano.lineas) if (l.butacas.length > larga.butacas.length) larga = l;
  const lx = larga.butacas.map((b) => b.left);
  const ejeX = (Math.min(...lx) + Math.max(...lx) + plano.w) / 2;

  return { plano, zFit, zMax, lado, orden, ejeX };
}

/* ── props ───────────────────────────────────────────────────────────────── */

export interface PropsVista {
  filas: FilaButacas[];
  /** Paleta. Se mergea sobre `TEMA_DEFAULT`; para el flujo de venta, `TEMA_OSCURO`. */
  tema?: Partial<TemaButacas>;
  /** Texto del rótulo de la pantalla. `null` esconde la pantalla entera. */
  rotuloPantalla?: string | null;
  /**
   * Renglón de letras de fila a la izquierda. Apagado por defecto: la butaca ya
   * lleva su fila en el código (`F12`), así que un gutter repite el dato y roba
   * ancho — que en un celular es justo lo que falta.
   */
  mostrarRotulos?: boolean;
  /** Leyenda de colores debajo del mapa. */
  leyenda?: boolean;
  /** Controles de zoom. Por defecto solo en mobile, que es donde el zoom existe. */
  zoomControls?: boolean;
  /** Techo del lado de la butaca en el plano base. */
  maxSeat?: number;
  className?: string;
  style?: CSSProperties;
}

export interface PropsSeleccion extends PropsVista {
  /** Butacas elegidas, por `n`. Si no la pasás, el mapa se maneja solo. */
  elegidas?: readonly string[];
  /** Recibe la butaca tocada y la lista ya resuelta. */
  onToggle?: (butaca: Butaca, lista: string[]) => void;
  /** Se llama cuando un click rebota, para que la UI pueda explicar por qué. */
  onRechazo?: (motivo: MotivoRechazo, butaca: Butaca) => void;
  reglas?: ReglasSeleccion;
  /**
   * Rechazar la elección que deja una butaca suelta. Prendido por defecto: un
   * hueco de uno no lo compra nadie.
   */
  sinHuecos?: boolean;
}

const COPY: Record<MotivoRechazo, string> = {
  vendida: 'Esa butaca ya está vendida',
  bloqueada: 'Esa butaca está bloqueada',
  limite: 'Llegaste al máximo de butacas',
  hueco: 'Así queda una butaca suelta al lado',
};

/* ── componente ──────────────────────────────────────────────────────────── */

function SeatMapBase({
  filas,
  tema,
  rotuloPantalla = 'Pantalla',
  mostrarRotulos = false,
  leyenda = false,
  zoomControls,
  maxSeat = MAX_SEAT,
  className,
  style,
  elegidas,
  onToggle,
  onRechazo,
  reglas,
  sinHuecos = true,
}: PropsSeleccion) {
  const raizEl = useRef<HTMLDivElement | null>(null);
  const vistaEl = useRef<HTMLDivElement | null>(null);
  const planoEl = useRef<HTMLDivElement | null>(null);
  const pctEl = useRef<HTMLDivElement | null>(null);

  const [raizAncho, setRaizAncho] = useState(0);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  // Qué entra dentro de la butaca. Se decide al ASENTAR el gesto, no por frame.
  const [texto, setTexto] = useState({ nums: false, codigos: false });
  const [foco, setFoco] = useState<string | null>(null);
  // El nonce existe para la live region: `setAviso` con el MISMO string hace
  // bailout y el lector de pantalla no vuelve a anunciar el segundo rechazo.
  const [aviso, setAviso] = useState({ txt: '', n: 0 });
  const [propias, setPropias] = useState<string[]>([]);

  const t = useMemo(() => ({ ...TEMA_DEFAULT, ...tema }), [tema]);
  // Interactivo = hay handler (controlado) o no hay lista (se maneja solo).
  // `<SeatMapView>` pasa `elegidas={[]}` sin handler ⇒ cae en `false`.
  const esInteractivo = !!onToggle || elegidas === undefined;
  const movil = raizAncho > 0 && raizAncho < MOVIL;
  const conZoom = zoomControls ?? movil;

  const sel = elegidas ?? propias;
  const selRef = useRef(sel);
  selRef.current = sel;

  const labelWidth = mostrarRotulos ? 20 : 0;

  const plano = useMemo(
    () =>
      calcularPlano(filas, {
        width: vp.w,
        ajuste: 'ancho',
        orientacion: 'horizontal',
        labelWidth,
        maxSeat,
      }),
    [filas, vp.w, labelWidth, maxSeat],
  );

  const geo = useMemo(
    () => (plano && vp.w > 0 && vp.h > 0 ? derivar(plano, vp.w, vp.h) : null),
    [plano, vp.w, vp.h],
  );

  const porId = useMemo(() => {
    const m = new Map<string, Butaca>();
    for (const f of filas) for (const b of f.butacas) m.set(b.n, b);
    return m;
  }, [filas]);

  /* ── estado de la vista (mutable: no dispara render) ───────────────────── */

  const v = useRef({ x: 0, y: 0, z: 1 });
  const geoRef = useRef<Geo | null>(null);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const movilRef = useRef(movil);
  movilRef.current = movil;
  // El camino de gestos vive dentro de un efecto que NO tiene `esInteractivo` en
  // sus deps (se re-suscribiría en cada cambio de selección). Va por ref, igual
  // que en el renderer nativo.
  const interactivoRef = useRef(esInteractivo);
  interactivoRef.current = esInteractivo;

  const encajar = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    const { w: vw, h: vh } = vpRef.current;
    const W = g.plano.ancho * v.current.z;
    const H = g.plano.alto * v.current.z;
    v.current.x =
      W <= vw
        ? Math.max(0, Math.min(vw - W, vw / 2 - g.ejeX * v.current.z))
        : Math.min(0, Math.max(vw - W, v.current.x));
    // En desktop la sala arranca pegada a la pantalla del cine; en mobile se
    // centra en el alto libre, que es lo que la deja a la altura del pulgar.
    v.current.y =
      H <= vh ? (movilRef.current ? (vh - H) / 2 : 0) : Math.min(0, Math.max(vh - H, v.current.y));
  }, []);

  const aplicar = useCallback(() => {
    const g = geoRef.current;
    if (!g || !planoEl.current) return;
    const { x, y, z } = v.current;
    planoEl.current.style.transform = `translate3d(${x}px,${y}px,0) scale(${z})`;
    if (pctEl.current) pctEl.current.textContent = `${Math.round((z / g.zFit) * 100)}%`;
  }, []);

  /**
   * `will-change: transform` promueve el plano a capa propia — y la capa mide lo
   * que mide el plano ENTERO, con sus 293 butacas. Tenerlo puesto siempre es
   * memoria de GPU tirada (y varios mapas en la misma página la agotan). Se
   * prende al empezar el gesto y se apaga al soltar, que es para lo que sirve.
   */
  const moviendo = useCallback((si: boolean) => {
    if (planoEl.current) planoEl.current.style.willChange = si ? 'transform' : 'auto';
  }, []);

  const tAsentar = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Al soltar el gesto se decide qué texto entra en la butaca. Debounced: es lo único que re-renderiza. */
  const asentar = useCallback(() => {
    clearTimeout(tAsentar.current);
    tAsentar.current = setTimeout(() => {
      const g = geoRef.current;
      if (!g) return;
      const w = g.plano.w * v.current.z;
      const h = g.plano.h * v.current.z;
      setTexto((prev) => {
        const nums = h >= 9 && w >= 11;
        const codigos = h >= 10 && w >= 17;
        return prev.nums === nums && prev.codigos === codigos ? prev : { nums, codigos };
      });
    }, 130);
  }, []);

  const limZ = useCallback((z: number) => {
    const g = geoRef.current;
    if (!g) return z;
    return limitarZoom(z, g);
  }, []);

  /** Zoom anclado en un punto del visor: ese punto no se mueve. */
  const zoomEn = useCallback(
    (px: number, py: number, z2: number) => {
      const z = limZ(z2);
      const k = z / v.current.z;
      v.current.x = px - (px - v.current.x) * k;
      v.current.y = py - (py - v.current.y) * k;
      v.current.z = z;
      encajar();
      aplicar();
      asentar();
    },
    [limZ, encajar, aplicar, asentar],
  );

  // Cuando cambia la geometría (sala nueva o contenedor redimensionado) el
  // encuadre se rehace: `useLayoutEffect` para que el transform esté puesto
  // antes de que el browser pinte, si no se ve saltar la sala.
  // 🔴 El reset se gatea por la FIRMA de la geometría, NO por la identidad de
  // `geo`. `plano` depende de la identidad de `filas`, y el host arma ese array
  // de nuevo en cada refresh de butacas vendidas (polling / realtime): resetear
  // por identidad le tiraba el zoom y el paneo al que estaba comprando, en medio
  // de la compra, cada vez que llegaba un refresco.
  const firma = geo
    ? `${vp.w}x${vp.h}|${geo.plano.ancho}x${geo.plano.alto}|${geo.plano.w}|${geo.zFit}`
    : '';
  const firmaRef = useRef<string | null>(null);
  const rebasarGesto = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    geoRef.current = geo;
    if (!geo) return;
    if (firmaRef.current !== firma) {
      firmaRef.current = firma;
      v.current = { x: 0, y: 0, z: geo.zFit };
    }
    encajar();
    aplicar();
    // Si el contenedor cambió de tamaño con el dedo apoyado, las fotos del gesto
    // quedaron tomadas contra el rect viejo: hay que rebasarlas o el próximo
    // frame pega un salto.
    rebasarGesto.current?.();
    asentar();
  }, [geo, firma, encajar, aplicar, asentar]);

  /* ── medición ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    const el = raizEl.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRaizAncho(Math.round(e.contentRect.width)));
    ro.observe(el);
    setRaizAncho(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = vistaEl.current;
    if (!el) return;
    const leer = () => {
      const r = el.getBoundingClientRect();
      setVp((p) => {
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        return p.w === w && p.h === h ? p : { w, h };
      });
    };
    const ro = new ResizeObserver(leer);
    ro.observe(el);
    leer();
    return () => ro.disconnect();
  }, []);

  /* ── selección ─────────────────────────────────────────────────────────── */

  const tAviso = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const emitir = useCallback(
    (b: Butaca, lista: string[]) => {
      setAviso((p) => (p.txt ? { txt: '', n: p.n } : p));
      if (onToggle) onToggle(b, lista);
      if (!elegidas) setPropias(lista);
    },
    [onToggle, elegidas],
  );

  const alternarN = useCallback(
    (n: string) => {
      // Decisión 8: `<SeatMapView>` no elige NI avisa. Sin este guard, un click
      // sobre una butaca vendida en modo vista mostraba la píldora de rechazo.
      if (!esInteractivo) return;
      const b = porId.get(n);
      const g = geoRef.current;
      if (!b) return;
      setFoco(n);
      const actual = selRef.current;

      if (actual.includes(n)) {
        // Sacar una butaca también puede dejar un hueco de uno. Acá se AVISA
        // pero no se bloquea: impedir el deselect deja al comprador atrapado en
        // una selección que no quiere, que es peor que el hueco.
        const resto = actual.filter((k) => k !== n);
        emitir(b, resto); // primero: `emitir` limpia el aviso
        if (
          sinHuecos &&
          g &&
          contarHuecos(g.plano.lineas, resto, g.plano.w) >
            contarHuecos(g.plano.lineas, actual, g.plano.w)
        ) {
          setAviso((prev) => ({ txt: COPY.hueco, n: prev.n + 1 }));
          clearTimeout(tAviso.current);
          tAviso.current = setTimeout(
            () => setAviso((prev) => (prev.txt ? { txt: '', n: prev.n } : prev)),
            3200,
          );
        }
        return;
      }

      const r = puedeElegir(b, actual, reglas);
      let motivo = r.motivo;
      let ok = r.ok;
      if (ok && sinHuecos && g) {
        // No dejes una butaca suelta. Se compara ANTES contra DESPUÉS: la sala ya
        // viene con huecos de otras ventas y rechazar por el total dejaría al que
        // vende sin poder elegir nada.
        if (dejaButacaSuelta(g.plano.lineas, actual, n, g.plano.w)) {
          ok = false;
          motivo = 'hueco';
        }
      }
      if (ok) return emitir(b, [...actual, n]);

      if (motivo) {
        if (onRechazo) onRechazo(motivo, b);
        setAviso((p) => ({ txt: COPY[motivo], n: p.n + 1 }));
        clearTimeout(tAviso.current);
        tAviso.current = setTimeout(() => setAviso((p) => (p.txt ? { txt: '', n: p.n } : p)), 3200);
      }
    },
    [esInteractivo, porId, reglas, sinHuecos, emitir, onRechazo],
  );

  const alternarRef = useRef(alternarN);
  alternarRef.current = alternarN;

  /* ── gestos ────────────────────────────────────────────────────────────── */

  /**
   * El camino de gestos AVISA que ya resolvió el toque.
   *
   * Antes esto se infería de `matchMedia('(pointer: coarse)')` y rompía en los
   * dos extremos:
   *   · pantalla táctil de >=768 px (monitor de boletería, iPad landscape): el
   *     camino de gestos está apagado por ANCHO y el de click por TIPO DE
   *     PUNTERO, así que no quedaba NINGUNA forma de elegir;
   *   · mouse en un contenedor angosto (<768 px): resolvían los DOS, así que la
   *     butaca se elegía y se des-elegía en el mismo click.
   * Dos compuertas distintas para una sola decisión. Ahora hay un solo flag, y
   * lo pone quien realmente consumió el evento.
   */
  const gestoResolvio = useRef(false);

  useEffect(() => {
    const el = vistaEl.current;
    if (!el) return;

    const ptrs = new Map<number, { x: number; y: number }>();
    type Arrastre = {
      x: number;
      y: number;
      mov: number;
      vx: number;
      vy: number;
      dest: HTMLElement | null;
    };
    let arr: Arrastre | null = null;
    let pin: FotoPinch | null = null;
    /** ts del último tap que ACERCÓ: el doble tap no puede deshacerlo. */
    let acerco = 0;

    const local = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };

    /**
     * Foto del pinch con el par de punteros ACTUAL y el encuadre actual.
     *
     * 🔑 Guarda la separación CRUDA. El piso contra las yemas pegadas no vive acá
     * sino en `pasoPinch`, sobre la ganancia — justamente para que esta foto y la
     * del rebase del clamp no tengan que ponerse de acuerdo. Esta se toma en TODO
     * cambio de la cantidad de dedos (el segundo puntero que baja, tres dedos y
     * se levanta uno, el visor que se redimensiona con los dedos apoyados), y
     * cualquier regla que viviera acá habría que repetirla allá.
     */
    const rebasePin = () => {
      const [a, b] = [...ptrs.values()];
      if (!a || !b) return;
      const c = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      pin = fotoPinch(separacion(a.x, a.y, b.x, b.y), c.x, c.y, v.current);
    };

    /**
     * El destino viene del POINTERDOWN, no del `e.target` del pointerup.
     *
     * `setPointerCapture` retargetea todos los eventos de ese pointerId al
     * elemento capturador (el visor), así que en el pointerup `e.target` ya no
     * es la butaca y `closest('[data-n]')` daba null SIEMPRE: en táctil no se
     * podía elegir NINGUNA butaca una vez pasado el umbral de 22 px.
     */
    const tap = (e: PointerEvent, destino: HTMLElement | null) => {
      const g = geoRef.current;
      if (!g) return;
      // Un tap en el vacío (pasillo, margen, control) no hace nada. Sin esto,
      // tocar el botón «+» caía en la rama de acercar con las coordenadas del
      // botón y pegaba un salto de encuadre.
      if (!destino?.dataset.n) return;
      gestoResolvio.current = true;
      const p = local(e.clientX, e.clientY);
      // Elegir a 8 px no es elegir, es adivinar: primero se acerca.
      if (g.lado * v.current.z < TAP_MIN) {
        acerco = Date.now();
        return zoomEn(p.x, p.y, TAP_OBJ / g.lado);
      }
      alternarRef.current(destino.dataset.n);
    };

    rebasarGesto.current = () => {
      if (pin && ptrs.size >= 2) rebasePin();
      else if (arr && ptrs.size === 1) {
        const [q] = [...ptrs.values()];
        if (q) arr = { ...arr, x: q.x, y: q.y, vx: v.current.x, vy: v.current.y };
      }
    };

    const onDown = (e: PointerEvent) => {
      // Se limpia SIEMPRE, antes del guard de `movil`: si el camino de gestos no
      // corre, el click que viene después tiene que poder elegir.
      gestoResolvio.current = false;
      if (!movilRef.current) return;
      // Los controles de zoom viven dentro del visor pero NO son el visor: el
      // gesto que nace ahí no es un paneo ni un tap sobre la sala.
      if ((e.target as HTMLElement | null)?.closest?.('[data-ctrl]')) return;

      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* el navegador puede negarlo; el gesto sigue andando igual */
      }
      // Se prende ACÁ, que es «empezar el gesto», y `onUp` lo apaga cuando se va
      // el último puntero. Faltaba la mitad de arriba: `moviendo(false)` era la
      // única llamada que existía, así que la capa nunca se promovía y el
      // comentario de la definición describía algo que no pasaba.
      moviendo(true);
      if (ptrs.size === 1) {
        arr = {
          x: e.clientX,
          y: e.clientY,
          mov: 0,
          vx: v.current.x,
          vy: v.current.y,
          dest: (e.target as HTMLElement | null)?.closest?.('[data-n]') as HTMLElement | null,
        };
        el.style.cursor = 'grabbing';
      } else if (ptrs.size === 2) {
        rebasePin();
        arr = null;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = geoRef.current;
      if (ptrs.size >= 2 && pin && g) {
        const [a, b] = [...ptrs.values()];
        const d = separacion(a.x, a.y, b.x, b.y);
        const c = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        const paso = pasoPinch(pin, d, c.x, c.y, g);
        v.current.x = paso.x;
        v.current.y = paso.y;
        v.current.z = paso.z;
        encajar();
        aplicar();
        // 🔴 El clamp mordió: `z` no es lo que pidieron los dedos. Si la foto NO se
        // rehace acá, el gesto guarda zoom que nunca se aplicó, y volver a abrir los
        // dedos lo devuelve ENTERO: con los dedos en la separación original el
        // encuadre volvía EXACTO al del arranque, después de una zona muerta en la
        // que apretar no hacía nada. Se rehace contra el encuadre YA clampeado —por
        // eso va después de `encajar`—, así el pinch responde desde el tope apenas
        // invertís el gesto. Vale igual para `zMax`: la zona muerta era simétrica.
        //
        // Foto INLINE y no `rebasePin()`: esa relee los punteros y llama a `local()`,
        // que hace `getBoundingClientRect()` — un reflow síncrono por frame de pinch.
        // `d` y `c` ya están calculados arriba y son los mismos valores.
        if (paso.mordio) pin = fotoPinch(d, c.x, c.y, v.current);
      } else if (arr) {
        const dx = e.clientX - arr.x;
        const dy = e.clientY - arr.y;
        arr.mov = Math.max(arr.mov, Math.hypot(dx, dy));
        v.current.x = arr.vx + dx;
        v.current.y = arr.vy + dy;
        encajar();
        aplicar();
      }
    };

    const onUp = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      // Cambió el PAR de punteros en uso (tres dedos, se levanta uno): sin
      // rebasear, `d` se compara contra la distancia del par viejo y el zoom
      // pega un salto proporcional.
      if (ptrs.size < 2) pin = null;
      else rebasePin();

      if (ptrs.size > 0) {
        // Al bajar de dos dedos a uno hay que re-basar el paneo con el que
        // queda: si no, ninguna rama de onMove matchea y la sala queda
        // congelada bajo el dedo hasta soltar y volver a apoyar.
        const [q] = [...ptrs.values()];
        // `mov` arranca pasado del umbral: veníamos de un pinch, no es un tap.
        if (q) arr = { x: q.x, y: q.y, mov: 99, vx: v.current.x, vy: v.current.y, dest: null };
        return;
      }

      moviendo(false);
      // Condicionado: el visor se renderiza con `cursor: default` en desktop y
      // React no vuelve a escribirlo (la prop no cambia), así que un 'grab'
      // imperativo quedaba pegado hasta el unmount.
      el.style.cursor = movilRef.current ? 'grab' : 'default';
      const a = arr;
      arr = null;
      // Quieto es tap, dure lo que dure: lo que separa el paneo del tap es la
      // DISTANCIA (`mov` es el máximo histórico), no el reloj. Un dedo que duda
      // medio segundo sobre la butaca sigue siendo un tap deliberado.
      if (a && a.mov < 6 && e.type !== 'pointercancel') tap(e, a.dest);
      asentar();
    };

    const onDbl = (e: MouseEvent) => {
      const g = geoRef.current;
      if (!g || !movilRef.current) return;
      // 🔴 El doble tap SOLO existe en modo vista — misma regla que el nativo.
      // Donde se elige, cada toque ya alterna una butaca: los dos clicks del
      // doble la eligen y la desecogen (net cero, y el `onToggle` sale dos veces),
      // y encima el `dblclick` movía el encuadre. Elegir dos veces seguidas no
      // puede significar «zoom».
      if (interactivoRef.current) return;
      // El 1.er tap del doble tap ya acercó (butaca chica). Mirar el z
      // resultante haría que el dbl lo lea como «ya está acercado» y vuelva al
      // fit: acercar terminaría alejando.
      if (Date.now() - acerco < 700) return;
      const p = local(e.clientX, e.clientY);
      zoomEn(p.x, p.y, v.current.z > g.zFit * 1.04 ? g.zFit : limZ(DEDO / g.lado));
    };

    const onWheel = (e: WheelEvent) => {
      const g = geoRef.current;
      if (!g || !movilRef.current) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const p = local(e.clientX, e.clientY);
        zoomEn(p.x, p.y, v.current.z * Math.exp(-e.deltaY * 0.0028));
      } else {
        v.current.x -= e.deltaX;
        v.current.y -= e.deltaY;
        encajar();
        aplicar();
        asentar();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);
    return () => {
      rebasarGesto.current = null;
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
    };
  }, [limZ, encajar, aplicar, asentar, zoomEn, moviendo]);

  /**
   * Click de MOUSE. En desktop no hay gestos, así que va directo.
   *
   * 🔴 Acá NO va el umbral de `TAP_MIN`. Ese umbral existe porque un DEDO sobre
   * una butaca de 8 px no elige, adivina — pero un cursor acierta a 19 px sin
   * problema, y en desktop no hay control de zoom con el que agrandar.
   * Aplicárselo al mouse deja la sala entera incliqueable en cuanto la butaca
   * baja de 22 px, que es lo normal en una sala de 293. El guard vive en `tap()`,
   * que es el camino táctil.
   */
  const onClickPlano = (e: ReactMouseEvent) => {
    if (e.detail === 0) return; // vino del teclado; lo maneja onKeyDown
    const destino = (e.target as HTMLElement).closest('[data-n]') as HTMLElement | null;
    if (!destino?.dataset.n) return;
    if (gestoResolvio.current) return; // el tap ya resolvió; esto es el click de compatibilidad
    alternarRef.current(destino.dataset.n);
  };

  /* ── teclado ───────────────────────────────────────────────────────────── */

  const pendienteFoco = useRef(false);
  useEffect(() => {
    if (!pendienteFoco.current || !foco) return;
    pendienteFoco.current = false;
    const el = planoEl.current?.querySelector<HTMLElement>(`[data-n="${CSS.escape(foco)}"]`);
    el?.focus({ preventScroll: true });
  }, [foco]);

  const aVista = useCallback(
    (b: ButacaPlano) => {
      const g = geoRef.current;
      if (!g) return;
      const { w: vw, h: vh } = vpRef.current;
      const z = v.current.z;
      const m = 24;
      const l = b.left * z + v.current.x;
      const tt = b.top * z + v.current.y;
      const w = g.plano.w * z;
      const h = g.plano.h * z;
      if (l < m) v.current.x += m - l;
      else if (l + w > vw - m) v.current.x -= l + w - (vw - m);
      if (tt < m) v.current.y += m - tt;
      else if (tt + h > vh - m) v.current.y -= tt + h - (vh - m);
      encajar();
      aplicar();
    },
    [encajar, aplicar],
  );

  const verToda = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    v.current.z = g.zFit;
    encajar();
    aplicar();
    asentar();
  }, [encajar, aplicar, asentar]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const g = geoRef.current;
    if (!g) return;
    const { w: vw, h: vh } = vpRef.current;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      return zoomEn(vw / 2, vh / 2, v.current.z * 1.4);
    }
    if (e.key === '-') {
      e.preventDefault();
      return zoomEn(vw / 2, vh / 2, v.current.z / 1.4);
    }
    if (e.key === '0') {
      e.preventDefault();
      return verToda();
    }
    // Los controles de zoom viven DENTRO del visor: Enter/Espacio sobre ellos
    // son suyos. Sin este guard, el preventDefault de abajo les comía el click
    // (para un <button>, Enter ES el click) y encima alternaba la butaca 0.
    const enPlano = (e.target as HTMLElement | null)?.closest?.('[data-n]');
    if (e.target !== e.currentTarget && !enPlano) return;

    if (!e.key.startsWith('Arrow') && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();

    const orden = g.orden;
    let li = 0;
    let bi = 0;
    if (foco) {
      for (let i = 0; i < orden.length; i++) {
        const j = orden[i].findIndex((b) => b.n === foco);
        if (j >= 0) {
          li = i;
          bi = j;
          break;
        }
      }
    }

    if (e.key === 'Enter' || e.key === ' ') return alternarRef.current(orden[li][bi].n);

    let obj = orden[li][bi];
    if (e.key === 'ArrowLeft') obj = orden[li][Math.max(0, bi - 1)];
    else if (e.key === 'ArrowRight') obj = orden[li][Math.min(orden[li].length - 1, bi + 1)];
    else {
      // Cambiar de fila: se cae en la butaca más cercana en X, no en el mismo
      // índice — las filas tienen largos distintos y el índice hace saltar.
      const li2 = Math.min(orden.length - 1, Math.max(0, li + (e.key === 'ArrowUp' ? -1 : 1)));
      const ref = obj.left;
      obj = orden[li2].reduce((a, b) => (Math.abs(b.left - ref) < Math.abs(a.left - ref) ? b : a));
    }
    pendienteFoco.current = true;
    setFoco(obj.n);
    aVista(obj);
  };

  /* ── render ────────────────────────────────────────────────────────────── */

  const butacas = useMemo(() => {
    if (!plano) return [];
    const elegidasSet = new Set(sel);
    const anillo = Math.max(0.8, Math.min(plano.w, plano.h) * 0.055);
    const fuenteCod = Math.min(plano.h * 0.46, plano.w * 0.285);
    const out: Array<{
      n: string;
      elegida: boolean;
      tab: number;
      texto: string;
      etiqueta: string;
      estilo: CSSProperties;
      muerta: boolean;
    }> = [];

    for (const l of plano.lineas) {
      for (const b of l.butacas) {
        const eleg = elegidasSet.has(b.n);
        const muerta = b.estado !== 'libre' && !eleg;

        let contenido = '';
        let fuente = fuenteCod;
        if (muerta) {
          contenido = texto.nums ? '×' : '';
          fuente = Math.min(plano.h * 0.6, plano.w * 0.6);
        } else if (b.accesible) {
          // La accesible se anota con un punto ámbar, no con un glifo: el
          // pictograma de silla de ruedas es un emoji (sale de color) y a 14 px
          // no se lee. El `aria-label` sí dice «accesible».
          contenido = '';
        } else if (texto.codigos) {
          contenido = `${b.fila}${b.numero}`;
        } else if (texto.nums) {
          contenido = b.numero;
          fuente = plano.fuenteNumero;
        }

        const fondo = eleg
          ? t.elegida
          : b.estado === 'libre'
            ? t.libre
            : b.estado === 'vendida'
              ? t.vendida
              : t.bloqueada;

        const tinta = eleg
          ? t.tintaElegida
          : b.estado === 'libre'
            ? t.tintaLibre
            : b.estado === 'vendida'
              ? t.tintaVendida
              : t.tintaBloqueada;

        out.push({
          n: b.n,
          elegida: eleg,
          muerta,
          tab: foco === b.n ? 0 : -1,
          texto: contenido,
          etiqueta:
            `Fila ${b.fila}, butaca ${b.numero}` +
            (b.accesible ? ', accesible' : '') +
            `, ${eleg ? 'elegida' : b.estado}`,
          estilo: {
            position: 'absolute',
            left: b.left,
            top: b.top,
            width: plano.w,
            height: plano.h,
            borderRadius: plano.redondeo,
            background: fondo,
            border:
              !eleg && !muerta && t.libreBorde !== 'transparent'
                ? `${anillo}px solid ${t.libreBorde}`
                : 'none',
            boxSizing: 'border-box',
            padding: 0,
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: fuente,
            fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
            letterSpacing: -0.2,
            lineHeight: 1,
            color: tinta,
            overflow: 'hidden',
            outline: foco === b.n ? `2px solid ${t.pantallaTinta}` : 'none',
            outlineOffset: 2,
            cursor: !esInteractivo ? 'default' : b.estado === 'libre' ? 'pointer' : 'not-allowed',
            touchAction: 'manipulation',
            ...(b.accesible && !eleg
              ? {
                  backgroundImage: `radial-gradient(circle at 50% 50%, ${t.accesible} 0 29%, transparent 30%)`,
                }
              : null),
          },
        });
      }
    }
    return out;
  }, [plano, sel, foco, texto, t, esInteractivo]);

  const btnCtrl: CSSProperties = {
    width: 44,
    height: 40,
    border: 'none',
    borderBottom: `1px solid ${t.panelBorde}`,
    background: 'transparent',
    color: t.pantallaTinta,
    fontSize: 19,
    lineHeight: 1,
    cursor: 'pointer',
    touchAction: 'manipulation',
    padding: 0,
    fontFamily: 'inherit',
  };

  return (
    <div
      ref={raizEl}
      className={className}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: t.fondo,
        overflow: 'hidden',
        fontFamily: t.fuente,
        ...style,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gridTemplateRows: 'auto 1fr',
          padding: movil ? '0 10px 8px' : '4px 34px 10px',
        }}
      >
        {/* 🔑 La PANTALLA vive FUERA del visor que se transforma: es la
            referencia física de la sala y tiene que quedarse quieta mientras las
            butacas se acercan y se panean. A todo el ancho y arriba de todo. */}
        {rotuloPantalla !== null && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              marginBottom: movil ? 56 : 76,
            }}
          >
            <div
              style={{
                height: movil ? 16 : 20,
                borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
                background: t.pantalla,
                boxShadow: t.pantallaHalo,
                margin: movil ? '0 14px' : '0 6%',
              }}
            />
            <div
              style={{
                textAlign: 'center',
                textTransform: 'uppercase',
                fontFamily: t.fuenteDisplay,
                fontWeight: 700,
                fontSize: movil ? 13 : 14,
                letterSpacing: movil ? 2.2 : 2.6,
                color: t.pantallaTinta,
                marginTop: 6,
              }}
            >
              {rotuloPantalla}
            </div>
          </div>
        )}

        <div
          ref={vistaEl}
          // Roving tabindex canónico: el contenedor es la PUERTA DE ENTRADA solo
          // mientras ninguna butaca sea focuseable. En cuanto una butaca tiene
          // tabIndex 0, el contenedor sale del orden de tabulación — si no, el
          // mapa consumía DOS paradas de Tab.
          tabIndex={esInteractivo && foco ? -1 : 0}
          role={esInteractivo ? 'application' : 'group'}
          aria-label={
            esInteractivo ? 'Mapa de butacas: flechas para moverte, Enter para elegir' : 'Mapa de butacas'
          }
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            // Al tabular al mapa no hay ninguna butaca enfocada: sin sembrar el
            // foco no se dibuja ningún anillo (el contenedor tiene outline:none)
            // y el primer Enter elegiría la butaca 0 a ciegas, sin que el lector
            // de pantalla la haya nombrado nunca.
            if (!esInteractivo || e.target !== e.currentTarget) return;
            if (!e.currentTarget.matches(':focus-visible')) return; // no robar el foco en un tap
            const n = foco ?? geoRef.current?.orden[0]?.[0]?.n;
            if (!n) return;
            pendienteFoco.current = true;
            setFoco(n);
          }}
          style={{
            position: 'relative',
            overflow: 'hidden',
            touchAction: movil ? 'none' : 'auto',
            outline: 'none',
            cursor: movil ? 'grab' : 'default',
          }}
        >
          <div
            ref={planoEl}
            onClick={onClickPlano}
            style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' }}
          >
            {mostrarRotulos &&
              plano?.lineas.map((l) => (
                <div
                  key={`r${l.top}`}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: l.top,
                    width: labelWidth - 5,
                    height: plano.h,
                    lineHeight: `${plano.h}px`,
                    textAlign: 'right',
                    fontSize: plano.fuenteLetra,
                    color: t.rotulo,
                  }}
                >
                  {l.letra}
                </div>
              ))}

            {butacas.map((b) =>
              esInteractivo ? (
                <button
                  key={b.n}
                  type="button"
                  data-n={b.n}
                  tabIndex={b.tab}
                  aria-pressed={b.elegida}
                  aria-label={b.etiqueta}
                  title={b.etiqueta}
                  style={b.estilo}
                >
                  {b.texto}
                </button>
              ) : (
                // `role="img"` porque un div es `generic` y el rol genérico NO
                // admite nombre accesible: el aria-label se descartaba.
                <div
                  key={b.n}
                  data-n={b.n}
                  role="img"
                  tabIndex={b.tab}
                  aria-label={b.etiqueta}
                  title={b.etiqueta}
                  style={b.estilo}
                >
                  {b.texto}
                </div>
              ),
            )}
          </div>

          {conZoom && (
            <div
              data-ctrl
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                display: 'flex',
                flexDirection: 'column',
                background: t.panel,
                border: `1px solid ${t.panelBorde}`,
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => zoomEn(vp.w / 2, vp.h / 2, v.current.z * 1.45)}
                aria-label="Acercar"
                style={btnCtrl}
              >
                +
              </button>
              <div
                ref={pctEl}
                style={{
                  height: 26,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10.5,
                  color: t.rotulo,
                  fontVariantNumeric: 'tabular-nums',
                  borderBottom: `1px solid ${t.panelBorde}`,
                }}
              >
                100%
              </div>
              <button
                type="button"
                onClick={() => zoomEn(vp.w / 2, vp.h / 2, v.current.z / 1.45)}
                aria-label="Alejar"
                style={btnCtrl}
              >
                −
              </button>
              <button
                type="button"
                onClick={verToda}
                aria-label="Ver toda la sala"
                title="Ver toda la sala"
                style={{ ...btnCtrl, height: 38, borderBottom: 'none', fontSize: 13 }}
              >
                ⤢
              </button>
            </div>
          )}

          <div
            aria-live="polite"
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 14,
              transform: 'translateX(-50%)',
              background: t.elegida,
              color: t.tintaElegida,
              fontSize: 12.5,
              fontWeight: 500,
              lineHeight: 1,
              padding: '9px 13px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              opacity: aviso.txt ? 1 : 0,
              transition: 'opacity .18s ease',
            }}
          >
            {/* El hijo va KEYED por el nonce: si el texto es el mismo string, sin
                esto no hay mutación de DOM dentro de la región y el lector de
                pantalla no vuelve a anunciar el segundo rechazo. */}
            <span key={aviso.n}>{aviso.txt}</span>
          </div>
        </div>
      </div>

      {leyenda && <SeatMapLeyenda tema={tema} />}
    </div>
  );
}

/**
 * Mapa de butacas **solo vista**. No acepta selección ni handlers — no se puede
 * volver interactivo sin cambiar de componente, que es justamente la garantía
 * que se quiere para reportes, pantallas y el mapa de un acomodador.
 */
export function SeatMapView(props: PropsVista) {
  return <SeatMapBase {...props} elegidas={[]} />;
}

/** Mapa de butacas con selección. Para elegir al vender. */
export function SeatMap(props: PropsSeleccion) {
  return <SeatMapBase {...props} />;
}

export function SeatMapLeyenda({ tema }: { tema?: Partial<TemaButacas> }) {
  const t = { ...TEMA_DEFAULT, ...tema };
  const caja: CSSProperties = { width: 13, height: 13, borderRadius: 3, boxSizing: 'border-box' };
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '8px 20px',
        padding: '14px 16px 16px',
        fontFamily: t.fuente,
      }}
    >
      <Item
        t={t}
        label="Disponible"
        caja={{
          ...caja,
          background: t.libre,
          border: t.libreBorde !== 'transparent' ? `1px solid ${t.libreBorde}` : undefined,
        }}
      />
      <Item
        t={t}
        label="No disponible"
        caja={{
          ...caja,
          background: t.vendida,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9,
          color: t.tintaVendida,
          lineHeight: 1,
        }}
        glifo="×"
      />
      <Item t={t} label="Seleccionado" caja={{ ...caja, background: t.elegida }} />
      <Item
        t={t}
        label="Accesible en silla de ruedas"
        caja={{
          ...caja,
          background: t.libre,
          border: t.libreBorde !== 'transparent' ? `1px solid ${t.libreBorde}` : undefined,
          backgroundImage: `radial-gradient(circle at 50% 50%, ${t.accesible} 0 29%, transparent 30%)`,
        }}
      />
    </div>
  );
}

function Item({
  t,
  label,
  caja,
  glifo,
}: {
  t: TemaButacas;
  label: string;
  caja: CSSProperties;
  glifo?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={caja}>{glifo}</div>
      <span style={{ fontSize: 12, color: t.rotulo }}>{label}</span>
    </div>
  );
}

export type { PlanoSala };
