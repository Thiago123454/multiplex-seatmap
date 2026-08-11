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
import { TEMA_OSCURO } from '@multiplex/seatmap'
// import { SeatMap, SeatMapView } from '@multiplex/seatmap/native'

// Solo vista: no acepta selección ni handlers.
<SeatMapView filas={filas} />

// Con selección. `onToggle` recibe la butaca y la lista YA resuelta.
<SeatMap
  filas={filas}
  tema={TEMA_OSCURO}
  leyenda
  elegidas={elegidas}
  onToggle={(butaca, lista) => setElegidas(lista)}
  onRechazo={(motivo) => avisar(motivo)}   // 'vendida' | 'bloqueada' | 'limite' | 'hueco'
  reglas={{ max: 8 }}
/>
```

Sin `elegidas` el mapa **se maneja solo** (selección interna); con `elegidas` +
`onToggle` es controlado, como cualquier input de React.

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

## Responsive, zoom y gestos

La sala **siempre entra completa** a la escala base (`ajuste: 'ancho'`): nunca se
deforma nada para que algo «entre». Encima de eso va el zoom.

🔑 **El zoom es un `transform`, no un recálculo.** El plano se calcula UNA vez por
tamaño de contenedor (con `zoom: 1`) y el zoom/paneo es un `translate3d(...) scale()`
aplicado **imperativamente** sobre un solo nodo. Es exactamente lo mismo que el
multiplicador de escala del núcleo —los dos ejes por el mismo factor, así que la
proporción de la sala y los pasillos no se tocan— pero lo compone la GPU: un pinch
sobre 293 butacas no reconcilia 293 nodos de React por frame. React no participa
del gesto. `OpcionesPlano.zoom` sigue estando para render sin transform (server,
canvas, PDF).

| | |
|---|---|
| **100 %** | la sala entera (`zFit`) |
| **Techo** | la escala a la que la butaca llega a 46 px — el tamaño con el que un dedo no falla |
| **Gestos** | pinch, pan a un dedo, doble tap, ⌘/Ctrl + rueda para zoom, rueda para pan |
| **Dónde** | solo debajo de **768 px del ancho del PROPIO componente** (no del viewport) |

⚠️ **El componente se mide a sí mismo.** Si lo metés en una columna de 700 px
dentro de un desktop de 1400, se pone en modo mobile — con gestos y control de
zoom. Es lo correcto (se adapta a su caja), pero sorprende: si querés el modo
desktop, dale ancho o forzá `zoomControls={false}`.

**Tap sobre butaca chica = acercar, no elegir.** Con el dedo, por debajo de 22 px
un tap acerca esa zona hasta 38 px en vez de seleccionar: elegir a 8 px no es
elegir, es adivinar. 🔴 **Ese umbral NO se le aplica al mouse**: el cursor acierta
a 19 px y en desktop no hay control de zoom con el que agrandar — aplicárselo deja
la sala entera incliqueable en cuanto la butaca baja de 22 px, que es lo normal en
una sala de 293.

**La PANTALLA vive FUERA del área que se transforma.** Es la referencia física de
la sala: se acercan y panean las butacas, la pantalla se queda quieta, a todo el
ancho y arriba de todo. Se dibuja como un arco iluminado (`pantalla` acepta un
gradiente).

**Teclado: un solo tab stop.** Las 293 butacas no son 293 paradas de tabulación —
se entra una vez al mapa y adentro se navega con flechas (roving tabindex),
Enter/Espacio elige, `+`/`-`/`0` manejan el zoom. Al cambiar de fila se cae en la
butaca más cercana en X, no en el mismo índice: las filas tienen largos distintos.

**El número se apaga solo** cuando la butaca queda chica, y la decisión se toma al
**asentar** el gesto (130 ms de debounce), no por frame: a `≥ 17 px` de ancho entra
el código completo (`F12`), a `≥ 11 px` solo el número, y por debajo nada.

## No dejar una butaca suelta

`contarHuecos` cuenta las butacas libres que quedan **aisladas**: un solo lugar
vacío rodeado de ocupado/elegido o contra el borde de su bloque. Un hueco de uno
no lo compra nadie.

🔑 **Se usa comparando ANTES contra DESPUÉS y solo se rechaza si el número SUBE.**
La sala ya viene con huecos de otras ventas; rechazar por el total dejaría al que
vende sin poder elegir nada en una sala medio llena. `dejaButacaSuelta()` envuelve
esa comparación, que es la única forma correcta de usarlo.

Trabaja sobre las líneas ya resueltas a píxeles y no sobre las butacas crudas,
porque es ahí donde el **pasillo** se ve: dos butacas separadas por más de 1,7
anchos no son vecinas, así que la última butaca antes del pasillo no cuenta como
suelta. Se apaga con `sinHuecos={false}`.

## Tema

El paquete **no importa el design system de ninguna app**: la paleta va por prop y se mergea
sobre `TEMA_DEFAULT`.

```tsx
<SeatMap filas={filas} tema={{ elegida: 'var(--brand)', vendida: 'var(--rule)' }} />
```

Vienen dos temas armados: **`TEMA_DEFAULT`** (claro, el del ERP y el mapa del
acomodador) y **`TEMA_OSCURO`** (el del flujo de venta de entradas).

En el oscuro la butaca **disponible es un anillo sin relleno** (`libre:
'transparent'` + `libreBorde`) y la **elegida es maciza roja**: lo que se llena de
color es lo que ya es tuyo. Por eso el tema tiene `libre` y `libreBorde` separados.

La fuente va por tema (`fuente` / `fuenteDisplay`) y **la carga el host**: un
paquete no debería inyectar `<link>` a Google Fonts. El diseño usa Barlow y Barlow
Condensed; sin ellas cae al stack del sistema sin romper el layout.

Recomendación general: atá los **neutros** (`vendida`, `bloqueada`, `rotulo`,
`pantalla`, `panel`) al tema del host para que sigan light/dark solos, y dejá
**fijos** los semánticos (`libre`, `elegida`, `accesible`) — tienen que significar
lo mismo en los dos temas. Ojo con reusar un `--brand` rojo para «elegida» en una
app cuyo brand es rojo de peligro: sobre una butaca se lee como «ocupada».

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
