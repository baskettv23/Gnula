# Gnula para Kino

Plugin de [Kino](https://github.com/kinotvapp/kino-plugin-archive) que agrega **películas y anime** de [gnula.one](https://www2.gnula.one/) en español (latino, castellano y subtitulado).

> Plugin no oficial. Todo el catálogo y los videos pertenecen a gnula.one y a sus servidores; este plugin solo los organiza dentro de Kino.

## Qué trae

- **Inicio** con las filas de la portada: Estrenos de cine, Lo + New, Más vistas, Últimas, New VOSE, New Latino y New Castellano.
- **Categorías** por género (Acción, Comedia, Terror, Anime…) con paginación.
- **Búsqueda** por título.
- **Reproducción** abriendo el reproductor de cada servidor en el navegador oculto de Kino y capturando el video (`.m3u8` o `.mp4`).

## Instalar

En Kino: **Ajustes ▸ Plugins ▸ Agregar**, y pega la dirección del repositorio:

```
baskettv23/kino-plugin-gnula
```

Al instalar, Kino pedirá dos permisos que hay que aceptar:

- Puede abrir páginas web ocultas para encontrar el video (en rojo).
- Puede reproducir video desde cualquier servidor que indique (en rojo).

Kino nunca resuelve captchas: si un servidor pide "confirmar que eres humano", se pasa al siguiente.

## Notas

- Requiere **Kino 0.9.50 o superior** (apiVersion 6).
- Las series de gnula viven en otro sitio web y no están incluidas.
- Si un servidor no responde, se intenta automáticamente con otros; los demás quedan en el menú **Servidor** del reproductor.

## Desarrollo

```
node sdk/validate.mjs .
node sdk/run.mjs . home
node sdk/run.mjs . search "matrix"
node sdk/run.mjs . browse cat:accion
node --test test/plugin.test.mjs
```

`resolve` no puede probarse con el kit de Node (no hay navegador): pruébalo en un aparato real.
