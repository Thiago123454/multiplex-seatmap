/**
 * Los casos de este archivo NO son inventados: reproducen las patologías
 * medidas en el barrido `GetSeats` de las 28 salas de los 4 cines alcanzables
 * (2026-07-30). Cada `describe` nombra la sala real que lo motivó.
 *
 * Si algún día se agrega una sala que rompe el dibujo, el lugar donde se
 * escribe el caso es acá.
 */

import { describe, it, expect } from 'vitest';
import {
  calcularPlano,
  agruparPorAltura,
  agruparEnLineas,
  pasoEnX,
  mediana,
  TOL_LINEA,
} from './layout';
import type { Butaca, FilaButacas } from './types';

/** Arma una fila del POS con butacas equiespaciadas o en las X que le pases. */
function fila(
  letra: string,
  y: number,
  xs: number[],
  opts: { estado?: Butaca['s']; accesible?: boolean } = {},
): FilaButacas {
  return {
    fila: letra,
    y,
    butacas: xs.map((x, i) => ({
      n: `${letra}-${i + 1}`,
      x,
      y,
      s: opts.estado ?? 'libre',
      t: opts.accesible ? 1 : 0,
    })),
  };
}

/** X equiespaciadas: `serie(100, 30, 4)` → [100, 130, 160, 190]. */
const serie = (desde: number, paso: number, n: number) =>
  Array.from({ length: n }, (_, i) => desde + i * paso);

const ANCHO = 360;

describe('mediana', () => {
  it('devuelve 1 sobre vacío (no rompe la escala)', () => {
    expect(mediana([])).toBe(1);
  });

  it('no la desvirtúa un outlier, que es para lo que está', () => {
    // El salto del pasillo (58) contra filas de 23: un promedio daría 30,75.
    expect(mediana([23, 23, 23, 58])).toBe(23);
  });
});

describe('sala regular', () => {
  // 14 butacas por fila: una fila de cine de verdad. Con filas cortas la sala
  // entra tan holgada que los DOS lados se topan contra el techo de 18 px y la
  // butaca vuelve a ser cuadrada — cierto, pero no prueba nada.
  const filas = [
    fila('A', 100, serie(100, 32, 14)),
    fila('B', 123, serie(100, 32, 14)),
    fila('C', 146, serie(100, 32, 14)),
  ];

  it('devuelve una línea por fila', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas.map((l) => l.letra)).toEqual(['A', 'B', 'C']);
  });

  it('🔴 la butaca es RECTANGULAR cuando el paso en X no es el de Y', () => {
    // Paso X = 32, paso Y = 23. Dibujarla cuadrada monta las filas.
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.w).toBeGreaterThan(p.h);
  });

  it('la primera línea arranca en 0 y las butacas respetan el gutter', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas[0].top).toBe(0);
    expect(p.lineas[0].butacas[0].left).toBe(p.labelWidth);
  });

  it('el plano entra en el ancho disponible', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.ancho).toBeLessThanOrEqual(ANCHO);
  });

  it('conserva estado y accesibilidad de cada butaca', () => {
    const conVendida = [
      fila('A', 100, serie(100, 32, 3)),
      fila('Z', 123, serie(100, 32, 2), { estado: 'vendida', accesible: true }),
    ];
    const p = calcularPlano(conVendida, { width: ANCHO })!;
    const z = p.lineas[1].butacas;
    expect(z.every((b) => b.estado === 'vendida')).toBe(true);
    expect(z.every((b) => b.accesible)).toBe(true);
  });
});

