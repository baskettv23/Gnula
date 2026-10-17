// Kino plugin: Gnula (gnula.one) — películas y anime en español.
//
// Hosts declarados: www2.gnula.one (y gnula.one) para el catálogo, y los reproductores externos que la ficha
// de cada película incluye (links.cuevana.ac, player.cuevana.ac, voe.sx, filemoon.sx, waaw.to). El video final
// vive en CDNs variables, por eso el manifiesto pide "streamHosts": "any"; y para abrir el reproductor oculto
// y capturar el .m3u8/.mp4 pide "browser": true (permiso rojo que la persona aprueba al instalar).
//
// No hay rutas de kino.fetch hacia el video: los reproductores arman la dirección con JavaScript, así que
// resolve() abre el reproductor en el navegador oculto (kino.browser.capture) y captura la petición de video.

const BASE = "https://www2.gnula.one";

// Reproductores preferidos, los que más directo entregan un HLS/mp4 primero. Las páginas "agregadoras"
// (links.cuevana.ac) que solo listan botones quedan al final.
const PLAYER_PREF = [
  "voe.sx", "filemoon.sx", "player.cuevana.ac", "waaw.to", "upstream.to", "hqq.to", "fembed.com",
  "waaw.in", "streamplay.to", "streamtape.com", "mixdrop.ch", "jawcloud.co", "formatearwindows.net",
  "fsapi.xyz", "player.moovies.in", "pelisplushd.net", "player.cuevana3.one"
];
const AGGREGATOR = ["links.cuevana.ac"];
const PLAYER_NAME = {
  "voe.sx": "Voe",
  "filemoon.sx": "Filemoon",
  "player.cuevana.ac": "Cuevana Player",
  "waaw.to": "Waaw",
  "links.cuevana.ac": "Cuevana",
  "upstream.to": "Upstream",
  "hqq.to": "HQQ",
  "fembed.com": "Fembed",
  "waaw.in": "Waaw",
  "streamplay.to": "Streamplay",
  "streamtape.com": "Streamtape",
  "mixdrop.ch": "Mixdrop",
  "jawcloud.co": "Jawcloud",
  "formatearwindows.net": "FormatearWindows",
  "fsapi.xyz": "Fsapi",
  "player.moovies.in": "Moovies",
  "pelisplushd.net": "Pelisplushd",
  "player.cuevana3.one": "Cuevana 3"
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

async function captureOne(url, label) {
  const cap = await kino.browser.capture(url, { timeoutMs: 20000 });
  const media = cap && cap.media ? cap.media : [];
  let best = "";
  for (let i = 0; i < media.length; i++) {
    if (media[i] && media[i].url && /^https:\/\//.test(media[i].url)) { best = media[i]; break; }
  }
  if (!best) throw kino.error("unavailable", "El servidor no entregó un video");
  const stream = { url: best.url, mime: mimeFor(best.mime, best.url) };
  if (best.headers && Object.keys(best.headers).length) stream.headers = best.headers;
  if (label) stream.label = String(label).slice(0, 48);
  const subs = subsFor(cap.subtitles || []);
  if (subs.length) stream.subtitles = subs;
  return stream;
}

async function tryCapture(opts) {
  // Se intentan hasta 3 servidores, prefiriendo hosts distintos (una película vieja repite el mismo en cada idioma).
  const order = [];
  const usedHost = new Set();
  for (let i = 0; i < opts.length && order.length < 3; i++) {
    const h = hostOf(opts[i].url);
    if (usedHost.has(h)) continue;
    usedHost.add(h);
    order.push(i);
  }
  for (let i = 0; i < opts.length && order.length < 3; i++) {
    if (order.indexOf(i) < 0) order.push(i);
  }
  let lastError = null;
  for (let a = 0; a < order.length; a++) {
    const idx = order[a];
    try {
      const stream = await captureOne(opts[idx].url, opts[idx].label);
      const rest = [];
      for (let k = 0; k < opts.length && rest.length < 8; k++) {
        if (k === idx) continue;
        rest.push({ label: opts[k].label, ref: "srv|" + opts[k].url });
      }
      if (rest.length) stream.alternatives = rest;
      return stream;
    } catch (e) {
      lastError = e;
      log("reproductor falló", hostOf(opts[idx].url), e && e.code ? e.code : (e && e.message));
    }
  }
  if (lastError) throw lastError;
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
    return await captureOne(value, friendlyHost(value));
  }
  if (kind !== "movie") throw kino.error("not_found", "Referencia desconocida");
  const r = await kino.fetch(BASE + "/movie/" + value + "/");
  if (r.status === 404) {
    throw kino.error("not_found", "gnula ya no tiene esa película", { userMessage: "Esta película ya no está disponible." });
  }
  if (!r.ok) throw kino.error("unavailable", "gnula respondió " + r.status);
  const opts = withLabels(serverOptions(r.text()));
  if (!opts.length) {
    throw kino.error("not_found", "sin reproductores", { userMessage: "No se encontraron servidores para esta película." });
  }
  return await tryCapture(opts);
}
