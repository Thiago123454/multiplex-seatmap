/**
 * Renderer REACT NATIVE del mapa de butacas.
 *
 * La geometría no vive acá: vive en `../core`. Este archivo es la CAPA DE VISTA,
 * y es el gemelo de `../web`. Si tocás uno, mirá el otro: las decisiones de
 * abajo son LAS MISMAS que las del web, portadas a lo que React Native puede
 * hacer. Lo que cambia es la mecánica (no hay DOM, no hay CSS, no hay pointer
 * events), nunca el criterio.
 *
 * DOS COMPONENTES, una sola implementación:
 *   · <SeatMapView>  → solo vista. No acepta selección ni handlers.
 *   · <SeatMap>      → el mismo dibujo + selección.
 *
 * ── Las decisiones de esta capa ───────────────────────────────────────────
 *
 * 1. 🔑 **EL ZOOM ES UN `transform`, NO UN RECÁLCULO.** El plano se calcula UNA
 *    vez por tamaño de visor (con `zoom: 1`) y el zoom es un `scale` sobre UN
 *    solo nodo, escrito con `Animated.Value.setValue()` — o sea SIN pasar por
 *    el render de React. Un pinch sobre 292 butacas no puede reconciliar 292
 *    nodos por frame. `OpcionesPlano.zoom` del core sigue estando para quien
 *    quiera render sin transform (server, canvas, PDF).
 *
 * 2. **100 % = la sala entera.** El piso del zoom es el encuadre que muestra
 *    toda la sala y el techo es la escala a la que la butaca llega a 46 px, que
 *    es el tamaño con el que un dedo no falla.
 *
 * 3. **La PANTALLA vive FUERA del área que se transforma.** Es la referencia
 *    física de la sala: se acercan y panean las butacas, la pantalla se queda
 *    quieta, a todo el ancho y arriba de todo.
 *
 * 4. **Tap sobre butaca chica = acercar, no elegir.** Por debajo de 22 px, tocar
 *    acerca esa zona hasta 38 px. Elegir a 8 px no es elegir, es adivinar — y el
 *    rebote se paga en la caja. Vale también en modo vista: ahí acercar ES la
 *    única razón por la que un acomodador toca la sala.
 *
 * 5. **El visor CAPTURA el toque y la butaca se resuelve por GEOMETRÍA.** No hay
 *    293 `Pressable`: hay 293 `View` mudas y un solo responder que invierte el
 *    transform para saber qué butaca cayó bajo el dedo. Es lo mismo que hace el
 *    web con `closest('[data-n]')`, pero en RN un hijo tocable le pelea el gesto
 *    al padre y el pinch se pierde apenas el segundo dedo cae sobre una butaca.
 *    (La activación por TalkBack no pasa por acá: va por `accessibilityActions`.)
 *
 * 6. **El visor no le devuelve el gesto a nadie.** `onPanResponderTerminationRequest`
 *    dice que no y `onShouldBlockNativeResponder` bloquea el scroll nativo: sin
 *    eso, un `ScrollView` vertical arriba del mapa se queda con el paneo y la
 *    sala no se mueve para abajo. El host igual no debería envolverlo en uno.
 *
 * SIN `StyleSheet` para lo que depende del plano: el posicionamiento (absoluto,
 * medidas en px que salen del cálculo) es parte de la CORRECCIÓN del componente
 * y cambia por render. Los estilos fijos sí van en `StyleSheet`.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  GestureResponderEvent,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  calcularPlano,
  colorSolido,
  contarHuecos,
  dejaButacaSuelta,
  familiaNativa,
  puedeElegir,
  TEMA_DEFAULT,
} from '../core';
import type {
  Butaca,
  ButacaPlano,
  FilaButacas,
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
/** Cuánto puede pasarse «ver toda la sala» de la escala base cuando sobra lugar. */
const HOLGURA_FIT = 1.35;
/** Gutter de la letra de fila, cuando está prendido. */
const LABEL_W = 20;
/**
 * Alto mínimo del visor.
 *
 * 🔑 Es lo que hace que el componente no dependa de que el host le dé un alto.
 * El visor crece para llenar lo que sobre, pero sus butacas están posicionadas
 * en ABSOLUTO: no aportan alto. Montado en un contenedor de alto automático, sin
 * este piso el visor mediría cero y el mapa se renderizaría en blanco.
 */
const MIN_VISOR = 160;
/** Movimiento (px) que separa un tap de un paneo. */
const UMBRAL_TAP = 6;
/** Ventana del doble tap. */
const DOBLE_MS = 300;
/** Cuánto tolera el doble tap que el segundo toque caiga corrido. */
const DOBLE_PX = 32;
/** Debounce del «asentar»: qué texto entra en la butaca se decide al soltar. */
const ASENTAR_MS = 130;

/* ── geometría derivada ──────────────────────────────────────────────────── */

interface Geo {
  plano: PlanoSala;
  /** Escala a la que la sala entra entera. Es el 100 % de la UI. */
  zFit: number;
  zMax: number;
  /** Lado menor de la butaca en el plano base. */
  lado: number;
  /** Centro visual de la sala. */
  ejeX: number;
}

