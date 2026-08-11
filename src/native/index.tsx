/**
 * Renderer REACT NATIVE del mapa de butacas.
 *
 * Mismo contrato que el renderer web (`../web`): la geometría vive en `../core`
 * y acá solo se pinta. Si cambiás uno, mirá el otro.
 *
 * Diferencia con el web: acá el ancho NO se mide con ResizeObserver sino con
 * `onLayout`. Podés pasarlo por prop (`width`) si el contenedor ya lo sabe.
 *
 * RESPONSIVE: en modo táctil, cuando la sala no entra, la zona de butacas va
 * dentro de un ScrollView horizontal y el gutter de las letras queda FIJO — así
 * no perdés la referencia de fila mientras paneás.
 */

import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { calcularPlano, puedeElegir, TEMA_DEFAULT } from '../core';
import type {
  AjusteEscala,
  Butaca,
  EstadoButaca,
  FilaButacas,
  MotivoRechazo,
  ReglasSeleccion,
  TemaButacas,
} from '../core';

const LABEL_W = 20;
/** Lado mínimo de la butaca cuando hay que TOCARLA con el dedo. */
const MIN_TACTIL = 28;

export interface PropsVista {
  filas: FilaButacas[];
  /** Ancho disponible. Si no viene, se mide con `onLayout`. */
  width?: number;
  /**
   * Cómo se elige la escala. Default: `'ancho'` en solo vista y `'tactil'`
   * cuando el mapa es interactivo.
   */
  ajuste?: AjusteEscala;
  /** Lado mínimo de la butaca en modo táctil. Default 28. */
  minSeat?: number;
  maxSeat?: number;
  /** Número dentro de la butaca. `'auto'` (default) según si entra. */
  mostrarNumeros?: boolean | 'auto';
  /** Paleta. Se mergea sobre `TEMA_DEFAULT`. */
  tema?: Partial<TemaButacas>;
  /** Texto de la barra superior. `null` la esconde. */
  rotuloPantalla?: string | null;
}

export interface PropsSeleccion extends PropsVista {
  elegidas?: readonly string[];
  onToggle?: (butaca: Butaca) => void;
  onRechazo?: (motivo: MotivoRechazo, butaca: Butaca) => void;
  reglas?: ReglasSeleccion;
}

