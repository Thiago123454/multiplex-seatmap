import { describe, expect, it } from 'vitest';
import {
  PINCH_MIN,
  fotoPinch,
  limitarZoom,
  pasoPinch,
  separacion,
  type FotoPinch,
  type TopesZoom,
} from './gesto';

/**
 * Salas de referencia. `zFit` es el 100 % de la UI (la sala entera entra) y
 * `zMax` el techo. Los dos valores salen de `derivar()` en los renderers; acá van
 * a mano para que el test sea sobre el GESTO y no sobre la geometría.
 */
const SALA: TopesZoom = { zFit: 1, zMax: 1.8 };
/** Sala grande en celular: mucho rango de zoom (zMax/zFit = 5.5). */
const CELULAR: TopesZoom = { zFit: 0.6, zMax: 3.3 };
/**
 * Visor ancho con la sala chica: `zFit` topa en `HOLGURA_FIT`, o sea que vale
 * MÁS que 1. Está en el set para que ningún test pueda pasar comparando contra
 * el literal 1 en vez de contra `zFit`.
 */
const HOLGURA: TopesZoom = { zFit: 1.35, zMax: 2.43 };

/**
 * El loop de pinch tal cual lo corren los dos renderers.
 *
 * El centro de los dedos va siempre en (0,0) y la foto arranca con el encuadre en
 * (0,0): así `x`/`y` se quedan en 0 y el test mira solo el zoom. El anclaje de
 * `x`/`y` se prueba aparte, con valores distintos en cada eje.
 */
function gesto(topes: TopesZoom, z0: number, d0: number) {
  const v = { x: 0, y: 0, z: z0 };
  let pin: FotoPinch = fotoPinch(d0, 0, 0, v);
  return {
    get z() {
      return v.z;
    },
    get pinD() {
      return pin.d;
    },
    /** Un frame del gesto con los dedos a `d`. */
    mover(d: number) {
      const paso = pasoPinch(pin, d, 0, 0, topes);
      v.x = paso.x;
      v.y = paso.y;
      v.z = paso.z;
      if (paso.mordio) pin = fotoPinch(d, 0, 0, v);
      return v.z;
    },
    /**
     * Cambió la CANTIDAD de dedos (bajó el segundo, se levantó uno de tres, se
     * soltó y se volvió a apoyar) o se redimensionó el visor con los dedos
     * puestos: foto nueva. Es `rebasePin()` en el web y `fotoPin()` vía `rebasar`
     * en el nativo.
     */
    reanclar(d: number) {
      pin = fotoPinch(d, 0, 0, v);
    },
    correr(ds: number[]) {
      return ds.map((d) => this.mover(d));
    },
  };
}

/**
 * El mismo loop ANTES de este commit, como oráculo de no-regresión.
 *
 * Es el código de `a6685bc` palabra por palabra: cociente crudo contra la foto,
 * clamp, y rebase entero cuando el clamp muerde — sin acotar la ganancia. Sirve
 * para dos cosas opuestas: probar que un pinch con los dedos bien separados quedó
 * BIT-idéntico, y probar que el gesto que el usuario reportó estaba roto.
 */
function gestoViejo(topes: TopesZoom, z0: number, d0: number) {
  const v = { z: z0 };
  let pin = { d: d0, z: z0 };
  return {
    get z() {
      return v.z;
    },
    get pinD() {
      return pin.d;
    },
    mover(d: number) {
      const bruto = pin.z * (d / pin.d);
      const z = Math.min(topes.zMax, Math.max(topes.zFit, bruto));
      v.z = z;
      if (Number.isFinite(bruto) && z !== bruto) pin = { d, z: v.z };
      return v.z;
    },
    reanclar(d: number) {
      pin = { d, z: v.z };
    },
    correr(ds: number[]) {
      return ds.map((d) => this.mover(d));
    },
  };
}

/** Separaciones de foto que hay que aguantar, de las yemas encimadas para arriba. */
const SEPARACIONES = [1, 3, 8, 12, 20, 30, 45, 55, PINCH_MIN, 57, 80, 150, 300];