function derivar(plano: PlanoSala, vw: number, vh: number): Geo {
  const lado = Math.min(plano.w, plano.h);

  // «Ver toda la sala». Se permite pasar un poco de la escala base (que ya topa
  // en maxSeat) cuando sobra lugar: en una tablet ancha la sala quedaba flotando
  // en el medio con la mitad del alto vacío. Sigue siendo un factor único para
  // los dos ejes, así que no deforma nada.
  const zFit = Math.min(HOLGURA_FIT, vw / plano.ancho, vh / plano.alto);
  const zMax = Math.max(zFit * 1.8, DEDO / lado);

  // 🔑 Eje visual de la sala: el centro de la fila MÁS LARGA, no el de la caja.
  // El anexo accesible cuelga un par de butacas bien a la derecha, y centrar por
  // la caja corre todo el cuerpo de la sala hacia la izquierda.
  let larga = plano.lineas[0];
  for (const l of plano.lineas) if (l.butacas.length > larga.butacas.length) larga = l;
  const lx = larga.butacas.map((b) => b.left);
  const ejeX = (Math.min(...lx) + Math.max(...lx) + plano.w) / 2;

  return { plano, zFit, zMax, lado, ejeX };
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
  /** Controles de zoom flotantes. Prendidos por defecto: acá SIEMPRE es mobile. */
  zoomControls?: boolean;
  /** Techo del lado de la butaca en el plano base. */
  maxSeat?: number;
  /**
   * Medidas del VISOR. Si no vienen se miden con `onLayout`, que es lo normal.
   * Están para el host que ya las sabe y quiere ahorrarse el primer frame vacío.
   */
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

export interface PropsSeleccion extends PropsVista {
  /** Butacas elegidas, por `n`. Si no la pasás, el mapa se maneja solo. */
  elegidas?: readonly string[];
  /** Recibe la butaca tocada y la lista ya resuelta. */
  onToggle?: (butaca: Butaca, lista: string[]) => void;
  /** Se llama cuando un toque rebota, para que la UI pueda explicar por qué. */
  onRechazo?: (motivo: MotivoRechazo, butaca: Butaca) => void;
  reglas?: ReglasSeleccion;
  /**
   * Rechazar la elección que deja una butaca suelta. Prendido por defecto: un
   * hueco de uno no lo compra nadie.
   */
  sinHuecos?: boolean;
}

/**
 * 🔴 `accessibilityActions` y NO `onAccessibilityTap`.
 *
 * `onAccessibilityTap` es **iOS-only**: en React Native 0.81 aparece en
 * `BaseViewConfig.ios.js` y no tiene UNA sola referencia en `ReactAndroid/`. En
 * Android la prop se ignora en silencio.
 *
 * Y acá eso no sería «una prop que no anda»: como las butacas dejaron de ser
 * `Pressable` (decisión 5), esta es la ÚNICA forma de activarlas. Sin esto, con
 * TalkBack prendido el usuario escucha cada butaca y el doble tap no hace nada.
 * `'activate'` es el nombre que `ReactAccessibilityDelegate` mapea a
 * `ACTION_CLICK`, que es exactamente el doble tap de TalkBack.
 */
const ACCIONES_A11Y = [{ name: 'activate', label: 'Elegir' }];

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
  zoomControls = true,
  maxSeat = MAX_SEAT,
  width,
  height,
  style,
  elegidas,
  onToggle,
  onRechazo,
  reglas,
  sinHuecos = true,
}: PropsSeleccion) {
  const [medido, setMedido] = useState({ w: 0, h: 0 });
  // Qué entra dentro de la butaca. Se decide al ASENTAR el gesto, no por frame.
  const [texto, setTexto] = useState({ nums: false, codigos: false });
  // El nonce existe para que el lector de pantalla vuelva a anunciar un rechazo
  // repetido: con el mismo string, sin remontar el nodo no hay nada que leer.
  const [aviso, setAviso] = useState({ txt: '', n: 0 });
  const [propias, setPropias] = useState<string[]>([]);

  const vw = width ?? medido.w;
  const vh = height ?? medido.h;

  const t = useMemo(() => ({ ...TEMA_DEFAULT, ...tema }), [tema]);

  // El tema es el mismo que el del web, así que trae valores que son CSS puro.
  // Ver `../core/css.ts`: acá se traducen UNA vez, no en cada butaca.
  const nat = useMemo(
    () => ({
      fondo: colorSolido(t.fondo),
      pantalla: colorSolido(t.pantalla),
      panel: colorSolido(t.panel),
      fuente: familiaNativa(t.fuente),
      fuenteDisplay: familiaNativa(t.fuenteDisplay),
    }),
    [t],
  );

  // Interactivo = hay handler (controlado) o no hay lista (se maneja solo).
  // `<SeatMapView>` pasa `elegidas={[]}` sin handler ⇒ cae en `false`.
  const esInteractivo = !!onToggle || elegidas === undefined;

  const sel = elegidas ?? propias;
  const selRef = useRef(sel);
  selRef.current = sel;

  const labelWidth = mostrarRotulos ? LABEL_W : 0;

  const plano = useMemo(
    () =>
      calcularPlano(filas, {
        width: vw,
        ajuste: 'ancho',
        orientacion: 'horizontal',
        labelWidth,
        maxSeat,
      }),
    [filas, vw, labelWidth, maxSeat],
  );

  const geo = useMemo(
    () => (plano && vw > 0 && vh > 0 ? derivar(plano, vw, vh) : null),
    [plano, vw, vh],
  );

  const porId = useMemo(() => {
    const m = new Map<string, Butaca>();
    for (const f of filas) for (const b of f.butacas) m.set(b.n, b);
    return m;
  }, [filas]);

  /* ── estado de la vista (mutable: no dispara render) ───────────────────── */

  const v = useRef({ x: 0, y: 0, z: 1 });
  const geoRef = useRef<Geo | null>(null);
  const vpRef = useRef({ w: vw, h: vh });
  vpRef.current = { w: vw, h: vh };

  // Un valor por eje, los tres NATIVOS. Con `useNativeDriver` en el constructor
  // el nodo se crea del lado nativo, y ahí `setValue` deja de ser una transacción
  // de props para pasar a ser una escritura directa sobre el nodo
  // (`NativeAnimatedAPI.setAnimatedNodeValue`). O sea: el pinch no toca ni el
  // render de React ni el puente de props.
  //
  // 🔴 Con el valor en nativo hay dos cosas que NO se pueden hacer: ponerle un
  // `addListener` (prende un callback nativo→JS por frame y anula la ventaja) y
  // mezclar en el mismo estilo una animación manejada desde JS. Acá no pasa
  // ninguna de las dos: el estado real del encuadre vive en `v.current` y nunca
  // se lee `__getValue()`.
  const ax = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const ay = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const az = useRef(new Animated.Value(1, { useNativeDriver: true })).current;

  /** Setter del rótulo de porcentaje. Vive en un componente hoja: ver `Porcentaje`. */
  const ponerPct = useRef<((n: number) => void) | null>(null);
  const pctRef = useRef(100);
  const registrarPct = useCallback((fn: ((n: number) => void) | null) => {
    ponerPct.current = fn;
  }, []);

  const encajar = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    const { w: vw2, h: vh2 } = vpRef.current;
    const W = g.plano.ancho * v.current.z;
    const H = g.plano.alto * v.current.z;
    v.current.x =
      W <= vw2
        ? Math.max(0, Math.min(vw2 - W, vw2 / 2 - g.ejeX * v.current.z))
        : Math.min(0, Math.max(vw2 - W, v.current.x));
    // Cuando la sala entra a lo alto se centra en el espacio libre, que es lo
    // que la deja a la altura del pulgar.
    v.current.y = H <= vh2 ? (vh2 - H) / 2 : Math.min(0, Math.max(vh2 - H, v.current.y));
  }, []);

  const aplicar = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    const { x, y, z } = v.current;

    // 🔴 React Native aplica el `transform` respecto del CENTRO del nodo; el web
    // usa `transform-origin: 0 0`. Con el origen en el centro, un punto `p` del
    // plano cae en `z*p + (1-z)*centro + t`, así que para que quede en `z*p + (x,y)`
    // —que es lo que calcula todo el resto de este archivo— hay que compensar:
    //
    //     t = (x, y) − (1 − z) · centro
    //
    // Se hace a mano y no con `transformOrigin` a propósito: es una cuenta de
    // dos términos, no depende de la versión de RN ni de la plataforma, y deja
    // el modelo de coordenadas idéntico al del web.
    ax.setValue(x - ((1 - z) * g.plano.ancho) / 2);
    ay.setValue(y - ((1 - z) * g.plano.alto) / 2);
    az.setValue(z);

    // El porcentaje se escribe sobre un componente hoja y solo cuando cambia el
    // entero: es el equivalente del `textContent` del web, que existe para no
    // re-renderizar la sala entera por un rótulo de cuatro caracteres.
    const pct = Math.round((z / g.zFit) * 100);
    if (pct !== pctRef.current) {
      pctRef.current = pct;
      ponerPct.current?.(pct);
    }
  }, [ax, ay, az]);

  const tAsentar = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Al soltar el gesto se decide qué texto entra en la butaca. Es lo único que re-renderiza. */
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
    }, ASENTAR_MS);
  }, []);

  const limZ = useCallback((z: number) => {
    const g = geoRef.current;
    if (!g) return z;
    return Math.min(g.zMax, Math.max(g.zFit, z));
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

  const verToda = useCallback(() => {
    const g = geoRef.current;
    if (!g) return;
    v.current.z = g.zFit;
    encajar();
    aplicar();
    asentar();
  }, [encajar, aplicar, asentar]);

  useEffect(() => () => clearTimeout(tAsentar.current), []);

  // Cuando cambia la geometría (sala nueva o visor redimensionado) el encuadre
  // se rehace antes de que se pinte el frame, si no se ve saltar la sala.
  //
  // 🔴 El reset se gatea por la FIRMA de la geometría, NO por la identidad de
  // `geo`. `plano` depende de la identidad de `filas`, y el host arma ese array
  // de nuevo en cada refresco de butacas vendidas (el polling de ocupación):
  // resetear por identidad le tira el zoom y el paneo al que está mirando la
  // sala, en el medio, cada vez que llega un refresco.
  const firma = geo
    ? `${vw}x${vh}|${geo.plano.ancho}x${geo.plano.alto}|${geo.plano.w}|${geo.zFit}`
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
    // Si el visor cambió de tamaño con el dedo apoyado, las fotos del gesto
    // quedaron tomadas contra la geometría vieja: hay que rebasarlas o el
    // próximo frame pega un salto.
    rebasarGesto.current?.();
    asentar();
  }, [geo, firma, encajar, aplicar, asentar]);

  /* ── selección ─────────────────────────────────────────────────────────── */

  const tAviso = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tAviso.current), []);

  const avisar = useCallback((motivo: MotivoRechazo) => {
    setAviso((p) => ({ txt: COPY[motivo], n: p.n + 1 }));
    clearTimeout(tAviso.current);
    tAviso.current = setTimeout(
      () => setAviso((p) => (p.txt ? { txt: '', n: p.n } : p)),
      3200,
    );
  }, []);

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
      // `<SeatMapView>` no elige NI avisa: sin este guard, tocar una butaca
      // vendida en modo vista mostraba la píldora de rechazo.
      if (!esInteractivo) return;
      const b = porId.get(n);
      const g = geoRef.current;
      if (!b) return;
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
          avisar('hueco');
        }
        return;
      }

      const r = puedeElegir(b, actual, reglas);
      let motivo = r.motivo;
      let ok = r.ok;
      if (ok && sinHuecos && g) {
        // No dejes una butaca suelta. Se compara ANTES contra DESPUÉS: la sala
        // ya viene con huecos de otras ventas y rechazar por el total dejaría al
        // que vende sin poder elegir nada.
        if (dejaButacaSuelta(g.plano.lineas, actual, n, g.plano.w)) {
          ok = false;
          motivo = 'hueco';
        }
      }
      if (ok) return emitir(b, [...actual, n]);

      if (motivo) {
        onRechazo?.(motivo, b);
        avisar(motivo);
      }
    },
    [esInteractivo, porId, reglas, sinHuecos, emitir, onRechazo, avisar],
  );

  const alternarRef = useRef(alternarN);
  alternarRef.current = alternarN;

  const interactivoRef = useRef(esInteractivo);
  interactivoRef.current = esInteractivo;

  /* ── gestos ────────────────────────────────────────────────────────────── */

  const visorRef = useRef<View | null>(null);
  /** Origen del visor en coordenadas de la ventana: los toques vienen en `pageX/pageY`. */
  const origen = useRef({ x: 0, y: 0 });
  const medirOrigen = useCallback(() => {
    // Solo la semilla del primer frame. La medición que de verdad usa el gesto es
    // la de `latcharOrigen`: `measureInWindow` es ASÍNCRONA, así que pedirla al
    // empezar el gesto y leer `origen.current` en la línea siguiente devuelve la
    // medición ANTERIOR.
    visorRef.current?.measureInWindow?.((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) origen.current = { x, y };
    });
  }, []);

  /**
   * Origen del visor, calculado del propio toque y sin una sola medición.
   *
   * 🔑 El visor va con `pointerEvents="box-only"`, así que el blanco del toque es
   * SIEMPRE él y nunca una butaca ⇒ `locationX/locationY` vienen relativos al
   * visor. Y `pageX − locationX` es, por definición, el borde izquierdo del visor
   * en las mismas coordenadas en las que llegan los toques.
   *
   * Se calibra solo y es exacto: no depende de qué ventana sea la del `Modal`
   * —en Android es un `DialogRootViewGroup` aparte, donde `pageX` (relativo al
   * root de React) y `measureInWindow` (relativo a la ventana) pueden no
   * coincidir—, ni de la barra de estado, ni de si el modal se movió.
   *
   * 🔴 Solo vale para el DOWN. Durante el movimiento hay que seguir usando
   * `pageX/pageY`: en Android el dispatcher re-hittestea en cada ACTION_MOVE y
   * `locationX` pega saltos mientras el dedo cruza butacas.
   */
  const latcharOrigen = useCallback((e: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = e.nativeEvent;
    if (Number.isFinite(pageX) && Number.isFinite(locationX)) {
      origen.current = { x: pageX - locationX, y: pageY - locationY };
    }
  }, []);

  /**
   * Butaca bajo un punto del visor, invirtiendo el transform.
   *
   * Primero gana la butaca que CONTIENE el punto; si ninguna lo contiene se
   * acepta la más cercana dentro de un margen chico, que es lo que perdona al
   * dedo que cae sobre el borde. Un toque en el pasillo sigue sin hacer nada.
   */
  const butacaEn = useCallback((px: number, py: number): ButacaPlano | null => {
    const g = geoRef.current;
    if (!g) return null;
    const { x, y, z } = v.current;
    const ux = (px - x) / z;
    const uy = (py - y) / z;
    const { w, h } = g.plano;
    // 🔴 La tolerancia es un RECTÁNGULO y no un radio, y es más ancha que alta.
    // Perdonar por distancia redonda deja que el toque salte a la fila de arriba,
    // porque las filas están MÁS JUNTAS que las butacas (paso en Y de 23 contra
    // 32 en X, ver `layout.ts`). Elegir de más una butaca de costado es una
    // molestia; elegir la de otra fila es una entrada mal vendida.
    const holguraX = w * 0.35;
    const holguraY = h * 0.22;

    let mejor: ButacaPlano | null = null;
    let mejorD = Infinity;
    for (const l of g.plano.lineas) {
      for (const b of l.butacas) {
        const dx = ux < b.left ? b.left - ux : ux > b.left + w ? ux - (b.left + w) : 0;
        const dy = uy < b.top ? b.top - uy : uy > b.top + h ? uy - (b.top + h) : 0;
        if (dx === 0 && dy === 0) return b;
        if (dx > holguraX || dy > holguraY) continue;
        // Distancia normalizada a la holgura de cada eje: así «cerca» quiere decir
        // lo mismo en los dos, aunque la butaca sea rectangular.
        const d = dx / holguraX + dy / holguraY;
        if (d < mejorD) {
          mejorD = d;
          mejor = b;
        }
      }
    }
    return mejor;
  }, []);

  const pan = useMemo(() => {
    /** Foto del gesto en curso. Vive en el closure: no re-renderiza nada. */
    const g$ = {
      n: 0,
      /** Paneo de un dedo. */
      arr: null as null | { x: number; y: number; mov: number; vx: number; vy: number },
      /** Pinch de dos dedos. */
      pin: null as null | { d: number; cx: number; cy: number; z: number; x: number; y: number },
      /** Butaca que había bajo el dedo cuando bajó. El destino se decide al APOYAR. */
      destino: null as ButacaPlano | null,
      /** ts del último tap que ACERCÓ: el doble tap no puede deshacerlo. */
      acerco: 0,
      ultimoTap: { t: 0, x: 0, y: 0 },
      /**
       * Dónde estaban los dedos la última vez que se los vio.
       *
       * Existe solo para `rebasarGesto`, que corre desde afuera del gesto (lo
       * llama el efecto de layout) y ahí no hay ningún evento del que leerlos.
       * El renderer web no lo necesita porque tiene el `Map` de punteros vivos.
       */
      ultimos: [] as Toque[],
    };

    const local = (pageX: number, pageY: number) => ({
      x: pageX - origen.current.x,
      y: pageY - origen.current.y,
    });

    type Toque = { pageX: number; pageY: number };
    // Copia, no referencia: React Native reusa el objeto del evento, así que
    // guardarse `nativeEvent.touches` deja punteros a datos que van a cambiar.
    const toques = (e: GestureResponderEvent): Toque[] =>
      ((e.nativeEvent.touches ?? []) as unknown as Toque[]).map((t) => ({
        pageX: t.pageX,
        pageY: t.pageY,
      }));

    /** Foto del pinch con el par de dedos `ts` y el encuadre ACTUAL. */
    const fotoPin = (ts: Toque[]) => {
      const [a, b] = ts;
      const c = local((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2);
      return {
        d: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1,
        cx: c.x,
        cy: c.y,
        z: v.current.z,
        x: v.current.x,
        y: v.current.y,
      };
    };

    /** Vuelve a tomar la foto con los dedos que hay AHORA y el encuadre actual. */
    const rebasar = (ts: Toque[]) => {
      g$.ultimos = ts;
      if (ts.length >= 2) {
        g$.pin = fotoPin(ts);
        g$.arr = null;
      } else if (ts.length === 1) {
        const [a] = ts;
        g$.pin = null;
        g$.arr = {
          x: a.pageX,
          y: a.pageY,
          // Si veníamos de un pinch esto NO es un tap: se arranca pasado del umbral.
          mov: g$.n >= 2 ? 99 : 0,
          vx: v.current.x,
          vy: v.current.y,
        };
      } else {
        g$.pin = null;
        g$.arr = null;
      }
      g$.n = ts.length;
    };

    /**
     * El encuadre cambió por fuera del gesto (el visor se redimensionó, o el host
     * refrescó las butacas) con el dedo apoyado: la foto quedó tomada contra el
     * encuadre viejo y hay que rehacerla.
     *
     * 🔴 Tiene que rehacerla ENTERA. Pisar solo el encuadre (`vx/vy`, `pin.z`)
     * y dejar la posición de los dedos (`arr.x`, `pin.d`) hace que el próximo
     * frame vuelva a contar un delta que YA se aplicó: el paneo salta lo que
     * llevabas paneado, y el pinch aplica el factor al CUADRADO (con los dedos
     * quietos) hasta clavarse en el tope. Es el mismo criterio que el
     * `rebasarGesto` del web, que relee sus punteros vivos.
     *
     * `mov` sobrevive a propósito: es el historial de cuánto se movió el dedo, y
     * borrarlo convertiría un paneo largo en un tap al soltar.
     */
    rebasarGesto.current = () => {
      const ts = g$.ultimos;
      if (g$.pin && ts.length >= 2) g$.pin = fotoPin(ts);
      else if (g$.arr && ts.length === 1) {
        g$.arr = { ...g$.arr, x: ts[0].pageX, y: ts[0].pageY, vx: v.current.x, vy: v.current.y };
      }
    };

    const tap = (px: number, py: number) => {
      const g = geoRef.current;
      if (!g) return;
      const ahora = Date.now();
      const prev = g$.ultimoTap;
      const doble =
        ahora - prev.t < DOBLE_MS && Math.hypot(px - prev.x, py - prev.y) < DOBLE_PX;
      g$.ultimoTap = { t: ahora, x: px, y: py };

      // El doble tap solo existe en modo VISTA. Donde se elige, cada toque ya
      // alterna una butaca: agregarle un segundo significado al segundo toque
      // haría que elegir dos veces seguidas mueva el encuadre.
      if (doble && !interactivoRef.current) {
        // El 1.er tap del doble ya acercó (butaca chica). Mirar el z resultante
        // haría que el doble lo lea como «ya está acercado» y vuelva al fit:
        // acercar terminaría alejando.
        if (ahora - g$.acerco < 700) return;
        return zoomEn(px, py, v.current.z > g.zFit * 1.04 ? g.zFit : limZ(DEDO / g.lado));
      }

      // Un tap en el vacío (pasillo, margen) no hace nada.
      if (!g$.destino) return;
      // Elegir a 8 px no es elegir, es adivinar: primero se acerca.
      if (g.lado * v.current.z < TAP_MIN) {
        g$.acerco = ahora;
        return zoomEn(px, py, TAP_OBJ / g.lado);
      }
      alternarRef.current(g$.destino.n);
    };

    return PanResponder.create({
      // El visor se queda con TODO lo que pase adentro. Ver decisión 5.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Ver decisión 6: el gesto no se le devuelve a un ScrollView de arriba.
      onPanResponderTerminationRequest: () => false,
      // Explícito aunque HOY sea el default de `PanResponder`: de esto depende
      // que el paneo exista, así que no puede quedar librado a un default.
      onShouldBlockNativeResponder: () => true,

      onPanResponderGrant: (e) => {
        latcharOrigen(e);
        const ts = toques(e);
        g$.n = 0; // fuerza que `rebasar` no lo lea como «venía de un pinch»
        rebasar(ts);
        const p = local(e.nativeEvent.pageX, e.nativeEvent.pageY);
        g$.destino = ts.length === 1 ? butacaEn(p.x, p.y) : null;
      },

      onPanResponderMove: (e) => {
        const ts = toques(e);
        // Cambió la CANTIDAD de dedos (cayó el segundo, se levantó uno): la foto
        // está tomada contra el par viejo y compararla pega un salto de zoom.
        if (ts.length !== g$.n) {
          rebasar(ts);
          return;
        }
        g$.ultimos = ts;

        if (ts.length >= 2 && g$.pin) {
          const [a, b] = ts;
          const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
          const c = local((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2);
          const z = limZ(g$.pin.z * (d / g$.pin.d));
          const k = z / g$.pin.z;
          v.current.x = c.x - (g$.pin.cx - g$.pin.x) * k;
          v.current.y = c.y - (g$.pin.cy - g$.pin.y) * k;
          v.current.z = z;
          encajar();
          aplicar();
        } else if (ts.length === 1 && g$.arr) {
          const [a] = ts;
          const dx = a.pageX - g$.arr.x;
          const dy = a.pageY - g$.arr.y;
          g$.arr.mov = Math.max(g$.arr.mov, Math.hypot(dx, dy));
          v.current.x = g$.arr.vx + dx;
          v.current.y = g$.arr.vy + dy;
          encajar();
          aplicar();
        }
      },

      onPanResponderRelease: (e) => {
        const a = g$.arr;
        g$.ultimos = [];
        const p = local(e.nativeEvent.pageX, e.nativeEvent.pageY);
        g$.n = 0;
        g$.arr = null;
        g$.pin = null;
        // Quieto es tap, dure lo que dure: lo que separa el paneo del tap es la
        // DISTANCIA (`mov` es el máximo histórico), no el reloj. Un dedo que
        // duda medio segundo sobre la butaca sigue siendo un tap deliberado.
        if (a && a.mov < UMBRAL_TAP) tap(p.x, p.y);
        g$.destino = null;
        asentar();
      },

      onPanResponderTerminate: () => {
        g$.ultimos = [];
        g$.n = 0;
        g$.arr = null;
        g$.pin = null;
        g$.destino = null;
        asentar();
      },
    });
  }, [butacaEn, latcharOrigen, encajar, aplicar, asentar, limZ, zoomEn]);

  useEffect(() => () => { rebasarGesto.current = null; }, []);

  /* ── render ────────────────────────────────────────────────────────────── */

  const onLayoutVisor = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setMedido((p) => {
      const nw = Math.round(w);
      const nh = Math.round(h);
      return p.w === nw && p.h === nh ? p : { w: nw, h: nh };
    });
    medirOrigen();
  };

  const butacas = useMemo(() => {
    if (!plano) return null;
    const elegidasSet = new Set(sel);
    const anillo = Math.max(0.8, Math.min(plano.w, plano.h) * 0.055);
    const fuenteCod = Math.min(plano.h * 0.46, plano.w * 0.285);
    const conAnillo = t.libreBorde !== 'transparent';
    const puntoLado = Math.min(plano.w, plano.h) * 0.42;

    const out: ReactNode[] = [];
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
          // no se lee. El `accessibilityLabel` sí dice «accesible».
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

        const etiqueta =
          `Fila ${b.fila}, butaca ${b.numero}` +
          (b.accesible ? ', accesible' : '') +
          `, ${eleg ? 'elegida' : b.estado}`;

        out.push(
          <View
            key={b.n}
            // Las butacas NO son tocables (decisión 5): el gesto lo resuelve el
            // visor. Esto es lo único que las vuelve alcanzables por TalkBack.
            accessible
            accessibilityRole={esInteractivo ? 'button' : 'image'}
            accessibilityLabel={etiqueta}
            accessibilityState={
              esInteractivo ? { selected: eleg, disabled: b.estado !== 'libre' } : undefined
            }
            accessibilityActions={esInteractivo ? ACCIONES_A11Y : undefined}
            onAccessibilityAction={
              esInteractivo
                ? (ev) => {
                    if (ev.nativeEvent.actionName === 'activate') alternarRef.current(b.n);
                  }
                : undefined
            }
            style={[
              styles.butaca,
              {
                left: b.left,
                top: b.top,
                width: plano.w,
                height: plano.h,
                borderRadius: plano.redondeo,
                backgroundColor: fondo,
              },
              !eleg && !muerta && conAnillo
                ? { borderWidth: anillo, borderColor: t.libreBorde }
                : null,
            ]}
          >
            {b.accesible && !eleg ? (
              <View
                style={{
                  width: puntoLado,
                  height: puntoLado,
                  borderRadius: puntoLado / 2,
                  backgroundColor: t.accesible,
                }}
              />
            ) : contenido ? (
              <Text
                style={[
                  styles.numero,
                  { fontSize: fuente, color: tinta },
                  nat.fuente ? { fontFamily: nat.fuente } : null,
                ]}
                numberOfLines={1}
              >
                {contenido}
              </Text>
            ) : null}
          </View>,
        );
      }
    }
    return out;
  }, [plano, sel, texto, t, nat.fuente, esInteractivo]);

  const conZoom = zoomControls && !!geo;

  return (
    <View style={[styles.raiz, nat.fondo ? { backgroundColor: nat.fondo } : null, style]}>
      {/* 🔑 La PANTALLA vive FUERA del visor que se transforma: es la referencia
          física de la sala y tiene que quedarse quieta mientras las butacas se
          acercan y se panean. A todo el ancho y arriba de todo. */}
      {rotuloPantalla !== null && (
        <View style={styles.pantallaWrap} pointerEvents="none">
          <Arco ancho={vw} color={nat.pantalla} />
          <Text
            style={[
              styles.pantallaTxt,
              { color: t.pantallaTinta },
              nat.fuenteDisplay ? { fontFamily: nat.fuenteDisplay } : null,
            ]}
          >
            {rotuloPantalla}
          </Text>
        </View>
      )}

      <View style={styles.zona}>
        <View
          ref={visorRef}
          onLayout={onLayoutVisor}
          // Una View que solo tiene estilo puede ser aplanada fuera del árbol
          // nativo, y ahí no hay ni responder ni medición que valgan.
          collapsable={false}
          // Ver `latcharOrigen`: además de mantener el gesto entero acá, esto es
          // lo que hace que `locationX` sea relativo al visor.
          pointerEvents="box-only"
          style={styles.visor}
          {...pan.panHandlers}
        >
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: plano?.ancho ?? 0,
              height: plano?.alto ?? 0,
              transform: [{ translateX: ax }, { translateY: ay }, { scale: az }],
            }}
          >
            {mostrarRotulos &&
              plano?.lineas.map((l) => (
                <Text
                  key={`r${l.top}`}
                  style={[
                    styles.letra,
                    {
                      top: l.top,
                      width: labelWidth - 5,
                      height: plano.h,
                      lineHeight: plano.h,
                      fontSize: plano.fuenteLetra,
                      color: t.rotulo,
                    },
                  ]}
                >
                  {l.letra}
                </Text>
              ))}
            {butacas}
          </Animated.View>
        </View>

        {/* Los controles son HERMANOS del visor y no hijos: el visor captura
            todos los toques que pasan por adentro suyo (decisión 5), así que un
            botón ahí abajo no se podría apretar nunca. */}
        {conZoom && (
          <View
            style={[
              styles.panel,
              {
                backgroundColor: nat.panel ?? 'rgba(255,255,255,.94)',
                borderColor: t.panelBorde,
              },
            ]}
          >
            <Ctrl
              tema={t}
              glifo="+"
              etiqueta="Acercar"
              onPress={() => zoomEn(vw / 2, vh / 2, v.current.z * 1.45)}
            />
            <Porcentaje registrar={registrarPct} color={t.rotulo} borde={t.panelBorde} />
            <Ctrl
              tema={t}
              glifo="−"
              etiqueta="Alejar"
              onPress={() => zoomEn(vw / 2, vh / 2, v.current.z / 1.45)}
            />
            <Ctrl tema={t} glifo="⤢" etiqueta="Ver toda la sala" onPress={verToda} ultimo />
          </View>
        )}

        {!!aviso.txt && (
          <View
            style={[styles.aviso, { backgroundColor: t.elegida }]}
            pointerEvents="none"
            accessibilityLiveRegion="polite"
          >
            <Text key={aviso.n} style={[styles.avisoTxt, { color: t.tintaElegida }]}>
              {aviso.txt}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ── piezas ──────────────────────────────────────────────────────────────── */

/**
 * El arco de la pantalla.
 *
 * React Native no tiene radios elípticos (el web usa `50% 50% 0 0 / 100% …`),
 * así que el arco es el CASQUETE de un círculo enorme recortado por un
 * contenedor de 18 px de alto. El radio sale de la fórmula de la flecha de un
 * arco —`R = (c²/4 + f²) / 2f` con cuerda `c` y flecha `f`—, así que la curva
 * cae exactamente esos 18 px en los bordes, ni más ni menos, mida lo que mida
 * la pantalla del teléfono.
 */
const ARCO_FLECHA = 16;
const ARCO_MARGEN = 14;

function Arco({ ancho, color }: { ancho: number; color?: string }) {
  // Sin color (el tema lo apagó con `'none'`) o antes de la primera medición, el
  // arco reserva su lugar y no dibuja: así el mapa no salta cuando aparece.
  if (!color || ancho <= 0) return <View style={{ height: ARCO_FLECHA }} />;
  const cuerda = Math.max(1, ancho - ARCO_MARGEN * 2);
  const r = Math.min(2500, (cuerda * cuerda) / (8 * ARCO_FLECHA) + ARCO_FLECHA / 2);
  return (
    <View style={{ height: ARCO_FLECHA, marginHorizontal: ARCO_MARGEN, overflow: 'hidden' }}>
      {/* El círculo mide ~1.700 px de lado en un celular, pero es un rectángulo
          redondeado de color sólido: no hay bitmap ni capa offscreen, y el padre
          recorta todo menos la franja de arriba. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: cuerda / 2 - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * El rótulo de porcentaje.
 *
 * Componente aparte con estado propio a propósito: es el equivalente del
 * `pctEl.textContent` del web. Si el porcentaje viviera en el estado del mapa,
 * cada frame de un pinch re-renderizaría las 293 butacas para cambiar cuatro
 * caracteres.
 */
function Porcentaje({
  registrar,
  color,
  borde,
}: {
  registrar: (fn: ((n: number) => void) | null) => void;
  color: string;
  borde: string;
}) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    registrar(setPct);
    return () => registrar(null);
  }, [registrar]);
  return (
    <View style={[styles.pct, { borderBottomColor: borde }]}>
      <Text style={[styles.pctTxt, { color }]}>{pct}%</Text>
    </View>
  );
}

function Ctrl({
  tema,
  glifo,
  etiqueta,
  onPress,
  ultimo,
}: {
  tema: TemaButacas;
  glifo: string;
  etiqueta: string;
  onPress: () => void;
  ultimo?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        styles.ctrl,
        ultimo ? styles.ctrlUltimo : { borderBottomColor: tema.panelBorde },
        pressed && styles.ctrlPress,
      ]}
    >
      <Text style={[styles.ctrlTxt, { color: tema.pantallaTinta }, ultimo && styles.ctrlTxtChico]}>
        {glifo}
      </Text>
    </Pressable>
  );
}

