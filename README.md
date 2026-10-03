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
  (*vivio*, *fué*, *hacia mucho calor*), persona frente al sujeto (*yo fue*),
  *si tendría*, *como si es*, *quería que soy*, y un subjuntivo sin nada que lo
  pida (*hicieramos muchos helados* → *hacíamos*). Con menos seguridad sugiere
  («¿quizá…?») el imperfecto cuando la pregunta era sobre costumbres y contestas
  con un indefinido (*¿Qué hacías?* — *hice castillos*), o el pasado cuando
  cuentas en presente algo de «ayer».
- **Quién corrige el resto y habla: Gemini** (`gemini.js`), con tu propia
  clave gratuita de [Google AI Studio](https://aistudio.google.com/apikey). Se
  pega una vez en la bienvenida o en «ajustes» y solo se guarda en ese
  dispositivo (aparte del progreso). Necesita conexión y los mensajes van a
  Google (con la clave gratuita, Google puede usarlos para mejorar sus
  productos). Hay dos opciones, *Gemini Flash* y *Flash-Lite*, con los alias
  `gemini-flash-latest` y `gemini-flash-lite-latest`, que siguen a los modelos
  actuales de Google; cada uno tiene su propio cupo gratuito.
  Gemini **corrige como una profesora** todo el mensaje, no solo los verbos:
  ortografía (*nevriose*), tildes (*dia*, *si* afirmativo), ser/estar, el
  tiempo que pide el contexto (*fui muy nerviosa* → *estaba*), concordancia,
  palabras que faltan. En una sola petición devuelve, en JSON, las correcciones
  (cada una con su explicación), la frase entera corregida y la respuesta de
  Lucía, que ya reformula lo corregido. Lo que el analizador da por seguro se
  le pasa como hecho, y sus sospechas como candidatas que Gemini decide; los
  verbos que corrige Gemini también vuelven antes en «Escribir».

**Si Gemini no contesta** (sin conexión, clave no válida, cupo agotado,
tarda demasiado o da una respuesta inservible), la charla sigue con el **tutor
guiado** de preguntas preparadas, que solo corrige los verbos, y se avisa
claramente: bajo esa respuesta aparece en rojo «Gemini no ha contestado», el
motivo y un botón para preguntárselo otra vez a Gemini, que sustituye la
respuesta del tutor guiado. Si el problema sigue (la clave, el cupo), un aviso
encima de la charla lo explica con «reintentar» y «ajustes». Sin clave se
puede charlar solo con el tutor guiado.

Antes la charla usaba IAs pequeñas descargadas en el dispositivo (WebLLM); al
actualizar, la app borra esos modelos para liberar el espacio que ocupaban.
Para dictar, usa el micrófono del teclado; las respuestas se pueden escuchar
en voz alta.

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
