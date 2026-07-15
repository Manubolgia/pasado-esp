# Pasado

Entrenador minimalista de todo el sistema del pasado en español: pretérito
indefinido, imperfecto, perfecto, pluscuamperfecto e imperfecto de subjuntivo
(-ra y -se). PWA instalable en iPhone, sin dependencias, funciona offline.

## Modos

Los dos modos de práctica parten de lo mismo: una frase con hueco y el
contexto suficiente para decidir qué forma del verbo encaja. Nada de nombrar
tiempos verbales — se practica el uso, no la teoría. Ambos tienen filtros
por tiempo y repetición espaciada tipo Leitner: los fallos vuelven enseguida,
los aciertos se espacian (1 min → 10 min → 1 d → 3 d → 7 d → 16 d → 35 d).

- **Escribir** — frase con hueco: escribe la forma que pide el contexto.
  Los errores se diagnostican: tilde que falta, raíz fuerte, participio
  irregular, auxiliar equivocado, persona o tiempo confundidos, y siempre
  se explica cómo se construye la forma y la pista de uso de la frase
  (marcadores, pasado del pasado, como si + subjuntivo…).
- **Elegir** — la misma frase con hueco, pero eligiendo entre cuatro formas
  ya conjugadas del mismo verbo (la correcta y distractores de otros
  tiempos). Cada respuesta explica la pista de uso.
- **Tablas** — terminaciones simples y compuestas, pretéritos fuertes,
  participios irregulares, formación del subjuntivo, cambios vocálicos,
  reglas de uso y verbos que cambian de significado.

El progreso se guarda en `localStorage` del dispositivo.

## Desplegar en GitHub Pages

```sh
gh repo create pasado --public --source . --push
gh api repos/{owner}/pasado/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'
```

O manualmente: crea un repo, `git push`, y en Settings → Pages elige
`main` / root. La app queda en `https://<usuario>.github.io/pasado/`.

## Instalar en iPhone

Abre la URL en Safari → botón compartir → «Añadir a pantalla de inicio».
