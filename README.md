# @multiplex/seatmap

Mapa de butacas de cine que dibuja la **geometría real de la sala** —las coordenadas X/Y que
entrega el POS— en vez de empaquetarla en una grilla.

Núcleo puro (sin React) + dos renderers: **web** (React DOM) y **native** (React Native).

---

## Por qué no es una grilla

Casi todas las librerías de butacas modelan `rows: Array<Array<butaca | null>>`, donde cada
`null` es exactamente **un** lugar. Eso no puede representar una sala real. Sobre un barrido de
**28 salas** de 4 cines:

| Lo que pasa de verdad | Por qué una grilla no lo puede expresar |
|---|---|
| El paso en X (30-33) **no** es el de Y (22-33) | Con la butaca cuadrada, cada fila se monta sobre la siguiente |
| **15 de 28 salas** mandan filas partidas en dos alturas | Una fila a dos alturas no es una fila de la grilla |
| Un pasillo central de **4,4 anchos** de butaca | No se pueden poner 4,4 lugares vacíos |
| Una sala con **293 butacas y 30 alturas para 15 filas** | El agrupado por Y exacto explota |

⚠️ **Si vas a comparar esto contra otra librería, no uses una sala inventada.** Una sala de
grilla perfecta (8×12 con pasillo al medio) hace que cualquier candidato se vea bien y la
comparación no discrimina nada. Probá con una sala partida y con pasillos fraccionarios.

---

## Instalación

El paquete se publica como **fuente TypeScript** (sin build): lo transpila el bundler del
consumidor, igual que cualquier archivo del proyecto.

```bash
npm install github:<org>/multiplex-seatmap    # o file:../multiplex-seatmap
```

En este workspace se consume por **junction + alias**. Ejemplos abajo.

### Vite

```ts
// vite.config.ts
resolve: {
  alias: {
    // ⚠️ El más específico PRIMERO: Vite matchea en orden y la raíz se comería el subpath.
    '@multiplex/seatmap/web': path.resolve(__dirname, '../multiplex-seatmap/src/web/index.tsx'),
    '@multiplex/seatmap':     path.resolve(__dirname, '../multiplex-seatmap/src/index.ts'),
  },
},
server: {
  // Si el paquete queda fuera de la raíz del proyecto, el dev server lo bloquea
  // (el build anda igual, así que el síntoma aparece SOLO en dev).
  fs: { allow: ['.', path.resolve(__dirname, '../multiplex-seatmap')] },
}
```

### Metro (React Native / Expo)

```js
// metro.config.js — Metro no sigue junctions durante el crawl: usá la ruta REAL.
let SEATMAP = path.resolve(projectRoot, '../multiplex-seatmap');
try { SEATMAP = fs.realpathSync(SEATMAP); } catch {}

config.watchFolders = [...config.watchFolders, SEATMAP];
// en resolveRequest:
if (m === '@multiplex/seatmap') return resolveFile(path.join(SEATMAP, 'src'));
if (m.startsWith('@multiplex/seatmap/')) return resolveFile(path.join(SEATMAP, 'src', m.slice(19)));
```

Y en `tsconfig.json`, `paths` apuntando a `../multiplex-seatmap/src/*`.

---

## Uso

```tsx
import { SeatMap, SeatMapView, SeatMapLeyenda } from '@multiplex/seatmap/web'
// import { SeatMap, SeatMapView } from '@multiplex/seatmap/native'

// Solo vista: no acepta selección ni handlers.
<SeatMapView filas={filas} />

// Con selección.
<SeatMap
  filas={filas}
  elegidas={elegidas}
  onToggle={(butaca) => toggle(butaca.n)}
  onRechazo={(motivo) => avisar(motivo)}   // 'vendida' | 'bloqueada' | 'limite'
  reglas={{ max: 8 }}
/>
```

**Son dos componentes a propósito.** `SeatMapView` no tiene forma de volverse interactivo: si
lo que querés es mostrar ocupación, no podés cablear un handler sin querer.

### La forma del dato

```ts
type FilaButacas = { fila: string; y: number; butacas: Butaca[] }
type Butaca = {
  n: string          // etiqueta del POS: '<fila>-<numero>' → 'E-1', '1-16'
  x: number; y: number
  s: 'libre' | 'vendida' | 'bloqueada'
  t: number          // 1 = accesible
  fila?: string      // opcionales: pisan el parseo de `n`
  numero?: string
}
```

`x`/`y` son las coordenadas **crudas** del POS. No las normalices: es la geometría de la sala.

---

## Responsive

