/**
 * Traducción de los valores CSS del tema a lo que React Native puede pintar.
 *
 * `TemaButacas` nació para el renderer web, así que tres de sus claves llevan
 * valores que son CSS y nada más que CSS:
 *
 *   · `pantalla`       puede ser un `linear-gradient(...)`
 *   · `fuente`         y `fuenteDisplay` son STACKS (`'Barlow', system-ui, …`)
 *   · `pantallaHalo`   es un `box-shadow`
 *
 * React Native no entiende ninguno de los tres: `backgroundColor` con un
 * gradiente no matchea el parser de colores, y `fontFamily` toma UNA familia,
 * no una lista con fallbacks (el stack entero se busca como si fuera el nombre
 * de una fuente, y no existe).
 *
 * La alternativa era agregarle al tema claves paralelas «para native». Se
 * descartó: duplica la paleta, y el que arma un tema nuevo se olvida de la
 * mitad. Traducir es una función pura de un string a otro, se testea sola y
 * mantiene UN tema para los dos renderers.
 *
 * Vive en el núcleo (y no en `../native`) justamente PORQUE es puro: acá tiene
 * tests, y `src/native` está fuera del `tsconfig` del paquete —lo typechea la
 * app que lo consume— así que nada de lo que viva ahí se verifica en este repo.
 */

/** Familias que son categorías de CSS, no fuentes que se puedan pedir por nombre. */
const GENERICAS = new Set([
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'inherit',
  'initial',
  'unset',
]);

/**
 * La familia que hay que pedirle a React Native para un stack CSS, o
 * `undefined` para no pedir ninguna.
 *
 * Manda la PRIMERA familia del stack y nada más. Un stack CSS es una lista de
 * preferencia y el navegador usa la primera que exista, así que la primera ES
 * la intención; el resto son fallbacks.
 *
 * 🔑 Por eso un stack que ARRANCA con una genérica devuelve `undefined` y no la
 * primera familia concreta que aparezca más adelante. `system-ui, -apple-system,
 * 'Segoe UI', Roboto, sans-serif` es el stack canónico de «la fuente del
 * sistema»: `-apple-system`, `Segoe UI` y `Roboto` son la fuente del sistema en
 * macOS, Windows y Android. Quedarse con `Segoe UI` sería pedirle a un Android
 * una fuente de Windows — cae al default igual, pero pasando por una familia
 * inexistente. No pedir nada es exactamente lo que el stack pedía.
 *
 * 🔴 Pasar el stack crudo no es una opción intermedia: en Android una
 * `fontFamily` desconocida no cae al default con la misma métrica, así que el
 * renglón cambia de alto y el número deja de estar centrado en la butaca.
 */
export function familiaNativa(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const bruto of stack.split(',')) {
    const fam = bruto.trim().replace(/^["']|["']$/g, '').trim();
    if (!fam) continue;
    return GENERICAS.has(fam.toLowerCase()) ? undefined : fam;
  }
  return undefined;
}

/** Un color que React Native sí sabe parsear, o `undefined` si no se pudo sacar ninguno. */
const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/gi;

/**
 * Color sólido equivalente a un valor de fondo del tema.
 *
 * Lo que ya es un color se devuelve tal cual (incluido `'transparent'`, que es
 * un valor con sentido: «heredá el fondo del host»). Lo que es un gradiente se
 * colapsa al TRAMO DEL MEDIO.
 *
 * El medio y no el primero ni el último a propósito: el gradiente de la pantalla
 * va de casi negro abajo a casi blanco arriba, así que cualquiera de los dos
 * extremos da un sólido que no se parece en nada al original — uno desaparece
 * contra el fondo y el otro es un bloque blanco. El del medio es el promedio
 * visual, que es lo que se quiere cuando hay que elegir UN color.
 *
 * Devuelve `undefined` cuando no hay ningún color reconocible (`'none'`, un
 * `url(...)`, basura): el renderer lo lee como «no pintes nada», que es más
 * honesto que inventar un color.
 */
export function colorSolido(valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  const v = valor.trim();
  if (!v || v === 'none') return undefined;
  // Un color pelado no se toca: 'transparent', 'red', '#0C0C0D', 'rgba(…)'.
  if (!v.includes('(') || /^(rgba?|hsla?)\(/i.test(v)) return v;

  const colores = v.match(COLOR);
  if (!colores || colores.length === 0) return undefined;
  return colores[Math.floor((colores.length - 1) / 2)];
}