describe('separacion', () => {
  it('mide la distancia entre los dos dedos', () => {
    expect(separacion(0, 0, 3, 4)).toBe(5);
  });

  it('nunca devuelve 0: dos contactos encimados dividirían por cero', () => {
    expect(separacion(120, 80, 120, 80)).toBe(1);
  });

  it('sanea NaN, que si no se propagaría a todo el encuadre', () => {
    expect(separacion(NaN, 0, 10, 0)).toBe(1);
  });
});

describe('limitarZoom', () => {
  it('devuelve EL MISMO double cuando no clampea (de eso depende `mordio`)', () => {
    const z = 1.2345678901234567;
    expect(Object.is(limitarZoom(z, SALA), z)).toBe(true);
  });

  it('recorta contra los dos topes', () => {
    expect(limitarZoom(0.2, SALA)).toBe(SALA.zFit);
    expect(limitarZoom(9, SALA)).toBe(SALA.zMax);
  });

  it('usa el `zFit` de la sala, que no siempre es 1', () => {
    expect(limitarZoom(1.1, HOLGURA)).toBe(HOLGURA.zFit);
    expect(limitarZoom(0.4, CELULAR)).toBe(CELULAR.zFit);
    expect(limitarZoom(9, HOLGURA)).toBe(HOLGURA.zMax);
  });
});

describe('la ganancia del gesto está acotada', () => {
  /**
   * 🔑 La propiedad que define el fix: abriendo los dedos desde la separación con
   * la que se tomó la foto, un píxel nunca puede valer más de 1/PINCH_MIN del
   * zoom. Es lo que hace que las yemas pegadas dejen de ser una singularidad.
   */
  it('un píxel nunca vale más de 1/PINCH_MIN, arranque la foto donde arranque', () => {
    for (const topes of [SALA, CELULAR, HOLGURA]) {
      for (const d0 of SEPARACIONES) {
        const z0 = (topes.zFit + topes.zMax) / 2; // lejos de los dos topes
        const pin = fotoPinch(d0, 0, 0, { x: 0, y: 0, z: z0 });
        let previo = pasoPinch(pin, d0, 0, 0, topes).z;
        for (let d = d0 + 1; d <= d0 + 200; d++) {
          const z = pasoPinch(pin, d, 0, 0, topes).z;
          if (z >= topes.zMax) break; // ya topó: el clamp manda, no la ganancia
          const ganancia = (z - previo) / previo;
          expect(ganancia).toBeLessThanOrEqual(1 / PINCH_MIN + 1e-12);
          previo = z;
        }
      }
    }
  });

  it('el gesto viejo NO la tenía acotada: con las yemas pegadas 1 px valía 8 %', () => {
    const pin = { d: 12, z: 1.4 };
    const zA = pin.z * (12 / pin.d);
    const zB = pin.z * (13 / pin.d);
    expect((zB - zA) / zA).toBeCloseTo(1 / 12, 10);
    expect(1 / 12).toBeGreaterThan(4 * (1 / PINCH_MIN));
  });
});

describe('con los dedos quietos el mapa no se mueve', () => {
  /**
   * 🔑 Es la propiedad que permite que el piso sea INCONDICIONAL. El intento
   * anterior lo aplicaba al `d` guardado y por eso tenía que preguntar si estabas
   * en el fondo: inflar la foto contra `zMax` hacía que el frame siguiente pidiera
   * menos zoom con los dedos quietos, y el mapa se alejaba solo.
   */
  it('`d === pin.d` devuelve EXACTAMENTE `pin.z`, en cualquier zoom y con cualquier separación', () => {
    for (const topes of [SALA, CELULAR, HOLGURA]) {
      for (const z0 of [topes.zFit, topes.zFit * 1.0000001, 1.45 * topes.zFit, topes.zMax]) {
        for (const d0 of SEPARACIONES) {
          const pin = fotoPinch(d0, 0, 0, { x: 0, y: 0, z: z0 });
          const paso = pasoPinch(pin, d0, 0, 0, topes);
          expect(Object.is(paso.z, z0)).toBe(true);
          expect(paso.mordio).toBe(false);
        }
      }
    }
  });

  it('sostener el pinch cerrado a fondo no mueve el zoom frame a frame', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr([200, 100, 40, 12]);
    expect(g.correr([12, 12, 12, 12])).toEqual([1, 1, 1, 1]);
  });
});

