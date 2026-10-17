// Kino plugin: Gnula (gnula.one) — películas y anime en español.
//
// Hosts declarados: www2.gnula.one (y gnula.one) para el catálogo, y los reproductores externos que la ficha
// de cada película incluye. El video final vive en CDNs variables, por eso el manifiesto pide "streamHosts": "any";
// y para abrir el reproductor oculto y capturar el .m3u8/.mp4 pide "browser": true (permiso rojo que la persona
// aprueba al instalar).
//
// La reproducción es modular: cada servidor tiene su extractor (clase) en la sección "Reproducción" —uno simple
// que lee la fuente del HTML, uno con cabeceras y salto de redirecciones, y el navegador oculto como último
// recurso— y resolveEmbeds() recorre los enlaces de la ficha hasta que uno rinde; si un servidor falla (caído,
// timeout, captcha, dominio rotado) se salta al siguiente sin bloquear la app.

const BASE = "https://www2.gnula.one";

// Reproductores preferidos: el orden en que resolveEmbeds() recorre los enlaces de la ficha (los que más
// directo entregan un HLS/mp4 primero; las páginas "agregadoras" que solo listan botones quedan al final).
// También es la lista blanca de destinos válidos para encadenar: un iframe o go_to_player() que apunte a un
// host de aquí se persigue; uno desconocido (publicidad) se ignora.
const PLAYER_PREF = [
  "voe.sx", "filemoon.sx", "filemoon.to", "player.cuevana.ac", "dood.pm", "waaw.to", "upstream.to", "hqq.to",
  "fembed.com", "www.2embed.ru", "waaw.in", "streamplay.to", "streamtape.com", "mixdrop.ch", "jawcloud.co",
  "formatearwindows.net", "fsapi.xyz", "player.moovies.in", "pelisplushd.net", "player.cuevana3.one",
  "streamwish.to", "vidhidevip.com", "goodstream.one", "vimeos.net", "videoapp.zip", "hlswish.com"
];
const AGGREGATOR = ["links.cuevana.ac"];
const PLAYER_NAME = {
  "voe.sx": "Voe",
  "filemoon.sx": "Filemoon",
  "filemoon.to": "Filemoon",
  "player.cuevana.ac": "Cuevana Player",
  "waaw.to": "Waaw",
  "links.cuevana.ac": "Cuevana",
  "upstream.to": "Upstream",
  "hqq.to": "HQQ",
  "fembed.com": "Fembed",
  "www.2embed.ru": "2Embed",
  "2embed.ru": "2Embed",
  "dood.pm": "Dood",
  "waaw.in": "Waaw",
  "streamplay.to": "Streamplay",
  "streamtape.com": "Streamtape",
  "mixdrop.ch": "Mixdrop",
  "jawcloud.co": "Jawcloud",
  "formatearwindows.net": "FormatearWindows",
  "fsapi.xyz": "Fsapi",
  "player.moovies.in": "Moovies",
  "pelisplushd.net": "Pelisplushd",
  "player.cuevana3.one": "Cuevana 3",
  "streamwish.to": "Streamwish",
  "vidhidevip.com": "VidHide",
  "goodstream.one": "Goodstream",
  "vimeos.net": "Vimeos",
  "videoapp.zip": "VideoApp",
  "hlswish.com": "Hlswish"
};

// Categorías con contenido real en gnula (las que devuelven su propia lista, no la portada).
const GENRES = {
  "estreno": "Estrenos",
  "recomendada": "Recomendadas",
  "accion": "Acción",
  "animacion": "Animación",
  "aventura": "Aventura",
  "belica": "Bélica",
  "ciencia-ficcion": "Ciencia ficción",
  "crimen": "Crimen",
  "documental": "Documental",
  "drama": "Drama",
  "fantasia": "Fantasía",
  "misterio": "Misterio",
  "pelicula-de-tv": "Película de TV",
  "romance": "Romance",
  "suspense": "Suspense",
  "terror": "Terror",
  "western": "Western"
};
const GENRE_ORDER = [
  "estreno", "recomendada", "accion", "animacion", "aventura", "belica", "ciencia-ficcion", "crimen",
  "documental", "drama", "fantasia", "misterio", "pelicula-de-tv", "romance", "suspense", "terror", "western"
];

const ROW_MAX = 60;
const SEARCH_MAX = 100;
const BROWSE_MAX = 100;

// ---------- utilidades de texto (el motor no trae ayuda: todo a mano) ----------

function log() {
  try {
    kino.log.apply(null, arguments);
  } catch (e) {
    // kino.log nunca debe romper lo que informa
  }
}

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8230;/g, "…");
}

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"").exec(tag);
  return m ? decodeEntities(m[1]) : "";
}

function squash(text) {
  const lower = String(text == null ? "" : text).toLowerCase();
  const folded = typeof lower.normalize === "function" ? lower.normalize("NFKD") : lower;
  return folded.replace(/[^a-z0-9]/g, "");
}

function rowId(title) {
  const s = String(title == null ? "" : title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "fila").slice(0, 40);
}

// ---------- lectura de las tarjetas de película ----------

function itemId(slug) {
  if (/^[A-Za-z0-9._~-]{1,128}$/.test(slug)) return slug;
  let b = "";
  try {
    b = btoa(slug);
  } catch (e) {
    b = "";
  }
  b = b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!b) b = "m" + kino.crypto.hash("sha1", slug).slice(0, 24);
  if (b.length > 128) b = b.slice(0, 120);
  return b;
}

function yearOf(title) {
  const m = /\((19\d{2}|20\d{2})\)/.exec(title);
  return m ? m[1] : "";
}

function qualityOf(title) {
  const m = /\[([^\]]+)\]/.exec(title);
  return m ? m[1].trim().slice(0, 20) : "";
}

function genresOf(title) {
  const i = title.indexOf(" - ");
  if (i < 0) return [];
  const parts = title.slice(i + 3).split(",");
  const out = [];
  for (let k = 0; k < parts.length && out.length < 5; k++) {
    const g = parts[k].trim();
    if (!g || /estreno|recomendad/i.test(g)) continue;
    out.push(g.slice(0, 30));
  }
  return out;
}

function titleFromAttr(title) {
  const m = /^(.*?)\s*\(\d{4}\)/.exec(title);
  return (m ? m[1] : title).trim();
}