La decisión responsive es una sola, `ajuste`:

| | `'ancho'` | `'tactil'` |
|---|---|---|
| Qué garantiza | la sala **entra completa**, sin scroll | la butaca **nunca baja de `minSeat`** (default 28 px) |
| A cambio | en un celular la butaca puede quedar en 10 px | si no entra, **scrollea en horizontal** |
| Para | **mirar** ocupación | **elegir** butacas |
| Default en | `<SeatMapView>` | `<SeatMap>` |

Cuando scrollea, **el gutter de las letras de fila queda fijo** y solo se mueve la zona de
butacas: en un celular no perdés la referencia de fila mientras paneás.

🔴 **El tamaño de la butaca se DERIVA de la escala, nunca se clampea aparte.** Clampearlo por
separado es lo que hace que en un contenedor angosto la butaca crezca hasta un mínimo mientras
la separación sigue achicándose — y se pisan entre sí. Derivándolo, el ancho de la butaca es
`llenado` (< 1) veces la celda, así que no puede tapar a la de al lado. Hay tests que lo fijan
a 180, 240, 320, 420 y 768 px.

El **número de butaca se apaga solo** por debajo de 11×9 px (`mostrarNumeros: 'auto'`): a esa
escala el dígito no se lee y solo ensucia el color, que es la señal que de verdad se usa.

---

## Tema

El paquete **no importa el design system de ninguna app**: la paleta va por prop y se mergea
sobre `TEMA_DEFAULT`.

```tsx
<SeatMap filas={filas} tema={{ elegida: 'var(--brand)', vendida: 'var(--rule)' }} />
```

Recomendación: atá los **neutros** (`vendida`, `bloqueada`, `rotulo`, `pantalla`) al tema del
host para que sigan light/dark solos, y dejá **fijos** los semánticos (`libre`, `elegida`,
`accesible`) — tienen que significar lo mismo en los dos temas. Ojo con reusar un `--brand`
rojo para «elegida»: sobre una butaca se lee como «ocupada».

Cada fondo tiene su tinta (`tintaLibre`, `tintaVendida`, …) porque el número tiene que
contrastar contra **cada** estado, no contra uno.

---

## Núcleo puro

Si solo necesitás la geometría (render en canvas/SVG, cálculo en el server, tests):

```ts
import { calcularPlano, puedeElegir, parseEtiqueta } from '@multiplex/seatmap'

const plano = calcularPlano(filas, { width: 800, ajuste: 'tactil', minSeat: 28 })
// → { lineas: [{ letra, top, butacas: [{ n, fila, numero, left, top, estado, accesible }] }],
//     w, h, alto, ancho, redondeo, fuenteLetra, fuenteNumero, numerosLegibles, desborda }
```

No le queda ninguna decisión de geometría al renderer: solo pinta rectángulos.

### Lo que resuelve el motor, y que se paga caro si no

- **Líneas visuales.** Una fila puede venir partida en Y por 1-2 px, y el anexo accesible puede
  no compartir la Y exacta de su fila. Agrupar por Y exacto dibuja renglones fantasma y apila
  dos letras en el mismo lugar. Se agrupan las Y cercanas con tolerancia `0,35 × pasoX`.
- **Paso medido por altura exacta.** Butacas con la misma Y son de la misma línea sí o sí, así
  que el paso sale de ahí y no del agrupado del servidor — que puede venir mal.
- **Fila y número desde la etiqueta.** `parseEtiqueta('1-16')` acepta fila **letra o número**.
  Si el backend deduce la fila con un `^([A-Za-z]+)` y manda `"?"`, la etiqueta la salva.
- **`ButacaPlano.fila` ≠ `LineaPlano.letra`.** El anexo accesible se **dibuja** en la línea
  rotulada `H` pero su fila es `Z`, y el ticket tiene que decir `Z`. Uno es rótulo visual, el
  otro es identidad.
- **Butaca rectangular.** Ancho del paso en X, alto del de Y. Cuadrada, las filas se montan.

---

## Desarrollo

```bash
npm install
npm test          # vitest — 75 tests
npm run typecheck
```

Los tests **codifican salas reales por nombre** (fila numérica, filas partidas, pasillo
horizontal, anexo accesible) más el invariante «ninguna fila se monta sobre la siguiente» a
varios anchos. Si aparece una sala que rompe el dibujo, el caso se escribe ahí.

> `src/native` queda **fuera** del `typecheck` de este repo: verificarlo pediría instalar
> `react-native` (~100 MB) para un solo archivo. Lo typechea la app RN que lo consume.