function SeatMapBase({
  filas,
  width,
  ajuste,
  minSeat = MIN_TACTIL,
  maxSeat,
  mostrarNumeros = 'auto',
  tema,
  rotuloPantalla = 'PANTALLA',
  elegidas,
  onToggle,
  onRechazo,
  reglas,
}: PropsSeleccion) {
  const [medido, setMedido] = useState(0);
  const ancho = width ?? medido;

  const interactivo = !!onToggle;
  const modo: AjusteEscala = ajuste ?? (interactivo ? 'tactil' : 'ancho');
  const t = useMemo(() => ({ ...TEMA_DEFAULT, ...tema }), [tema]);

  const plano = useMemo(
    () => calcularPlano(filas, { width: ancho, ajuste: modo, labelWidth: LABEL_W, minSeat, maxSeat }),
    [filas, ancho, modo, minSeat, maxSeat],
  );

  const porId = useMemo(() => {
    const m = new Map<string, Butaca>();
    for (const f of filas) for (const b of f.butacas) m.set(b.n, b);
    return m;
  }, [filas]);

  const elegidasSet = useMemo(() => (elegidas ? new Set(elegidas) : null), [elegidas]);

  const onLayout = (e: LayoutChangeEvent) => setMedido(e.nativeEvent.layout.width);

  const handlePress = (n: string) => {
    const b = porId.get(n);
    if (!b || !onToggle) return;
    // Deseleccionar siempre se puede; solo se valida el alta.
    if (elegidasSet?.has(n)) return onToggle(b);
    const r = puedeElegir(b, elegidas ?? [], reglas);
    if (r.ok) onToggle(b);
    else if (r.motivo) onRechazo?.(r.motivo, b);
  };

  const conNumeros = mostrarNumeros === 'auto' ? !!plano?.numerosLegibles : !!mostrarNumeros;

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

  const butacas = plano
    ? plano.lineas.flatMap((l) =>
        l.butacas.map((b) => {
          const elegida = elegidasSet?.has(b.n) ?? false;
          const estilo = [
            styles.butaca,
            {
              // `left` viene con el gutter incluido; acá el gutter es otro nodo.
              left: b.left - plano.labelWidth,
              top: b.top,
              width: plano.w,
              height: plano.h,
              borderRadius: plano.redondeo,
              backgroundColor: fondo(b.estado, elegida),
            },
            // Butaca accesible: anillo. No cambia el estado, lo anota.
            b.accesible && {
              borderWidth: Math.max(1, plano.h * 0.16),
              borderColor: t.accesible,
            },
          ];

          // La condición accesible viaja en el texto: el anillo no se lee con un
          // lector de pantalla.
          const etiqueta =
            `Fila ${b.fila}, butaca ${b.numero}` +
            (b.accesible ? ', accesible' : '') +
            `, ${elegida ? 'elegida' : b.estado}`;

          const numero = conNumeros ? (
            <Text
              style={[
                styles.numero,
                { fontSize: plano.fuenteNumero, color: tinta(b.estado, elegida) },
              ]}
            >
              {b.numero}
            </Text>
          ) : null;

          if (!interactivo) {
            return (
              <View key={b.n} style={estilo} accessibilityLabel={etiqueta}>
                {numero}
              </View>
            );
          }

          return (
            <Pressable
              key={b.n}
              style={estilo}
              onPress={() => handlePress(b.n)}
              accessibilityRole="button"
              accessibilityState={{ selected: elegida, disabled: b.estado !== 'libre' }}
              accessibilityLabel={etiqueta}
            >
              {numero}
            </Pressable>
          );
        }),
      )
    : null;

  const zona = plano && (
    <View
      style={{ position: 'relative', height: plano.alto, width: plano.ancho - plano.labelWidth }}
    >
      {butacas}
    </View>
  );

  return (
    <View onLayout={onLayout}>
      {rotuloPantalla !== null && (
        <View style={styles.pantallaWrap}>
          <View style={[styles.pantalla, { backgroundColor: t.pantalla }]} />
          <Text style={[styles.pantallaTxt, { color: t.rotulo }]}>{rotuloPantalla}</Text>
        </View>
      )}

      {plano && (
        // Gutter fijo + zona de butacas scrolleable. Separarlos es lo que hace
        // que no pierdas la fila mientras paneás en horizontal.
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ width: plano.labelWidth, height: plano.alto }}>
            {plano.lineas.map((l) => (
              <Text
                key={`f${l.top}`}
                style={[
                  styles.letra,
                  {
                    top: l.top,
                    width: plano.labelWidth - 5,
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
          </View>

          {plano.desborda ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              {zona}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>{zona}</View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Mapa de butacas **solo vista**. No acepta selección ni handlers — no se puede
 * volver interactivo sin cambiar de componente.
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
    <View style={styles.leyenda}>
      <Item color={t.libre} label="Libre" />
      {conSeleccion && <Item color={t.elegida} label="Elegida" />}
      <Item color={t.vendida} label="Vendida" />
      {/* La bloqueada solo se explica si existe: si no hay ninguna, es ruido. */}
      {bloqueadas > 0 && <Item color={t.bloqueada} label="Bloqueada" />}
      <Item color="transparent" label="Accesible" ring={t.accesible} />
    </View>
  );
}

function Item({ color, label, ring }: { color: string; label: string; ring?: string }) {
  return (
    <View style={styles.leyendaItem}>
      <View
        style={[
          styles.leyendaDot,
          { backgroundColor: color },
          ring && { borderWidth: 2, borderColor: ring },
        ]}
      />
      <Text style={styles.leyendaTxt}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pantallaWrap: { marginBottom: 16 },
  pantalla: { height: 6, borderRadius: 999, marginHorizontal: 8 },
  pantallaTxt: { textAlign: 'center', fontSize: 9, letterSpacing: 2, marginTop: 6 },
  letra: { position: 'absolute', left: 0, textAlign: 'right' },
  butaca: {
    position: 'absolute',
    // Centra el número sin tocar el posicionamiento absoluto.
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  numero: { includeFontPadding: false },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 16 },
  leyendaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leyendaDot: { width: 11, height: 11, borderRadius: 3 },
  leyendaTxt: { fontSize: 11.5, opacity: 0.8 },
});