describe('Belgrano — el `SeatNumber` numérico mete toda la sala en una fila «?»', () => {
  // El relay deduce la fila con ^([A-Za-z]+) sobre el SeatNumber; con «1-16» no
  // matchea y cae al fallback «?». 7 de las 10 salas de Belgrano.
  // Las filas van corridas 1 unidad entre sí, que es lo que hace fallar a quien
  // mida el paso DENTRO de la fila.
  const todoEnUnaFila: FilaButacas = {
    fila: '?',
    y: 0,
    butacas: [
      ...serie(100, 30, 4).map((x, i) => ({ n: `1-${i + 1}`, x, y: 100, s: 'libre' as const, t: 0 })),
      ...serie(101, 30, 4).map((x, i) => ({ n: `2-${i + 1}`, x, y: 124, s: 'libre' as const, t: 0 })),
      ...serie(100, 30, 4).map((x, i) => ({ n: `3-${i + 1}`, x, y: 148, s: 'libre' as const, t: 0 })),
    ],
  };

  it('midiendo por ALTURA EXACTA el paso sale 30', () => {
    expect(pasoEnX(agruparPorAltura(todoEnUnaFila.butacas))).toBe(30);
  });

  it('midiendo dentro de la fila saldría 1 — el bug que esto evita', () => {
    // Reproduce el criterio equivocado: ordenar todas las X de la fila juntas.
    const xs = todoEnUnaFila.butacas.map((b) => b.x).sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) diffs.push(xs[i] - xs[i - 1]);
    expect(mediana(diffs)).toBe(1);
  });

  it('el mapa se dibuja igual: 3 líneas, no una sola ni una por butaca', () => {
    const p = calcularPlano([todoEnUnaFila], { width: ANCHO })!;
    expect(p.lineas).toHaveLength(3);
  });

  it('la butaca no queda aplastada al mínimo', () => {
    // Con pitchX = 1 la escala explota y w cae al piso: es el síntoma visible.
    const p = calcularPlano([todoEnUnaFila], { width: ANCHO })!;
    expect(p.w).toBeGreaterThan(5);
  });
});

describe('Lavalle Sala 2 (4D) — TODAS las filas partidas en dos alturas', () => {
  // Bloque izquierdo a Y, bloque derecho a Y+1, y un pasillo central ancho.
  const filas = [
    { ...fila('A', 100, serie(100, 30, 4)) },
    { ...fila('A2', 101, serie(352, 30, 8)) }, // +4,4 anchos de pasillo
    { ...fila('B', 130, serie(100, 30, 4)) },
    { ...fila('B2', 131, serie(352, 30, 8)) },
  ];

  it('cada fila colapsa en UNA línea visual, no dos', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas).toHaveLength(2);
  });

  it('los dos bloques de una fila quedan a la MISMA altura dibujada', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    const tops = new Set(p.lineas[0].butacas.map((b) => b.top));
    expect(tops.size).toBe(1);
  });

  it('el pasillo central sobrevive como hueco real, no como butacas pegadas', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    const xs = p.lineas[0].butacas.map((b) => b.left).sort((a, b) => a - b);
    const saltos = xs.slice(1).map((x, i) => x - xs[i]);
    // El salto del pasillo tiene que ser netamente mayor que el paso normal.
    expect(Math.max(...saltos)).toBeGreaterThan(Math.min(...saltos) * 2);
  });
});

describe('Canning Sala 4 — el pasillo horizontal NO es una frontera de línea', () => {
  // Filas cada 23; entre E y F hay un salto de 58 (el pasillo).
  const filas = [
    fila('C', 100, serie(100, 32, 6)),
    fila('D', 123, serie(100, 32, 6)),
    fila('E', 146, serie(100, 32, 6)),
    fila('F', 204, serie(100, 32, 6)), // +58
    fila('G', 227, serie(100, 32, 6)),
  ];

  it('el pasillo no colapsa los bloques: siguen siendo 5 líneas', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas.map((l) => l.letra)).toEqual(['C', 'D', 'E', 'F', 'G']);
  });

  it('y queda dibujado como más aire entre E y F', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    const tops = p.lineas.map((l) => l.top);
    const salto = tops[3] - tops[2];
    const normal = tops[1] - tops[0];
    expect(salto).toBeGreaterThan(normal * 2);
  });
});