function toItem(slug, img) {
  const rawTitle = attr(img, "title");
  const alt = attr(img, "alt");
  const title = (alt || titleFromAttr(rawTitle)).replace(/\s+/g, " ").trim().slice(0, 200);
  let poster = attr(img, "data-lazyload") || attr(img, "data-src") || attr(img, "src");
  if (poster && poster.indexOf("//") === 0) poster = "https:" + poster;
  if (poster && poster.indexOf("http") !== 0) poster = "";
  const genres = genresOf(rawTitle);
  const year = yearOf(rawTitle);
  const quality = qualityOf(rawTitle);
  const item = {
    id: itemId(slug),
    ref: "movie|" + slug,
    title: title,
    kind: "movie"
  };
  if (year) item.year = year;
  if (poster) item.poster = poster.slice(0, 2048);
  if (genres.length) item.genres = genres;
  if (quality) item.quality = quality;
  return item;
}

function itemsFrom(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\s+href="https?:\/\/(?:www2\.)?gnula\.one\/movie\/([^"\/]+)\/"[^>]*>[\s\S]{0,200}?<img\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const item = toItem(slug, m[2]);
    if (!item.title) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// Recorta el área de resultados real (la portada y la columna lateral repiten películas).
function regionOf(html) {
  const i = html.indexOf('<div id="content">');
  if (i < 0) return html;
  let seg = html.slice(i);
  const stops = ['class="navigation pagination"', '<div id="comments', 'class="post-tags', '<div class="remodal"', '<script type="speculationrules">'];
  let end = seg.length;
  for (let k = 0; k < stops.length; k++) {
    const j = seg.indexOf(stops[k]);
    if (j >= 0 && j < end) end = j;
  }
  return seg.slice(0, end);
}

// ---------- Home: filas de la portada ----------

function capaRows(html) {
  const marks = [];
  const re = /<div class="capa\d">/g;
  let m;
  while ((m = re.exec(html))) marks.push(m.index);
  const contentAt = html.indexOf('<div id="content">');
  const rows = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i];
    let end = i + 1 < marks.length ? marks[i + 1] : contentAt;
    if (end < 0 || end < start) end = html.length;
    const seg = html.slice(start, end);
    const h = /<h2>([^<]*)<\/h2>/.exec(seg);
    const title = h ? decodeEntities(h[1]).replace(/\s+/g, " ").trim() : "";
    if (!title) continue;
    const items = itemsFrom(seg).slice(0, ROW_MAX);
    if (!items.length) continue;
    rows.push({ id: rowId(title), title: title, items: items });
  }
  return rows;
}

function estrenosRow(html) {
  const seg = regionOf(html);
  const items = itemsFrom(seg).slice(0, ROW_MAX);
  if (!items.length) return null;
  const s = /<strong>\s*([^<]+?)\s*<\/strong>/.exec(seg);
  const title = s ? decodeEntities(s[1]).replace(/\s+/g, " ").trim() : "Estrenos";
  return { id: "estrenos", title: title || "Estrenos", ref: "cat:estreno", items: items };
}

export async function home() {
  const r = await kino.fetch(BASE + "/");
  if (!r.ok) throw kino.error("unavailable", "gnula respondió " + r.status);
  const html = r.text();
  const rows = [];
  const first = estrenosRow(html);
  if (first) rows.push(first);
  const capa = capaRows(html);
  for (let i = 0; i < capa.length && rows.length < 20; i++) rows.push(capa[i]);
  return rows;
}

// ---------- Categorías (pestaña Categorías; cada ficha abre browse) ----------

export async function categories() {
  await null;
  const out = [];
  for (let i = 0; i < GENRE_ORDER.length; i++) {
    const slug = GENRE_ORDER[i];
    out.push({ id: slug, title: GENRES[slug], ref: "cat:" + slug });
  }
  return out;
}

// ---------- Navegación (Ver más) ----------

function hasNext(html, path, page) {
  const re = new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "page\\/" + (page + 1) + "\\/");
  return re.test(html);
}

export async function browse(ref, cursor) {
  await null;
  const text = String(ref == null ? "" : ref);
  if (text.indexOf("cat:") !== 0) throw kino.error("not_found", "Esa lista ya no existe");
  const slug = text.slice(4);
  if (!Object.prototype.hasOwnProperty.call(GENRES, slug)) throw kino.error("not_found", "Esa categoría ya no existe");
  const page = cursor ? parseInt(cursor, 10) : 1;
  if (!(page >= 1) || page > 200) throw kino.error("not_found", "Página inválida");
  const path = "/category/" + slug + "/";
  const url = BASE + path + (page > 1 ? "page/" + page + "/" : "");
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", "gnula respondió " + r.status);
  const html = r.text();
  const items = itemsFrom(regionOf(html)).slice(0, BROWSE_MAX);
  const next = items.length && hasNext(html, path, page) ? String(page + 1) : undefined;
  return { items: items, next: next };
}

// ---------- Búsqueda ----------