/* ── API ─────────────────────────────────────────────────────────────────── */

/**
 * La lista vacía es UNA sola, a nivel de módulo.
 *
 * Escrita como literal `[]` en el JSX cambia de identidad en cada render, y con
 * ella `sel` ⇒ se cae el `useMemo` de las butacas y se reconstruyen los 293
 * nodos. El host de Ocupación tiene un ticker de 10 s para el «actualizado hace
 * N s», así que eso pasaba seis veces por minuto sin que cambiara un solo dato.
 */
const SIN_SELECCION: readonly string[] = [];

/**
 * Mapa de butacas **solo vista**. No acepta selección ni handlers — no se puede
 * volver interactivo sin cambiar de componente, que es justamente la garantía
 * que se quiere para reportes, pantallas y el mapa de un acomodador.
 */
export function SeatMapView(props: PropsVista) {
  return <SeatMapBase {...props} elegidas={SIN_SELECCION} />;
}

/** Mapa de butacas con selección. Para elegir al vender. */
export function SeatMap(props: PropsSeleccion) {
  return <SeatMapBase {...props} />;
}

/**
 * Leyenda de colores.
 *
 * Diverge a propósito de la del web, que muestra siempre los cuatro estados:
 * acá «Elegida» solo aparece si de verdad se puede elegir y «Bloqueada» solo si
 * la sala tiene alguna. Un estado que no existe en la sala que estás mirando no
 * es información, es ruido — y en un celular el ruido se paga en renglones.
 */
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
  const anillo = t.libreBorde !== 'transparent' ? t.libreBorde : undefined;
  return (
    <View style={styles.leyenda}>
      <Item color={t.libre} borde={anillo} tinta={t.rotulo} label="Libre" />
      {conSeleccion && <Item color={t.elegida} tinta={t.rotulo} label="Elegida" />}
      <Item color={t.vendida} tinta={t.rotulo} label="Vendida" glifo="×" glifoColor={t.tintaVendida} />
      {/* La bloqueada solo se explica si existe: si no hay ninguna, es ruido. */}
      {bloqueadas > 0 && <Item color={t.bloqueada} tinta={t.rotulo} label="Bloqueada" />}
      <Item color={t.libre} borde={anillo} tinta={t.rotulo} label="Accesible" punto={t.accesible} />
    </View>
  );
}