describe('Canning Sala 5 — el anexo accesible comparte línea con su fila', () => {
  // La Z (2 accesibles) está en Y=366 y la I (14 butacas) en Y=370: misma línea
  // física. Agrupando por Y exacto salían dos renglones y dos letras apiladas.
  const filas = [
    fila('I', 370, serie(100, 32, 14)),
    fila('Z', 366, serie(548, 32, 2), { accesible: true }),
    fila('J', 393, serie(100, 32, 14)),
  ];

  it('la I y la Z caen en la MISMA línea', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas).toHaveLength(2);
    expect(p.lineas[0].butacas).toHaveLength(16);
  });

  it('se rotula «I», que es la fila que más aporta', () => {
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas[0].letra).toBe('I');
  });

  it('la línea se dibuja a la Y del grueso, así el cuerpo de la fila no se mueve', () => {
    const porAltura = agruparPorAltura(filas.flatMap((f) => f.butacas));
    const lineas = agruparEnLineas(filas, porAltura, pasoEnX(porAltura));
    expect(lineas[0].y).toBe(370); // la de la I (14), no la de la Z (2)
  });
});

describe('TOL_LINEA — el corte que separa el ruido de una fila real', () => {
  it('0,35 deja margen de los dos lados', () => {
    // Ruido medido: hasta ~0,2 del paso. Filas reales: nunca menos de ~0,7.
    expect(TOL_LINEA).toBeGreaterThan(0.2);
    expect(TOL_LINEA).toBeLessThan(0.7);
  });
});

describe('cada butaca discrimina fila y número', () => {
  it('los saca de la etiqueta `n`', () => {
    const p = calcularPlano([fila('C', 100, serie(100, 32, 3))], { width: ANCHO })!;
    expect(p.lineas[0].butacas.map((b) => [b.fila, b.numero])).toEqual([
      ['C', '1'],
      ['C', '2'],
      ['C', '3'],
    ]);
  });

  it('lo explícito de la butaca le gana al parseo', () => {
    const f: FilaButacas = {
      fila: 'C',
      y: 100,
      butacas: [{ n: 'C-1', x: 100, y: 100, s: 'libre', t: 0, fila: 'VIP', numero: '99' }],
    };
    const p = calcularPlano([f], { width: ANCHO })!;
    expect(p.lineas[0].butacas[0]).toMatchObject({ fila: 'VIP', numero: '99' });
  });

  it('sin etiqueta parseable, el número cae al ordinal dentro de la línea', () => {
    const f: FilaButacas = {
      fila: 'C',
      y: 100,
      // Sin dígitos: no matchean ni el separador ni el fallback de etiqueta pegada.
      butacas: [
        { n: 'ccc', x: 164, y: 100, s: 'libre', t: 0 },
        { n: 'aaa', x: 100, y: 100, s: 'libre', t: 0 },
        { n: 'bbb', x: 132, y: 100, s: 'libre', t: 0 },
      ],
    };
    const p = calcularPlano([f], { width: ANCHO })!;
    // Ordinal por X creciente, no por el orden del array.
    const porN = new Map(p.lineas[0].butacas.map((b) => [b.n, b.numero]));
    expect([porN.get('aaa'), porN.get('bbb'), porN.get('ccc')]).toEqual(['1', '2', '3']);
    // La fila igual sale del agrupado del servidor.
    expect(p.lineas[0].butacas.every((b) => b.fila === 'C')).toBe(true);
  });

  it('🔴 Belgrano: con `fila: "?"` del relay, la etiqueta salva el rótulo', () => {
    // El relay manda toda la sala en una fila «?»; las etiquetas «1-16» sí traen
    // la fila. Antes el gutter mostraba «?» en todas las líneas.
    const todoEnUnaFila: FilaButacas = {
      fila: '?',
      y: 0,
      butacas: [
        ...serie(100, 30, 4).map((x, i) => ({ n: `1-${i + 1}`, x, y: 100, s: 'libre' as const, t: 0 })),
        ...serie(101, 30, 4).map((x, i) => ({ n: `2-${i + 1}`, x, y: 124, s: 'libre' as const, t: 0 })),
      ],
    };
    const p = calcularPlano([todoEnUnaFila], { width: ANCHO })!;
    expect(p.lineas.map((l) => l.letra)).toEqual(['1', '2']);
    expect(p.lineas[0].butacas[0]).toMatchObject({ fila: '1', numero: '1' });
    expect(p.lineas[1].butacas[3]).toMatchObject({ fila: '2', numero: '4' });
  });

  it('el anexo accesible conserva SU fila aunque se dibuje en la línea de otra', () => {
    // La Z se dibuja en la línea rotulada «I», pero el ticket dice «Z».
    const filas = [
      fila('I', 370, serie(100, 32, 14)),
      fila('Z', 366, serie(548, 32, 2), { accesible: true }),
    ];
    const p = calcularPlano(filas, { width: ANCHO })!;
    expect(p.lineas[0].letra).toBe('I');
    const zetas = p.lineas[0].butacas.filter((b) => b.accesible);
    expect(zetas.map((b) => b.fila)).toEqual(['Z', 'Z']);
    expect(zetas.map((b) => b.n)).toEqual(['Z-1', 'Z-2']);
  });

  it('a escala de «ver la sala entera» los números se apagan solos', () => {
    // Sala grande en poco ancho ⇒ butaca chica ⇒ el dígito no se leería.
    const grande = Array.from({ length: 20 }, (_, i) =>
      fila('ABCDEFGHIJKLMNOPQRST'[i], 100 + i * 23, serie(100, 30, 30)),
    );
    const p = calcularPlano(grande, { width: 300 })!;
    expect(p.numerosLegibles).toBe(false);
  });

  it('y se prenden cuando la butaca da el ancho', () => {
    const p = calcularPlano(
      [fila('A', 100, serie(100, 32, 8)), fila('B', 123, serie(100, 32, 8))],
      { width: 700, maxSeat: 26 },
    )!;
    expect(p.numerosLegibles).toBe(true);
    expect(p.fuenteNumero).toBeGreaterThan(6);
  });
});