function searchForms(query) {
  const out = [];
  const seen = new Set();
  const given = [query.q, query.originalTitle].concat(Array.isArray(query.altTitles) ? query.altTitles : []);
  for (let i = 0; i < given.length && out.length < 3; i++) {
    const raw = given[i];
    if (typeof raw !== "string") continue;
    let t = raw.trim();
    if (!t) continue;
    t = String(kino.rank.shortQuery(t)).replace(/\s+/g, " ").trim();
    if (!t) continue;
    const key = squash(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

async function searchPage(form, page) {
  const url = page > 1
    ? BASE + "/page/" + page + "/?s=" + encodeURIComponent(form)
    : BASE + "/?s=" + encodeURIComponent(form);
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", "gnula respondió " + r.status);
  return r.text();
}

export async function search(query) {
  const forms = searchForms(query || {});
  if (!forms.length) return [];
  const page = query.cursor ? parseInt(query.cursor, 10) : 1;
  const safePage = page >= 1 ? page : 1;
  const asks = [];
  for (let i = 0; i < forms.length; i++) asks.push(searchPage(forms[i], safePage));
  const answers = await Promise.all(asks);
  let items = [];
  const seen = new Set();
  let lastHtml = answers.length ? answers[0] : "";
  for (let i = 0; i < answers.length; i++) {
    const found = itemsFrom(regionOf(answers[i]));
    for (let k = 0; k < found.length; k++) {
      if (seen.has(found[k].id)) continue;
      seen.add(found[k].id);
      items.push(found[k]);
    }
  }
  if (items.length > SEARCH_MAX) items = items.slice(0, SEARCH_MAX);
  const titles = [query.q, query.originalTitle]
    .concat(Array.isArray(query.altTitles) ? query.altTitles : [])
    .concat(forms)
    .filter(function (t) { return typeof t === "string" && t.trim(); });
  let ranked = kino.rank.sortBySimilarity(items, titles);
  const relevant = kino.rank.filterRelevant(ranked, titles);
  if (relevant.length) ranked = relevant;
  // Gnula no la tiene: se busca el mismo título en las webs de respaldo y se muestran sus resultados.
  if (!ranked.length) {
    const rescued = await fallbackSearch(forms[0], titles);
    if (rescued.length) return rescued;
  }
  // ¿Hay más resultados? La paginación de WordPress enlaza a /page/<n>/?s=…
  const hasMore = new RegExp("/page/" + (safePage + 1) + "/").test(lastHtml);
  return hasMore ? { items: ranked, next: String(safePage + 1) } : ranked;
}

// ---------- Reproducción ----------

function hostOf(url) {
  const m = /^https?:\/\/([^\/]+)/.exec(url);
  return m ? m[1].toLowerCase() : "";
}

function stripHash(url) {
  const i = url.indexOf("#");
  return i < 0 ? url : url.slice(0, i);
}

function friendlyHost(url) {
  const h = hostOf(url);
  return PLAYER_NAME[h] || h || "Servidor";
}

function firstIframeUrl(chunk) {
  let m = /<iframe[^>]*\bdata-lazy-src="([^"]+)"/.exec(chunk);
  if (m) return m[1];
  m = /<iframe[^>]*\bdata-src="([^"]+)"/.exec(chunk);
  if (m) return m[1];
  m = /<iframe[^>]*\bsrc="(https?:\/\/[^"]+)"/.exec(chunk);
  if (m) return m[1];
  return "";
}

function serverOptions(html) {
  const labels = {};
  let m;
  const lre = /<a href="#(tab\d+)"[^>]*>([^<]*)<\/a>/g;
  while ((m = lre.exec(html))) {
    if (!(m[1] in labels)) labels[m[1]] = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
  }
  const out = [];
  const seen = new Set();
  // Cada pestaña (id="tabN") lleva un solo iframe: se corta el HTML por ellas para no cruzar de una pestaña a otra.
  const parts = html.split(/<div id="(tab\d+)"/);
  for (let i = 1; i < parts.length; i += 2) {
    const tab = parts[i];
    const chunk = parts[i + 1] ? parts[i + 1].slice(0, 1500) : "";
    const label = labels[tab] || "";
    if (/descarga|download/i.test(label)) continue;
    const url = stripHash(decodeEntities(firstIframeUrl(chunk)).trim());
    if (!/^https:\/\//.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url: url });
  }
  const rank = function (o) {
    const h = hostOf(o.url);
    const i = PLAYER_PREF.indexOf(h);
    if (i >= 0) return i;
    return AGGREGATOR.indexOf(h) >= 0 ? 1000 : 500;
  };
  return out
    .map(function (o, i) { return { o: o, i: i }; })
    .sort(function (a, b) { return rank(a.o) - rank(b.o) || a.i - b.i; })
    .map(function (x) { return x.o; });
}

function withLabels(opts) {
  const counts = {};
  for (let i = 0; i < opts.length; i++) {
    if (opts[i].label) continue;
    const base = friendlyHost(opts[i].url);
    counts[base] = (counts[base] || 0) + 1;
    opts[i].label = (counts[base] > 1 ? base + " " + counts[base] : base).slice(0, 48);
  }
  return opts;
}

function mimeFor(mime, url) {
  const m = String(mime == null ? "" : mime).toLowerCase();
  if (m.indexOf("mpegurl") >= 0) return "application/vnd.apple.mpegurl";
  if (m.indexOf("dash") >= 0) return "application/dash+xml";
  if (m && m.indexOf("json") < 0 && m.indexOf("text") < 0) return mime;
  if (/\.m3u8(\?|$)/i.test(url)) return "application/vnd.apple.mpegurl";
  if (/\.mpd(\?|$)/i.test(url)) return "application/dash+xml";
  return "video/mp4";
}

function subsFor(list) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < 10; i++) {
    const s = list[i];
    if (!s || !s.url || !/^https:\/\//.test(s.url)) continue;
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    const sub = { lang: String(s.lang || "und").slice(0, 16), url: s.url };
    sub.format = /\.srt(\?|$)/i.test(s.url) ? "srt" : "vtt";
    out.push(sub);
  }
  return out;
}

// ---------- Extractores: un módulo (clase) por servidor ----------
//
// BaseExtractor define el contrato —cabeceras, página, stream— y cada extractor sabe llegar al video de
// su host. resolveEmbeds() recorre los enlaces de la ficha en orden (PLAYER_PREF), pregunta a
// extractorFor() quién resuelve ese host y ejecuta su extractor; si falla (caído, timeout, captcha,
// dominio rotado) pasa al siguiente sin bloquear la app. El navegador oculto (BrowserExtractor) es el
// último recurso de cada enlace: es el único que ejecuta el JavaScript del reproductor y captura la
// petición real de video con sus cabeceras. Los errores tipados (ExtractorError.code o el code de un
// error de kino.*) solo alimentan el registro: todo falo salta al siguiente intento.

const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const FETCH_TIMEOUT_MS = 6000;      // cada página de reproductor: rápido para no comerse el presupuesto
const CAPTURE_TIMEOUT_MS = 20000;   // navegador, igual que siempre
const RESOLVE_BUDGET_MS = 42000;    // resolve con navegador da 75 s en total (la ficha consume ~6)
const MAX_CHAIN = 6;                // saltos máximos de un enlace encadenado (agregador/iframes)