describe('el bug reportado: cerrar hasta tocarse las yemas y reabrir', () => {
  const CIERRE = [200, 150, 100, 60, 30, 12, 12];

  it('temblar 3 px con las yemas pegadas ya no vale +25 % de zoom', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr(CIERRE);
    // 3 px = 3/PINCH_MIN = 5.4 %, la cota, en vez del 25 % de antes.
    expect(g.mover(15)).toBeCloseTo(SALA.zFit * (1 + 3 / PINCH_MIN), 12);

    const viejo = gestoViejo(SALA, 1.6, 200);
    viejo.correr(CIERRE);
    expect(viejo.mover(15)).toBe(1.25);
  });

  it('reabrir ya no salta al tope en 18 px de dedo', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr(CIERRE);
    expect(g.mover(30)).toBeLessThan(SALA.zMax);

    const viejo = gestoViejo(SALA, 1.6, 200);
    viejo.correr(CIERRE);
    expect(viejo.mover(30)).toBe(SALA.zMax); // del 100 % al tope, 18 px
  });

  it('responde desde el primer píxel: no hay recorrido muerto', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr(CIERRE);
    expect(g.mover(13)).toBeGreaterThan(SALA.zFit);
  });

  it('con los dos toques exactamente encimados tampoco explota, y sin NaN', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr([200, 40, 10]);
    g.reanclar(separacion(300, 200, 300, 200)); // hypot 0 -> 1
    const z = g.correr([2, 5, 25, 40]);
    expect(z.every(Number.isFinite)).toBe(true);
    // Antes, con pin.d = 1, abrir 25 px pedía 25x y clavaba el tope al instante.
    expect(z[2]).toBeLessThan(SALA.zMax);
  });
});

describe('el fix vale a CUALQUIER altura de zoom, no solo contra el fondo', () => {
  /**
   * 🔴 Es lo que le faltaba al intento anterior, que ponía el piso sobre el `d`
   * guardado y solo cuando `z === zFit`. Con la vista adentro y la foto tomada
   * con los dedos pegados, el síntoma reportado volvía idéntico.
   */
  it('zoomeado adentro, re-anclar con los dedos pegados no devuelve la hipersensibilidad', () => {
    const g = gesto(SALA, 1.6, 200);
    g.mover(180); // z = 1.44: adentro, lejos de los dos topes
    g.reanclar(12); // se levantó un dedo y volvió a bajar pegado al otro
    expect(g.mover(15) / 1.44 - 1).toBeCloseTo(3 / PINCH_MIN, 10);

    const viejo = gestoViejo(SALA, 1.6, 200);
    viejo.mover(180);
    viejo.reanclar(12);
    expect(viejo.mover(15) / 1.44 - 1).toBeCloseTo(3 / 12, 10); // +25 %
  });

  it('en el fondo, soltar un dedo y volver a apoyarlo pegado tampoco', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr([200, 80, 30, 12]);
    g.reanclar(14);
    expect(g.mover(17) / SALA.zFit - 1).toBeCloseTo(3 / PINCH_MIN, 10);

    const viejo = gestoViejo(SALA, 1.6, 200);
    viejo.correr([200, 80, 30, 12]);
    viejo.reanclar(14);
    expect(viejo.mover(17)).toBeCloseTo(1.2142857142857142, 10);
  });

  it('el digitalizador que funde los dos contactos y los separa tampoco', () => {
    const g = gesto(CELULAR, 3.3, 120);
    g.correr([120, 60, 25, 8]);
    g.reanclar(8); // 2 dedos -> 1 -> 2, con las yemas todavía juntas
    const z = g.correr([11, 14, 20, 30]);
    z.forEach((zi) => expect(zi).toBeLessThan(CELULAR.zMax));
  });
});