describe('invariante: ninguna fila se monta sobre la siguiente', () => {
  // Es el síntoma que motivó la butaca rectangular: si el alto de la butaca
  // supera la separación dibujada entre líneas, el mapa se ve como una mancha
  // de rayas verticales. Se chequea sobre todas las salas patológicas de arriba
  // y a varios anchos, porque el clamp de 5..18 px cambia con la escala.
  const salas: Record<string, FilaButacas[]> = {
    regular: [
      fila('A', 100, serie(100, 32, 14)),
      fila('B', 123, serie(100, 32, 14)),
      fila('C', 146, serie(100, 32, 14)),
    ],
    'con pasillo (Canning 4)': [
      fila('C', 100, serie(100, 32, 12)),
      fila('D', 123, serie(100, 32, 12)),
      fila('E', 146, serie(100, 32, 12)),
      fila('F', 204, serie(100, 32, 12)),
    ],
    'filas partidas (Lavalle 2)': [
      fila('A', 100, serie(100, 30, 4)),
      fila('A2', 101, serie(352, 30, 8)),
      fila('B', 130, serie(100, 30, 4)),
      fila('B2', 131, serie(352, 30, 8)),
    ],
  };

  for (const [nombre, filas] of Object.entries(salas)) {
    for (const width of [200, 360, 800, 1400]) {
      it(`${nombre} @ ${width}px`, () => {
        const p = calcularPlano(filas, { width })!;
        const tops = p.lineas.map((l) => l.top);
        for (let i = 1; i < tops.length; i++) {
          expect(p.h).toBeLessThanOrEqual(tops[i] - tops[i - 1]);
        }
      });
    }
  }
});