function originOf(url) {
  const m = /^(https?:\/\/[^\/?#]+)/.exec(String(url == null ? "" : url));
  return m ? m[1] : "";
}

// ¿El host del enlace está en la lista? Exacto o "*.sufijo", igual que hostMatches del manifiesto.
function hostIn(url, patterns) {
  const h = hostOf(url);
  if (!h) return false;
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    if (p.slice(0, 2) === "*.") {
      if (h.length > p.length - 1 && h.slice(-(p.length - 1)) === p.slice(1)) return true;
    } else if (h === p) return true;
  }
  return false;
}

// Cabeceras del kit para leer una página: UA de navegador y el Referer del origen de la ficha cuando
// se conoce (el navegador solo manda el origen en referencias cruzadas).
function pageHeaders(referer) {
  const h = { "User-Agent": UA };
  const ref = referer ? originOf(referer) : "";
  if (ref) h.Referer = ref + "/";
  return h;
}

class ExtractorError extends Error {
  constructor(code, message, extractor) {
    super(message || code);
    this.name = "ExtractorError";
    this.code = code;             // timeout|movido|bloqueado|captcha|gone|no_video|down|…
    this.extractor = extractor || "";
  }
}

// Qué pasó, en una palabra, para el registro — ya venga de un extractor o de un error tipado de kino.*.
function errorKind(e) {
  const code = e && typeof e.code === "string" ? e.code : "";
  if (e instanceof ExtractorError) return code;
  if (code === "timeout") return "timeout";
  if (code === "host_not_allowed") return "host no declarado";
  if (code === "browser_unavailable") return "sin navegador";
  if (code === "blocked" || code === "busy" || code === "not_allowed" || code === "rate_limited") return "bloqueado";
  if (code === "network" || code === "too_large" || code === "invalid_request") return "red";
  return code || "desconocido";
}

// Quita comentarios de JS/CSS: en player.cuevana.ac/e el .m3u8 de ejemplo vive dentro de un /* … */
// y no vale; sin esto el extractor "directo" creería haber encontrado un video.
function cleanJs(html) {
  let s = String(html == null ? "" : html);
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/(^|[^:\w\/])\/\/[^\n]*/g, "$1");
  return s;
}

