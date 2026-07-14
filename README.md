# Pasado

Entrenador minimalista del pasado en español (pretérito e imperfecto).
PWA instalable en iPhone, sin dependencias, funciona offline.

## Modos

- **Conjugar** — escribe la forma pedida (verbo × tiempo × persona). Repetición
  espaciada tipo Leitner: los fallos vuelven enseguida, los aciertos se espacian
  (1 min → 10 min → 1 d → 3 d → 7 d → 16 d → 35 d).
- **Elegir** — frase con hueco: primero decide pretérito o imperfecto según el
  contexto, después escribe la forma. Cada frase explica la pista de uso.
- **Tablas** — terminaciones, pretéritos fuertes, cambios vocálicos, reglas de
  uso y verbos que cambian de significado.

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
