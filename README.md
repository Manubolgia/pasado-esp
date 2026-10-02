# Pasado

Entrenador minimalista de todo el sistema del pasado en español: pretérito
indefinido, imperfecto, perfecto, pluscuamperfecto e imperfecto de subjuntivo
(-ra y -se). PWA instalable en iPhone, sin dependencias, funciona offline.

## Modos

Los dos modos de ejercicios parten de lo mismo: una frase con hueco y el
contexto suficiente para decidir qué forma del verbo encaja. Nada de nombrar
tiempos verbales — se practica el uso, no la teoría. Ambos tienen filtros
por tiempo y repetición espaciada tipo Leitner: los fallos vuelven enseguida,
los aciertos se espacian (1 min → 10 min → 1 d → 3 d → 7 d → 16 d → 35 d).

- **Escribir** — frase con hueco: escribe la forma que pide el contexto.
  Es flexible con la ortografía: la forma sin tilde («vivio», «he leido») se
  da por buena, pero se recuerda la escritura correcta («vivió», «he leído»).
  En el perfecto acepta también el indefinido, como es habitual en Galicia
  («viví» por «he vivido»), señalando que la forma estándar es la compuesta.
  Los demás errores se diagnostican: raíz fuerte, participio irregular,
  auxiliar equivocado, persona o tiempo confundidos, y siempre se explica
  cómo se construye la forma y la pista de uso de la frase (marcadores,
  pasado del pasado, como si + subjuntivo…).
- **Elegir** — la misma frase con hueco, pero eligiendo entre cuatro formas
  ya conjugadas del mismo verbo (la correcta y distractores de otros
  tiempos). Cada respuesta explica la pista de uso.
- **Charlar** — una conversación con Lucía, una tutora que pregunta por tu vida
  (ayer, tu infancia, tus viajes, «si pudieras…») y te obliga a contestar en
  pasado. Cada tema empuja hacia un tiempo concreto, elegido entre los filtros
  activos y con más peso para los tiempos en los que más fallas. Las
  correcciones no interrumpen: Lucía usa bien la forma en su respuesta (la
  «reformula») y bajo tu mensaje queda una nota discreta que se abre al
  tocarla. Los verbos que fallas en la charla vuelven antes en «Escribir».
- **Tablas** — terminaciones simples y compuestas, pretéritos fuertes,
  participios irregulares, formación del subjuntivo, cambios vocálicos,
  reglas de uso y verbos que cambian de significado.

El progreso se guarda en `localStorage` del dispositivo.

## Cómo funciona «Charlar»

Dos piezas con papeles separados:

- **Quién corrige: `analyzer.js`.** Lee lo que escribes con el mismo motor de
  conjugación que los ejercicios (227 verbos), así que solo señala lo que sabe
  seguro que está mal: irregulares regularizados (*andé*, *tení*, *dormió*,
  *pidí*), participios (*he abrido*), *dijieron*, *teniera*, *hicistes*, tildes
  (*vivio*, *fué*), persona frente al sujeto (*yo fue*), *si tendría*, *como si
  es*. Con menos seguridad sugiere («¿quizá…?») el pasado cuando cuentas algo en
  presente, o el imperfecto de subjuntivo tras «quería que…». No juzga
  indefinido frente a imperfecto: eso depende del significado, y una corrección
  equivocada ahí hace más daño que una que falta.
- **Quién habla: una IA pequeña que funciona en el propio dispositivo**
  ([WebLLM](https://github.com/mlc-ai/web-llm) sobre WebGPU, copiada en
  `vendor/` para que funcione sin conexión). Es gratis y no envía nada a
  ningún servidor. Recibe en cada turno qué forma debe reformular y hacia qué
  tiempo llevar la siguiente pregunta, así que solo tiene que charlar. Si
  escribe una forma mal, el analizador la arregla antes de mostrarla.

| Modelo | Descarga | Para |
| --- | --- | --- |
| Qwen 2.5 · 0,5B | ≈ 0,4 GB | móviles con poca memoria |
| Llama 3.2 · 1B | ≈ 0,7 GB | móvil (recomendado) |
| Qwen 2.5 · 3B | ≈ 1,8 GB | ordenador (recomendado) |

Se descarga una vez (mejor con wifi) y queda en la caché del navegador; se
puede cambiar o borrar en «ajustes». Sin IA —si el navegador no tiene WebGPU o
el modelo no cabe— la charla sigue con un **tutor guiado** de preguntas
preparadas, que corrige exactamente igual.

**En iPhone** hace falta iOS 26 (WebGPU). iOS limita mucho la memoria de una
web: en un iPhone con 4 GB (iPhone 11) el modelo puede no caber. Si la app se
reinicia mientras carga la IA, la siguiente vez lo detecta, sigue con el tutor
guiado y ofrece el modelo más pequeño. En el ordenador (Chrome, Edge o Safari
recientes) funciona sin problemas con la misma dirección. Para dictar, usa el
micrófono del teclado; las respuestas se pueden escuchar en voz alta.

## Pruebas

```sh
node tests/analyzer.test.js
```

## Desplegar en GitHub Pages

```sh
gh repo create pasado --public --source . --push
gh api repos/{owner}/pasado/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'
```

O manualmente: crea un repo, `git push`, y en Settings → Pages elige
`main` / root. La app queda en `https://<usuario>.github.io/pasado/`.

## Instalar en iPhone

Abre la URL en Safari → botón compartir → «Añadir a pantalla de inicio».