// Una URL solo vale si es https y apunta a un manifiesto de video (o un mp4): evita publicidad
// y el .mp4 de muestra que algunos reproductores dejan en el HTML.
function videoUrl(raw) {
  const u = decodeEntities(String(raw == null ? "" : raw)).replace(/\\\//g, "/").trim();
  if (u.slice(0, 8) !== "https://") return "";
  if (!/\.(m3u8|mp4|mpd|m4v)([?#]|$)/i.test(u)) return "";
  return u;
}

// Fuente en línea en el HTML del reproductor: "file":"…", sources:[{file:"…"}], src="…m3u8".
function directSourceIn(html) {
  const s = cleanJs(html);
  const pats = [
    /["'](?:file|src)["']\s*:\s*["'](https?:[^"']+)["']/gi,
    /src\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/gi
  ];
  for (let i = 0; i < pats.length; i++) {
    let m;
    while ((m = pats[i].exec(s))) {
      const u = videoUrl(m[1]);
      if (u) return u;
    }
  }
  return "";
}

function b64Url(v) {
  try {
    let t = String(v).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    return videoUrl(atob(t));
  } catch (e) {
    return "";
  }
}

// "Desencriptación básica": valores base64 en línea (atob) — el patrón de hosts que esconden su URL
// codificada en el HTML. Si un host pasa a cifrar con AES, añádelo con aesSource() abajo.
function decodedSourceIn(html) {
  const s = cleanJs(html);
  const re = /atob\(\s*["']([A-Za-z0-9+/_-]{12,}={0,2})["']\s*\)/g;
  let m;
  while ((m = re.exec(s))) {
    const u = b64Url(m[1]);
    if (u) return u;
  }
  return "";
}

// Plantilla para hosts que guardan su URL cifrada con AES-256-CBC en el HTML: registra el host en
// AES_HOSTS con su patrón y su clave/iv en hex y el extractor lo usará solo. Ejemplo:
//   { host: "ejemplo.sx", pattern: /"enc"\s*:\s*"([A-Za-z0-9+/=]+)"/, key: "<64 hex>", iv: "<32 hex>" }
const AES_HOSTS = [];
function aesSourceIn(html, cfg) {
  if (!cfg || !cfg.pattern || !cfg.key) return "";
  const m = cfg.pattern.exec(String(html == null ? "" : html));
  if (!m) return "";
  try {
    const plain = kino.crypto.decrypt("aes-256-cbc", {
      key: cfg.key, keyEncoding: "hex",
      iv: cfg.iv || "", ivEncoding: "hex",
      data: m[1], inputEncoding: "base64",
      outputEncoding: "utf8"
    });
    return videoUrl(plain);
  } catch (e) {
    log("decrypt falló", e && e.code ? e.code : "error");
    return "";
  }
}

// Paso de desencriptado: primero base64 en línea (atob); si el host está en AES_HOSTS, su AES.
function encodedSourceIn(html, host) {
  const plain = decodedSourceIn(html);
  if (plain) return plain;
  for (let i = 0; i < AES_HOSTS.length; i++) {
    if (AES_HOSTS[i].host !== host) continue;
    const u = aesSourceIn(html, AES_HOSTS[i]);
    if (u) return u;
  }
  return "";
}

function hasCaptcha(html) {
  return /hcaptcha|grecaptcha|recaptcha\/api|captcha\.google/.test(String(html == null ? "" : html));
}

// Hacia dónde sigue la página: go_to_player('…') (links.cuevana.ac) o el iframe embebido.
function embedTargets(html) {
  const s = String(html == null ? "" : html);
  const out = [];
  const push = function (u) {
    const url = stripHash(decodeEntities(String(u == null ? "" : u)).trim());
    if (url.slice(0, 8) !== "https://") return;
    if (out.indexOf(url) < 0) out.push(url);
  };
  let m;
  const gre = /go_to_player\(\s*['"](https?:[^'"]+)['"]\s*\)/g;
  while ((m = gre.exec(s))) push(m[1]);
  const ire = /<iframe\b[^>]*?(?:data-lazy-src|data-src|src)\s*=\s*"(https?:[^"]+)"/g;
  while ((m = ire.exec(s))) push(m[1]);
  return out;
}

// Redirección de JavaScript (voe.sx manda a un dominio nuevo con window.location.href = '…').
function jsRedirect(html) {
  const m = /(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'](https?:[^"']+)["']/.exec(String(html == null ? "" : html));
  return m ? decodeEntities(m[1]) : "";
}

class BaseExtractor {
  constructor(id, hosts) {
    this.id = id;
    this.hosts = hosts || [];
  }

  matches(url) {
    return hostIn(url, this.hosts);
  }

  // El navegador solo manda el origen en referencias cruzadas (strict-origin-when-cross-origin),
  // así que el Referer va como "https://host/" — lo que el CDN comprueba para no bloquear el hotlink.
  headers(referer) {
    return pageHeaders(referer);
  }

  // Página del reproductor. parent = la ficha de gnula de donde vino el iframe (el navegador la
  // usaría como Referer). kino.fetch nunca lanza por 4xx/5xx: aquí se convierte en fallo tipado.
  async page(url, opts) {
    const o = opts || {};
    const r = await kino.fetch(url, {
      headers: this.headers(o.parent),
      timeoutMs: o.timeoutMs || FETCH_TIMEOUT_MS
    });
    if (!r.ok) {
      const st = r.status;
      const kind = (st === 401 || st === 403 || st === 429) ? "bloqueado"
        : (st === 404 || st === 410) ? "gone" : st >= 500 ? "down" : "no_video";
      throw new ExtractorError(kind, "el servidor respondió " + st, this.id);
    }
    return r.text();
  }

  // Stream listo para Kino: el Referer es la página del reproductor (su CDN lo exige) y el
  // User-Agent el que no dispara el bloqueo por hotlinking. Cabeceras: 2 de 20 permitidas.
  stream(info) {
    const out = { url: info.url, mime: mimeFor(info.mime, info.url) };
    out.headers = this.headers(info.referer || info.url);
    if (info.label) out.label = String(info.label).slice(0, 48);
    const subs = subsFor(info.subtitles || []);
    if (subs.length) out.subtitles = subs;
    return out;
  }

  async resolve() {
    throw new ExtractorError("desconocido", "este extractor no sabe resolver", this.id);
  }
}

// Extractor simple: la página entrega el video a la vista ("file":…, sources:[{file:…}], src="…m3u8")
// o lista a dónde seguir (go_to_player/iframes). Cubre el agregador links.cuevana.ac y la familia de
// hosts tipo fembed/waaw que dejan su fuente en línea en el HTML.
class EmbedExtractor extends BaseExtractor {
  constructor() {
    super("embed", [
      "links.cuevana.ac", "fembed.com", "pelisplushd.net", "waaw.to", "waaw.in",
      "streamplay.to", "jawcloud.co", "player.moovies.in", "fsapi.xyz", "*.2embed.ru",
      "streamwish.to", "vidhidevip.com", "goodstream.one", "vimeos.net", "videoapp.zip", "hlswish.com"
    ]);
  }

  async resolve(embed, ctx) {
    const html = await this.page(embed.url, { parent: ctx.referer });
    const direct = directSourceIn(html) || encodedSourceIn(html, hostOf(embed.url));
    if (direct) return this.stream({ url: direct, label: embed.label, referer: embed.url });
    const next = embedTargets(html);
    if (next.length) return { next: next.slice(0, MAX_CHAIN) };
    if (hasCaptcha(html)) throw new ExtractorError("captcha", "pide captcha y no expuso el video", this.id);
    throw new ExtractorError("no_video", "la página no expuso el video", this.id);
  }
}

// Voe: exige cabeceras correctas y salta por redirección de JavaScript entre dominios; su URL final
// viene cifrada en el HTML. Sigue la cadena mientras kino.fetch alcance el destino; cuando Voe rota a
// un dominio que el manifiesto no declara, el fallo tipado deja que el navegador —que sí puede abrir
// cualquier dominio— termine el trabajo.
class VoeExtractor extends BaseExtractor {
  constructor() {
    super("voe", ["voe.sx", "*.voe.sx"]);
  }

  async resolve(embed, ctx) {
    let url = embed.url;
    let parent = ctx.referer || "";
    let html = "";
    for (let hop = 0; hop <= MAX_CHAIN; hop++) {
      try {
        html = await this.page(url, { parent: parent || undefined });
      } catch (e) {
        if (e && e.code === "host_not_allowed") {
          throw new ExtractorError("movido", "redirige a " + hostOf(url) + ", que el manifiesto no declara", this.id);
        }
        throw e;
      }
      const direct = directSourceIn(html) || encodedSourceIn(html, hostOf(url));
      if (direct) return this.stream({ url: direct, label: embed.label, referer: url });
      const moved = jsRedirect(html);
      if (!moved) break;
      parent = url;
      url = moved;
    }
    if (hasCaptcha(html)) throw new ExtractorError("captcha", "pide captcha y no expuso el video", this.id);
    throw new ExtractorError("no_video", "la página no expuso el video", this.id);
  }
}

// Último recurso de cada enlace: el navegador oculto ejecuta el JavaScript del reproductor y captura
// la petición real de video con sus cabeceras. Funciona con cualquier host declarado, incluso cuando
// el reproductor arma la URL en memoria o pasa por varios dominios.
class BrowserExtractor extends BaseExtractor {
  constructor() {
    super("navegador", []);
  }

  async resolve(embed, ctx) {
    const opts = { timeoutMs: CAPTURE_TIMEOUT_MS };
    // El Referer de la ficha solo se manda cuando se conoce (el flujo de película); en un servidor
    // elegido a mano (ref "srv|…") el navegador abre el embed solo, como antes.
    if (ctx && ctx.referer) opts.headers = this.headers(ctx.referer);
    const cap = await kino.browser.capture(embed.url, opts);
    const media = cap && cap.media ? cap.media : [];
    let best = "";
    for (let i = 0; i < media.length; i++) {
      if (media[i] && media[i].url && /^https:\/\//.test(media[i].url)) { best = media[i]; break; }
    }
    if (!best) throw new ExtractorError("no_video", "el navegador no capturó un video", this.id);
    const stream = { url: best.url, mime: mimeFor(best.mime, best.url) };
    if (best.headers && Object.keys(best.headers).length) stream.headers = best.headers;
    if (embed.label) stream.label = String(embed.label).slice(0, 48);
    const subs = subsFor(cap.subtitles || []);
    if (subs.length) stream.subtitles = subs;
    return stream;
  }
}

const DIRECT_EXTRACTORS = [new VoeExtractor(), new EmbedExtractor()];
const BROWSER_EXTRACTOR = new BrowserExtractor();

// Quién resuelve este enlace: su extractor propio, o el navegador como resolutor genérico de todo lo demás.
function extractorFor(url) {
  for (let i = 0; i < DIRECT_EXTRACTORS.length; i++) {
    if (DIRECT_EXTRACTORS[i].matches(url)) return DIRECT_EXTRACTORS[i];
  }
  return BROWSER_EXTRACTOR;
}

// ---------- Fuentes de respaldo: las otras webs de la ficha ----------
//
// La búsqueda y las fichas de Gnula son las principales. Cuando la búsqueda de Gnula no devuelve nada,
// se busca el mismo título en CineHax, Cinecalidad y Pelishax (ese orden) y se muestran sus resultados;
// al abrir uno, resolve() lee los servidores de esa web y los pasa al mismo recorrido de extractores que
// usa Gnula. Cada item guarda su origen en la ref: movie|ch|<id TMDB>, movie|cc|<slug>, movie|px|<id>
// (movie|slug a secas sigue siendo Gnula).

// El tráiler de YouTube nunca es una opción de reproducción.
function isTrailer(url) {
  const h = hostOf(url);
  return h === "www.youtube.com" || h === "youtube.com" || h === "youtu.be" || h === "youtube-nocookie.com";
}

// Ordena los servidores como los de Gnula: por la preferencia de PLAYER_PREF, los agregadores al final.
function rankEmbeds(list) {
  const rank = function (o) {
    const i = PLAYER_PREF.indexOf(hostOf(o.url));
    if (i >= 0) return i;
    return AGGREGATOR.indexOf(hostOf(o.url)) >= 0 ? 1000 : 500;
  };
  return list
    .map(function (o, i) { return { o: o, i: i }; })
    .sort(function (a, b) { return rank(a.o) - rank(b.o) || a.i - b.i; })
    .map(function (x) { return x.o; });
}

// La URL del póster, a salvo de las rarezas de cada plantilla: Pelishax la guarda dos veces pegada
// (".../w500/https://image.tmdb.org/..."), Cinecalidad deja un "/" de más y algunas van por http.
function posterUrl(raw) {
  let u = decodeEntities(String(raw == null ? "" : raw)).trim();
  if (!u || u.slice(0, 5) === "data:") return "";
  if (u.slice(0, 2) === "//") u = "https:" + u;
  const dup = u.lastIndexOf("http");
  if (dup > 0) u = u.slice(dup);
  u = u.replace(/(\/t\/p\/w\d+)\/\//, "$1/").replace(/^http:\/\//, "https://");
  return /^https:\/\//.test(u) ? u : "";
}

function sourceItem(src, id, title, poster, year) {
  const clean = String(title == null ? "" : title).replace(/\s+/g, " ").replace(/^[\s:]+|[\s:]+$/g, "").slice(0, 200);
  const item = { id: src + "-" + id, ref: "movie|" + src + "|" + id, title: clean, kind: "movie" };
  if (year) item.year = String(year).slice(0, 4);
  const img = posterUrl(poster);
  if (img) item.poster = img.slice(0, 2048);
  return item;
}

// CineHax: WordPress con búsqueda en el HTML (/search?q=). Sus servidores salen por AJAX protegido con un
// nonce que sí viene en la ficha; cuando el AJAX no entrega la URL, el navegador oculto abre la ficha y
// captura la petición real del reproductor.
const CINEHAX = {
  name: "CineHax",
  base: "https://cinehax.com",
  async search(q, limit) {
    const r = await kino.fetch(this.base + "/search?q=" + encodeURIComponent(q), { timeoutMs: FETCH_TIMEOUT_MS });
    if (!r.ok) throw new ExtractorError("gone", "CineHax respondió " + r.status, "cinehax");
    const html = r.text();
    const out = [];
    const seen = {};
    const re = /href="\/ver\/\?tipo=pelicula(?:&#038;|&amp;|&)id=(\d+)"[\s\S]{0,800}?<img[^>]*\b(?:data-src|src)="([^"]+)"[^>]*\balt="([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      out.push(sourceItem("ch", m[1], m[3], m[2], ""));
    }
    return out;
  },
  pageUrl(id) {
    return this.base + "/ver/?tipo=pelicula&id=" + encodeURIComponent(id);
  },
  async servers(id) {
    const pageUrl = this.pageUrl(id);
    const r = await kino.fetch(pageUrl, { timeoutMs: FETCH_TIMEOUT_MS });
    if (r.status === 404) throw new ExtractorError("gone", "CineHax ya no tiene esa película", "cinehax");
    if (!r.ok) throw new ExtractorError("gone", "CineHax respondió " + r.status, "cinehax");
    const html = r.text();
    const embeds = [];
    const seen = {};
    const nonce = (/"nonce":"([a-z0-9]+)"/.exec(html) || [])[1] || "";
    const idxs = html.match(/data-server-idx="\d+"/g) || [];
    let max = -1;
    for (let i = 0; i < idxs.length; i++) {
      const n = parseInt(/(\d+)/.exec(idxs[i])[1], 10);
      if (n > max) max = n;
    }
    for (let s = 0; nonce && s <= max && s < 8; s++) {
      try {
        const a = await kino.fetch(this.base + "/wp-admin/admin-ajax.php", {
          method: "POST",
          headers: pageHeaders(pageUrl),
          timeoutMs: FETCH_TIMEOUT_MS,
          body: { form: { action: "cinehax_get_embed", nonce: nonce, server: s, type: "movie", id: id, season: "", episode: "" } }
        });
        const url = a.ok ? embedUrlInJson(a.text()) : "";
        if (url && !seen[url]) {
          seen[url] = true;
          embeds.push({ url: url, label: ("CineHax " + (s + 1)).slice(0, 48) });
        }
      } catch (e) {
        log("cinehax: servidor " + s + " (" + errorKind(e) + ")");
      }
    }
    // Sin URL directa, el navegador abre la ficha: su JavaScript arma el reproductor y lo captura.
    if (!embeds.length) embeds.push({ url: pageUrl, label: "CineHax" });
    return { pageUrl: pageUrl, embeds: embeds };
  }
};

// Busca la URL del reproductor en la respuesta JSON del AJAX (estructura desconocida): mira las claves
// habituales y, si hay arreglo de resultados, su primer elemento.
function embedUrlInJson(text) {
  let data = null;
  try { data = JSON.parse(text); } catch (e) { return ""; }
  const keys = ["url", "embed", "file", "link", "src", "iframe"];
  const pick = function (v) {
    if (!v) return "";
    if (typeof v === "string") return /^https:\/\//.test(v) ? v : "";
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const u = pick(v[i]);
        if (u) return u;
      }
      return "";
    }
    if (typeof v === "object") {
      for (let k = 0; k < keys.length; k++) {
        if (v[keys[k]] != null) {
          const u = pick(v[keys[k]]);
          if (u) return u;
        }
      }
    }
    return "";
  };
  return pick(data);
}

// Cinecalidad: tema dooplay. La ficha trae todos sus servidores en data-option (vimeos, videoapp, voe,
// goodstream, hlswish, filemoon… y el tráiler de YouTube, que se descarta).
const CINECALIDAD = {
  name: "Cinecalidad",
  base: "https://www.cinecalidad.am",
  async search(q, limit) {
    const r = await kino.fetch(this.base + "/?s=" + encodeURIComponent(q), { timeoutMs: FETCH_TIMEOUT_MS });
    if (!r.ok) throw new ExtractorError("gone", "Cinecalidad respondió " + r.status, "cinecalidad");
    const html = r.text();
    const out = [];
    const seen = {};
    const re = /data-src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"[^>]*\balt="([^"]*)"[\s\S]{0,900}?\/ver-pelicula\/([^"\/]+)\/[\s\S]{0,400}?(?:<p>\s*((?:19|20)\d{2})\s*<\/p>)?/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
      const slug = m[3];
      if (seen[slug]) continue;
      seen[slug] = true;
      out.push(sourceItem("cc", slug, m[2], m[1], m[4] || ""));
    }
    return out;
  },
  pageUrl(id) {
    return this.base + "/ver-pelicula/" + encodeURIComponent(id) + "/";
  },
  async servers(id) {
    const pageUrl = this.pageUrl(id);
    const r = await kino.fetch(pageUrl, { timeoutMs: FETCH_TIMEOUT_MS });
    if (r.status === 404) throw new ExtractorError("gone", "Cinecalidad ya no tiene esa película", "cinecalidad");
    if (!r.ok) throw new ExtractorError("gone", "Cinecalidad respondió " + r.status, "cinecalidad");
    const html = r.text();
    const embeds = [];
    const seen = {};
    const re = /<li[^>]*\bdata-option="(https?:\/\/[^"]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(html))) {
      const url = stripHash(decodeEntities(m[1]).trim());
      if (!/^https:\/\//.test(url) || isTrailer(url) || seen[url]) continue;
      seen[url] = true;
      embeds.push({ url: url, label: friendlyHost(url).slice(0, 48) });
    }
    return { pageUrl: pageUrl, embeds: rankEmbeds(embeds) };
  }
};

// Pelishax: la web real del grupo (pelishax.com solo reparte el APK). Ficha en /movies/<id de TMDB> con
// la lista de servidores en li.server-item (data-link y el idioma en data-lang).
const PELISHAX = {
  name: "Pelishax",
  base: "https://pelishaxpro.com",
  async search(q, limit) {
    const r = await kino.fetch(this.base + "/search?q=" + encodeURIComponent(q), { timeoutMs: FETCH_TIMEOUT_MS });
    if (!r.ok) throw new ExtractorError("gone", "Pelishax respondió " + r.status, "pelishax");
    const html = r.text();
    const out = [];
    const seen = {};
    const re = /<a href="\/movies\/(\d+)"[^>]*>([\s\S]{0,900}?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < limit) {
      const id = m[1];
      if (seen[id]) continue;
      const chunk = m[2];
      const img = /\bdata-src="([^"]+)"/.exec(chunk);
      const alt = /\balt="([^"]*)"/.exec(chunk);
      const date = /movie-date">\s*((?:19|20)\d{2})\s*</.exec(chunk);
      seen[id] = true;
      out.push(sourceItem("px", id, alt ? alt[1] : "", img ? img[1] : "", date ? date[1] : ""));
    }
    return out;
  },
  pageUrl(id) {
    return this.base + "/movies/" + encodeURIComponent(id);
  },
  async servers(id) {
    const pageUrl = this.pageUrl(id);
    const r = await kino.fetch(pageUrl, { timeoutMs: FETCH_TIMEOUT_MS });
    if (r.status === 404) throw new ExtractorError("gone", "Pelishax ya no tiene esa película", "pelishax");
    if (!r.ok) throw new ExtractorError("gone", "Pelishax respondió " + r.status, "pelishax");
    const html = r.text();
    const embeds = [];
    const seen = {};
    const re = /data-link="(https?:\/\/[^"]+)"([\s\S]{0,200}?)data-lang="([^"]*)"/g;
    let m;
    while ((m = re.exec(html))) {
      const url = stripHash(decodeEntities(m[1]).trim());
      if (!/^https:\/\//.test(url) || isTrailer(url) || seen[url]) continue;
      const lang = String(m[3]).replace(/\s+/g, " ").trim().slice(0, 18);
      seen[url] = true;
      embeds.push({ url: url, label: (friendlyHost(url) + (lang ? " " + lang : "")).slice(0, 48) });
    }
    return { pageUrl: pageUrl, embeds: rankEmbeds(embeds) };
  }
};

const SOURCES = { ch: CINEHAX, cc: CINECALIDAD, px: PELISHAX };
const FALLBACK_ORDER = ["ch", "cc", "px"];
const SOURCE_SHORT = { ch: "CineHax", cc: "Cinecalidad", px: "Pelishax" };

// La búsqueda de respaldo: se prueban las webs en orden, se quitan repetidos (misma película y año) y se
// ordenan por parecido al título buscado. El nombre de la web se añade al final, ya ordenado.
async function fallbackSearch(q, titles) {
  const raw = [];
  const seen = {};
  for (let i = 0; i < FALLBACK_ORDER.length && raw.length < SEARCH_MAX; i++) {
    const key = FALLBACK_ORDER[i];
    try {
      const items = await SOURCES[key].search(q, SEARCH_MAX);
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const dedupe = squash(it.title) + (it.year || "");
        if (!it.title || seen[dedupe]) continue;
        seen[dedupe] = true;
        raw.push({ it: it, key: key });
      }
      log("respaldo " + SOURCES[key].name + ": " + items.length + " resultado(s)");
    } catch (e) {
      log("respaldo " + SOURCES[key].name + " falló (" + errorKind(e) + ")");
    }
  }
  if (!raw.length) return [];
  const ranked = kino.rank.sortBySimilarity(raw.map(function (r) { return r.it; }), titles);
  const shortOf = {};
  for (let i = 0; i < raw.length; i++) shortOf[raw[i].it.id] = SOURCE_SHORT[raw[i].key];
  return ranked.slice(0, SEARCH_MAX).map(function (it) {
    it.title = (it.title + " · " + shortOf[it.id]).slice(0, 200);
    return it;
  });
}

// ---------- Lógica central: recorrer los servidores hasta que uno funcione ----------

// Primero un servidor por cada host distinto (una película vieja repite el mismo en cada idioma),
// luego el resto — los embeds llegan ordenados por PLAYER_PREF desde serverOptions.
function orderEmbeds(embeds) {
  const order = [];
  const usedHost = new Set();
  for (let i = 0; i < embeds.length && order.length < 3; i++) {
    const h = hostOf(embeds[i].url);
    if (usedHost.has(h)) continue;
    usedHost.add(h);
    order.push(i);
  }
  for (let i = 0; i < embeds.length; i++) {
    if (order.indexOf(i) < 0) order.push(i);
  }
  return order;
}

// Los servidores que no fueron el ganador, como botones manuales ("srv|…"): primero los de la ficha,
// luego los que reveló un agregador; nunca el ganador ni repetidos, máximo 8.
function withAlternatives(stream, embeds, chained, winner) {
  const rest = [];
  const used = {};
  used[winner.url] = true;
  const add = function (list) {
    for (let i = 0; i < list.length && rest.length < 8; i++) {
      const u = list[i].url;
      if (used[u]) continue;
      used[u] = true;
      rest.push({ label: list[i].label, ref: "srv|" + u });
    }
  };
  add(embeds);
  add(chained);
  if (rest.length) stream.alternatives = rest;
  return stream;
}

async function resolveEmbeds(embeds, referer) {
  if (!embeds.length) {
    throw kino.error("not_found", "sin reproductores", { userMessage: "No se encontraron servidores para esta película." });
  }
  const started = Date.now();
  const queue = [];
  const seen = {};
  const chained = [];
  const order = orderEmbeds(embeds);
  for (let i = 0; i < order.length; i++) {
    const e = embeds[order[i]];
    seen[e.url] = true;
    queue.push({ url: e.url, label: e.label, depth: 0 });
  }

  // Encadenado: lo que un agregador o iframe revela se añade al final de la cola — solo si es un
  // reproductor conocido (un iframe de publicidad no lleva a ninguna parte útil) y sin repetir.
  const enqueue = function (urls, from) {
    if (from.depth >= MAX_CHAIN) return 0;
    let n = 0;
    for (let i = 0; i < urls.length && n < MAX_CHAIN; i++) {
      const u = urls[i];
      if (seen[u] || u === from.url) continue;
      if (!hostIn(u, PLAYER_PREF) && !hostIn(u, AGGREGATOR)) continue;
      seen[u] = true;
      const label = friendlyHost(u);
      chained.push({ url: u, label: label });
      queue.push({ url: u, label: label, depth: from.depth + 1 });
      n++;
    }
    return n;
  };

  let last = null;
  while (queue.length) {
    if (Date.now() - started > RESOLVE_BUDGET_MS) {
      log("resolve: presupuesto de tiempo agotado, se deja el resto de servidores");
      break;
    }
    const emb = queue.shift();
    const direct = extractorFor(emb.url);
    // 1) el extractor del host (fetch directo): si rinde, listo; si falla, se registra y sigue.
    if (direct !== BROWSER_EXTRACTOR) {
      try {
        const out = await direct.resolve(emb, { referer: referer });
        if (out && Array.isArray(out.next)) {
          const n = enqueue(out.next, emb);
          log("resolve: " + hostOf(emb.url) + " encadena a " + n + " reproductor(es)");
          continue;
        }
        return withAlternatives(out, embeds, chained, emb);
      } catch (e) {
        last = e;
        log("resolve: extractor " + direct.id + " en " + hostOf(emb.url) + " falló (" + errorKind(e) + "): " + (e && e.message ? e.message : e));
      }
    }
    // 2) el navegador cierra cada enlace: es el único que ejecuta el JavaScript del reproductor.
    try {
      const stream = await BROWSER_EXTRACTOR.resolve(emb, { referer: referer });
      return withAlternatives(stream, embeds, chained, emb);
    } catch (e) {
      last = e;
      log("resolve: navegador en " + hostOf(emb.url) + " falló (" + errorKind(e) + ")");
    }
  }
  if (last) throw last;
  throw kino.error("unavailable", "No se pudo reproducir la película");
}

export async function resolve(ref) {
  await null;
  const text = String(ref == null ? "" : ref);
  const cut = text.indexOf("|");
  const kind = cut < 0 ? text : text.slice(0, cut);
  const value = cut < 0 ? "" : text.slice(cut + 1);
  if (kind === "srv") {
    if (!/^https:\/\//.test(value)) throw kino.error("not_found", "Servidor inválido");
    return await resolveEmbeds([{ url: value, label: friendlyHost(value) }], null);
  }
  if (kind !== "movie") throw kino.error("not_found", "Referencia desconocida");
  // movie|<src>|<id> = una web de respaldo; movie|<slug> a secas = Gnula.
  const bar = value.indexOf("|");
  const srcKey = bar < 0 ? "" : value.slice(0, bar);
  const id = bar < 0 ? value : value.slice(bar + 1);
  const source = srcKey && Object.prototype.hasOwnProperty.call(SOURCES, srcKey) ? SOURCES[srcKey] : null;
  if (bar >= 0 && !source) throw kino.error("not_found", "Referencia desconocida");
  if (source) {
    if (!id) throw kino.error("not_found", "Referencia desconocida");
    const got = await source.servers(id);
    if (!got.embeds.length) {
      throw kino.error("not_found", "sin reproductores", { userMessage: "No se encontraron servidores para esta película." });
    }
    return await resolveEmbeds(withLabels(got.embeds), got.pageUrl);
  }
  const pageUrl = BASE + "/movie/" + value + "/";
  const r = await kino.fetch(pageUrl, { timeoutMs: FETCH_TIMEOUT_MS });
  if (r.status === 404) {
    throw kino.error("not_found", "gnula ya no tiene esa película", { userMessage: "Esta película ya no está disponible." });
  }
  if (!r.ok) throw kino.error("unavailable", "gnula respondió " + r.status);
  const opts = withLabels(serverOptions(r.text()));
  if (!opts.length) {
    throw kino.error("not_found", "sin reproductores", { userMessage: "No se encontraron servidores para esta película." });
  }
  return await resolveEmbeds(opts, pageUrl);
}