describe('lo que arregló a6685bc no se rompe', () => {
  it('un pinch con los dedos bien separados queda BIT-idéntico', () => {
    for (const topes of [SALA, CELULAR, HOLGURA]) {
      for (const d0 of [PINCH_MIN, 57, 80, 150, 300]) {
        const ds = [d0, d0 * 1.1, d0 * 1.2, d0 * 1.3, d0 * 1.2, d0, d0 * 0.9];
        const z0 = (topes.zFit + topes.zMax) / 2;
        const nuevo = gesto(topes, z0, d0).correr(ds);
        const viejo = gestoViejo(topes, z0, d0).correr(ds);
        nuevo.forEach((z, i) => expect(Object.is(z, viejo[i])).toBe(true));
      }
    }
  });

  it('se sigue llegando a ver la sala entera, arranque donde arranque el gesto', () => {
    const chica = gesto(SALA, SALA.zMax, 50);
    chica.correr([45, 40, 35, 30, 25, 20, 15, 10]);
    expect(Object.is(chica.z, SALA.zFit)).toBe(true);

    const grande = gesto(CELULAR, CELULAR.zMax, 120);
    grande.correr([100, 80, 60, 40, 20, 12]);
    expect(Object.is(grande.z, CELULAR.zFit)).toBe(true);

    const ancha = gesto(HOLGURA, HOLGURA.zMax, 90);
    ancha.correr([70, 50, 30, 15, 6]);
    expect(Object.is(ancha.z, HOLGURA.zFit)).toBe(true);
  });

  it('no vuelve la energía guardada: reabrir no restituye el encuadre del arranque', () => {
    const g = gesto(CELULAR, 3.3, 120);
    g.correr([120, 90, 60, 40, 25, 12, 6, 6, 12, 25, 40, 60, 90]);
    // Con los dedos de vuelta en la separación del arranque, el zoom NO puede
    // volver al 3.3 del principio: eso era exactamente el defecto de a6685bc.
    expect(g.mover(120)).not.toBeCloseTo(3.3, 5);
  });

  it('el rebase del clamp sigue existiendo: apretar contra el fondo no guarda zoom', () => {
    const g = gesto(SALA, 1.6, 200);
    g.correr([200, 100, 90, 80]);
    // Sin el rebase de a6685bc, d = 200 daba el cociente 1 y volvía exacto a 1.6.
    expect(g.mover(200)).not.toBeCloseTo(1.6, 5);
  });

  it('`mordio` distingue el clamp de un gesto que entra entero en el rango', () => {
    const pin = fotoPinch(100, 0, 0, { x: 0, y: 0, z: 1.2 });
    expect(pasoPinch(pin, 110, 0, 0, SALA).mordio).toBe(false);
    expect(pasoPinch(pin, 300, 0, 0, SALA).mordio).toBe(true);
    expect(pasoPinch(pin, 10, 0, 0, SALA).mordio).toBe(true);
  });

  it('un `bruto` no finito no cuenta como clamp: rebasear ahí congela el gesto', () => {
    const pin: FotoPinch = { d: Infinity, cx: 0, cy: 0, x: 0, y: 0, z: 1 };
    expect(pasoPinch(pin, Infinity, 0, 0, SALA).mordio).toBe(false);
  });
});

describe('el anclaje: el punto medio de los dedos no se mueve', () => {
  /**
   * Con `z` distinto de `zFit`, `zFit` distinto de 1 y valores distintos en cada
   * eje: así ninguna variante que confunda los ejes o que ancle contra `zFit` en
   * vez de contra `pin.z` puede pasar.
   */
  const pin = fotoPinch(100, 200, 150, { x: -50, y: -30, z: 1.7 });
  const paso = pasoPinch(pin, 150, 200, 150, CELULAR);

  it('no clampeó, así que el gesto se aplicó entero', () => {
    expect(paso.z).toBeCloseTo(2.55, 10);
    expect(paso.mordio).toBe(false);
  });

  it('el punto del plano que estaba bajo el centro sigue estándolo, en X', () => {
    expect((200 - paso.x) / paso.z).toBeCloseTo((200 - pin.x) / pin.z, 10);
  });

  it('y en Y', () => {
    expect((150 - paso.y) / paso.z).toBeCloseTo((150 - pin.y) / pin.z, 10);
  });

  it('los dos ejes son independientes: no alcanza con que uno cierre', () => {
    expect(paso.x).not.toBeCloseTo(paso.y, 5);
  });
});
