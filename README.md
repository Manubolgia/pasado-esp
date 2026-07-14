# Pasado

Entrenador minimalista de todo el sistema del pasado en español: pretérito
indefinido, imperfecto, perfecto, pluscuamperfecto e imperfecto de subjuntivo
(-ra y -se). PWA instalable en iPhone, sin dependencias, funciona offline.

## Modos

- **Conjugar** — escribe la forma pedida (verbo × tiempo × persona), con
  filtros por tiempo. Repetición espaciada tipo Leitner: los fallos vuelven
  enseguida, los aciertos se espacian (1 min → 10 min → 1 d → 3 d → 7 d →
  16 d → 35 d). Los errores se diagnostican: tilde que falta, raíz fuerte,
  participio irregular, auxiliar equivocado, persona o tiempo confundidos,
  y siempre se explica cómo se construye la forma.
- **Elegir** — frase con hueco: primero decide entre los cinco tiempos según
  el contexto, después escribe la forma. Cada frase explica la pista de uso
  (marcadores, pasado del pasado, como si + subjuntivo…).
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