function Item({
  color,
  label,
  borde,
  punto,
  glifo,
  glifoColor,
  tinta,
}: {
  color: string;
  label: string;
  borde?: string;
  punto?: string;
  glifo?: string;
  glifoColor?: string;
  tinta: string;
}) {
  return (
    <View style={styles.leyendaItem}>
      <View
        style={[
          styles.leyendaDot,
          { backgroundColor: color },
          borde ? { borderWidth: 1, borderColor: borde } : null,
        ]}
      >
        {punto ? (
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: punto }} />
        ) : glifo ? (
          <Text style={[styles.leyendaGlifo, { color: glifoColor }]}>{glifo}</Text>
        ) : null}
      </View>
      <Text style={[styles.leyendaTxt, { color: tinta }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // `flexGrow` y NO `flex`: `flex: 1` fija `flexBasis: 0`, y adentro de un
  // contenedor de alto AUTOMATICO eso colapsa el mapa a cero. Con la base en
  // `auto` el mapa se mide por su contenido cuando nadie le da alto y crece
  // para llenar cuando el host si se lo da. Las dos formas de montarlo andan.
  raiz: { flexGrow: 1, flexShrink: 1 },
  pantallaWrap: { marginBottom: 14 },
  pantallaTxt: {
    textAlign: 'center',
    textTransform: 'uppercase',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2.2,
    marginTop: 6,
  },
  // El visor es `flex: 1` con piso: ver MIN_VISOR.
  // `flexShrink: 1` porque en React Native el default es 0: sin esto, en una
  // pantalla chica el mapa no cede un píxel y se desborda sobre la leyenda.
  zona: { flexGrow: 1, flexShrink: 1, minHeight: MIN_VISOR },
  visor: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  letra: { position: 'absolute', left: 0, textAlign: 'right' },
  butaca: {
    position: 'absolute',
    // Centra el contenido sin tocar el posicionamiento absoluto.
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  numero: { includeFontPadding: false, textAlign: 'center' },
  panel: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  ctrl: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
  },
  ctrlUltimo: { height: 38, borderBottomWidth: 0 },
  ctrlPress: { opacity: 0.55 },
  ctrlTxt: { fontSize: 19, lineHeight: 22, includeFontPadding: false },
  ctrlTxtChico: { fontSize: 13, lineHeight: 16 },
  pct: { height: 26, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1 },
  pctTxt: { fontSize: 10.5, includeFontPadding: false },
  aviso: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
  },
  avisoTxt: { fontSize: 12.5, fontWeight: '500', includeFontPadding: false },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 16 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leyendaDot: { width: 12, height: 12, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  leyendaGlifo: { fontSize: 9, lineHeight: 10, includeFontPadding: false },
  leyendaTxt: { fontSize: 11.5, opacity: 0.9 },
});

export type { PlanoSala };