describe('bordes', () => {
  it('sala vacía → null', () => {
    expect(calcularPlano([], { width: ANCHO })).toBeNull();
  });

  it('fila sin butacas → null', () => {
    expect(calcularPlano([fila('A', 0, [])], { width: ANCHO })).toBeNull();
  });

  it('contenedor todavía sin medir (width 0) → null', () => {
    // Es el primer render real, antes del onLayout.
    expect(calcularPlano([fila('A', 100, serie(100, 32, 4))], { width: 0 })).toBeNull();
  });

  it('una sola butaca no rompe la escala', () => {
    const p = calcularPlano([fila('A', 100, [100])], { width: ANCHO });
    expect(p).not.toBeNull();
    expect(Number.isFinite(p!.w)).toBe(true);
    expect(p!.w).toBeGreaterThan(0);
  });

  it('una sola línea usa el paso de X para el alto (no hay dy que medir)', () => {
    const p = calcularPlano([fila('A', 100, serie(100, 32, 6))], { width: ANCHO })!;
    expect(p.lineas).toHaveLength(1);
    expect(Number.isFinite(p.h)).toBe(true);
  });
});

describe('responsive: la escala manda, el tamaño se deriva', () => {
  /** Belgrano Sala 1 en un celular: 293 butacas, 15 filas de ~20. */
  const salaGrande = Array.from({ length: 15 }, (_, i) =>
    fila(String(i + 1), 100 + i * 23, serie(100, 30, 20)),
  );

  it('🔴 en `ancho` las butacas NUNCA se pisan, por chico que sea el contenedor', () => {
    // El bug que esto fija: si el lado de la butaca se clampea a un mínimo
    // mientras la separación sigue derivando de la escala, en un contenedor
    // angosto la butaca crece por encima de su celda y tapa a la de al lado.
    for (const width of [180, 240, 320, 420, 768]) {
      const p = calcularPlano(salaGrande, { width })!;
      const xs = p.lineas[0].butacas.map((b) => b.left).sort((a, b) => a - b);
      const gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
      expect(p.w, `width ${width}`).toBeLessThanOrEqual(gap);
    }
  });

  it('en `ancho` la sala entra completa y no desborda', () => {
    for (const width of [320, 768, 1400]) {
      const p = calcularPlano(salaGrande, { width })!;
      expect(p.ancho, `width ${width}`).toBeLessThanOrEqual(width);
      expect(p.desborda).toBe(false);
    }
  });

  it('en `tactil` la butaca respeta el piso aunque la sala no entre', () => {
    const p = calcularPlano(salaGrande, { width: 320, ajuste: 'tactil', minSeat: 28 })!;
    expect(Math.min(p.w, p.h)).toBeGreaterThanOrEqual(28);
    expect(p.desborda).toBe(true);
    expect(p.ancho).toBeGreaterThan(320);
  });

  it('el piso táctil le gana al techo: tocar > no agrandar de más', () => {
    const p = calcularPlano(salaGrande, {
      width: 320,
      ajuste: 'tactil',
      minSeat: 28,
      maxSeat: 18, // conflicto deliberado
    })!;
    expect(Math.min(p.w, p.h)).toBeGreaterThanOrEqual(28);
  });

  it('en `tactil` tampoco se pisan', () => {
    const p = calcularPlano(salaGrande, { width: 320, ajuste: 'tactil', minSeat: 28 })!;
    const xs = p.lineas[0].butacas.map((b) => b.left).sort((a, b) => a - b);
    const gap = Math.min(...xs.slice(1).map((x, i) => x - xs[i]));
    expect(p.w).toBeLessThanOrEqual(gap);
  });

  it('si la sala YA entra a tamaño táctil, no desborda', () => {
    const chica = [fila('A', 100, serie(100, 30, 4)), fila('B', 130, serie(100, 30, 4))];
    const p = calcularPlano(chica, { width: 900, ajuste: 'tactil', minSeat: 28 })!;
    expect(p.desborda).toBe(false);
  });

  it('el techo evita que en desktop la butaca se agrande al pedo', () => {
    const chica = [fila('A', 100, serie(100, 30, 4))];
    const p = calcularPlano(chica, { width: 1600, maxSeat: 18 })!;
    expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(18);
  });
});
