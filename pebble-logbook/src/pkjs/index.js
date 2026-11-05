// Logbook phone-side code (runs inside the Rebble / Pebble app).
//  - Answers the watch's requests: search, browse, continue, recent.
//  - Keeps the rating history in the phone's storage.
//  - Opens the history / settings page.
//  - Tells optional integrations (Google Sheets, ...) about every rating.
// Plain ES5 for maximum compatibility.

var configHtml = require('./config_html');
var sheetsConfig = require('./sheets_config');
var stats = require('./stats');
var names = require('./names');
var nowplaying = require('./nowplaying');

var MAX_ENTRIES = 25;
var LABEL_MAX = 31;
var REF_MAX = 39;
var MAX_LOG = 2000;
var PAGE_LOG = 300;           // how much history the settings page shows
var TV_CACHE_MS = 7 * 24 * 3600 * 1000;
var TMDB_IMG = 'https://image.tmdb.org/t/p/w92';

var F_RATE = 1;
var F_OPEN = 2;

// ---------------------------------------------------------------- storage

function load(k, fallback) {
  try {
    var v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(k, val) {
  try { localStorage.setItem(k, JSON.stringify(val)); } catch (e) {}
}

var state = {
  tmdbKey: load('tmdbKey', ''),
  log: load('log', []),
  tv: load('tv', {}),         // cached show info: id -> {name, seasons:{n:count}, ts}
  sheetsUrl: load('sheetsUrl', ''),
  syncQueue: load('syncQueue', []),  // rows waiting to be sent to Google Sheets
  evQueue: load('evQueue', []),      // events (ratings, notes, bookmarks) waiting to be sent
  people: load('people', []),        // people you have logged: {ref, name, count, last}
  aliases: load('aliases', {}),      // how a name was heard -> the person it turned out to be
  meets: load('meets', []),          // every "met" event, kept so a backfill can resend them
  marks: load('marks', []),          // bookmarks and notes: {ref, title, cat, pos, note, ts}
  favs: load('favs', []),            // pinned shows, podcasts, albums: {ref, title, cat}
  seen: load('seen', {}),            // Letterboxd: tmdb ref or title key -> stars (0 = watched, not rated)
  lbUser: load('lbUser', ''),
  lbAt: load('lbAt', 0)
};
var meta = {};                // ref -> {title, art}, filled as lists are built

// ---------------------------------------------------------------- helpers

function clean(t, max) {
  t = String(t == null ? '' : t);
  if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[‘’]/g, "'")
       .replace(/[“”]/g, '"')
       .replace(/[–—]/g, '-')
       .replace(/…/g, '...');
  t = t.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  if (t.length > max) t = t.substr(0, max - 1) + '.';
  return t;
}

function year(d) {
  return d && String(d).length >= 4 ? String(d).slice(0, 4) : '';
}

function withYear(title, d) {
  var y = year(d);
  return y ? title + ' (' + y + ')' : title;
}

function qs(params) {
  return Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

function getJSON(url, headers, cb) {
  var done = false;
  function finish(err, data) { if (!done) { done = true; cb(err, data); } }
  var x = new XMLHttpRequest();
  x.timeout = 12000;
  x.onload = function () {
    if (x.status < 200 || x.status >= 300) { finish(new Error('HTTP ' + x.status)); return; }
    try { finish(null, JSON.parse(x.responseText)); } catch (e) { finish(new Error('Bad reply')); }
  };
  x.onerror = function () { finish(new Error('No internet')); };
  x.ontimeout = function () { finish(new Error('Timed out')); };
  x.open('GET', url);
  if (headers) for (var h in headers) x.setRequestHeader(h, headers[h]);
  x.send();
}

function tmdb(path, params, cb) {
  if (!state.tmdbKey) { cb(new Error('Add TMDB key in settings')); return; }
  params = params || {};
  var headers = null;
  if (state.tmdbKey.length > 40) headers = { Authorization: 'Bearer ' + state.tmdbKey };
  else params.api_key = state.tmdbKey;
  getJSON('https://api.themoviedb.org/3' + path + '?' + qs(params), headers, cb);
}

function itunes(path, params, cb) {
  getJSON('https://itunes.apple.com/' + path + '?' + qs(params), null, cb);
}

function entry(label, ref, flags) {
  return { label: clean(label, LABEL_MAX), ref: clean(ref, REF_MAX), flags: flags };
}

function remember(ref, title, art) {
  meta[ref] = { title: title, art: art || '' };
}

function art(poster) {
  return poster ? TMDB_IMG + poster : '';
}

function bigArt(url) {
  return url ? String(url).replace('100x100', '200x200') : '';
}

function toast(msg) {
  try { if (Pebble.showSimpleToast) Pebble.showSimpleToast(msg); } catch (e) {}
}

// ---------------------------------------------------------------- searching
// Reference formats (the watch only ever echoes them back):
//   m:ID movie     t:ID show     ts:ID:N[:OFFSET] season     te:ID:N:E episode
//   p:ID podcast   pe:ID:TRACK   a:ID album       at:ID:TRACK
//   b:ID book (Open Library work id)   bg:ID book (Google Books id)
//   s:ID song   g:ID game (Steam app id)   r:ID recipe (TheMealDB)   x:SLUG anything you say

function searchMovie(q, cb) {
  tmdb('/search/movie', { query: q, include_adult: 'false' }, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.results || []).slice(0, 8).forEach(function (r) {
      var title = withYear(r.title || r.original_title || 'Movie', r.release_date);
      var e = entry(title, 'm:' + r.id, F_RATE);
      remember(e.ref, title, art(r.poster_path));
      out.push(e);
    });
    cb(null, out);
  });
}

function searchTv(q, cb) {
  tmdb('/search/tv', { query: q }, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.results || []).slice(0, 8).forEach(function (r) {
      var title = withYear(r.name || r.original_name || 'Show', r.first_air_date);
      var e = entry(title, 't:' + r.id, F_OPEN);
      remember(e.ref, title, art(r.poster_path));
      meta[e.ref].show = r.name || title;
      out.push(e);
    });
    cb(null, out);
  });
}

function searchPodcast(q, cb) {
  itunes('search', { media: 'podcast', entity: 'podcast', limit: 8, term: q }, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.results || []).forEach(function (r) {
      if (!r.collectionId) return;
      var e = entry(r.collectionName || r.trackName || 'Podcast', 'p:' + r.collectionId, F_OPEN);
      remember(e.ref, r.collectionName || r.trackName, bigArt(r.artworkUrl100));
      out.push(e);
    });
    cb(null, out);
  });
}

function searchAlbum(q, cb) {
  itunes('search', { media: 'music', entity: 'album', limit: 8, term: q }, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.results || []).forEach(function (r) {
      if (!r.collectionId) return;
      var title = (r.artistName ? r.artistName + ' - ' : '') + r.collectionName;
      var e = entry(r.collectionName + (r.artistName ? ' - ' + r.artistName : ''), 'a:' + r.collectionId, F_OPEN);
      remember(e.ref, title, bigArt(r.artworkUrl100));
      out.push(e);
    });
    cb(null, out);
  });
}

// Books: ask Google Books and Open Library (twice: general text and author name)
// at the same time, merge, and put books whose author matches what you said first.
function norm(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '');
}

function bookGoogle(q, cb) {
  var url = 'https://www.googleapis.com/books/v1/volumes?' + qs({
    q: q, maxResults: 10, printType: 'books',
    fields: 'items(id,volumeInfo(title,authors,publishedDate,imageLinks/thumbnail))'
  });
  getJSON(url, null, function (err, d) {
    if (err) return cb(err);
    cb(null, (d.items || []).map(function (it) {
      var v = it.volumeInfo || {};
      var img = v.imageLinks && v.imageLinks.thumbnail ? String(v.imageLinks.thumbnail).replace(/^http:/, 'https:') : '';
      return { ref: 'bg:' + it.id, title: v.title || '', author: (v.authors || [])[0] || '', art: img };
    }));
  });
}

function bookOpenLibrary(params, cb) {
  params.limit = 10;
  params.fields = 'key,title,author_name,first_publish_year,cover_i';
  getJSON('https://openlibrary.org/search.json?' + qs(params), null, function (err, d) {
    if (err) return cb(err);
    cb(null, (d.docs || []).map(function (r) {
      return {
        ref: 'b:' + String(r.key || '').replace('/works/', ''),
        title: r.title || '',
        author: (r.author_name || [])[0] || '',
        art: r.cover_i ? 'https://covers.openlibrary.org/b/id/' + r.cover_i + '-M.jpg' : ''
      };
    }));
  });
}

function searchBook(q, cb) {
  var lists = [], pending = 3, firstErr = null;
  function finish(err, items) {
    if (err) firstErr = firstErr || err; else lists.push(items);
    if (--pending > 0) return;
    if (!lists.length) return cb(firstErr || new Error('Book search failed'));

    var tokens = norm(q).split(' ').filter(Boolean);
    function authorMatch(b) {
      var a = norm(b.author);
      return !!a && tokens.length > 0 && tokens.every(function (t) { return a.indexOf(t) >= 0; });
    }
    var all = [];
    // sources interleaved so one noisy source cannot crowd out the others
    for (var i = 0; i < 10; i++) {
      lists.forEach(function (l) { if (l[i] && l[i].title && l[i].ref.length > 3) all.push(l[i]); });
    }
    var seen = {}, unique = [];
    all.forEach(function (b) {
      var key = norm(b.title) + '|' + norm(b.author).slice(0, 8);
      if (seen[key]) {
        if (!seen[key].art && b.art) seen[key].art = b.art;   // keep a cover if any source has one
        return;
      }
      seen[key] = b;
      unique.push(b);
    });
    var ordered = unique.filter(authorMatch).concat(unique.filter(function (b) { return !authorMatch(b); }));
    cb(null, ordered.slice(0, 8).map(function (b) {
      var title = b.title + (b.author ? ' - ' + b.author : '');
      var e = entry(title, b.ref, F_RATE);
      remember(e.ref, title, b.art);
      return e;
    }));
  }
  bookGoogle(q, finish);
  bookOpenLibrary({ q: q }, finish);
  bookOpenLibrary({ author: q }, finish);
}

function searchSong(q, cb) {
  itunes('search', { media: 'music', entity: 'song', limit: 8, term: q }, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.results || []).forEach(function (r) {
      if (!r.trackId || !r.trackName) return;
      var title = (r.artistName ? r.artistName + ' - ' : '') + r.trackName;
      var e = entry(r.trackName + (r.artistName ? ' - ' + r.artistName : ''), 's:' + r.trackId, F_RATE);
      remember(e.ref, title, bigArt(r.artworkUrl100));
      out.push(e);
    });
    cb(null, out);
  });
}

// Games come from Steam's store search (no key needed).
function searchGame(q, cb) {
  getJSON('https://store.steampowered.com/api/storesearch/?' + qs({ term: q, l: 'english', cc: 'US' }), null, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.items || []).slice(0, 8).forEach(function (r) {
      if (!r.id || !r.name) return;
      var e = entry(r.name, 'g:' + r.id, F_RATE);
      remember(e.ref, r.name, r.tiny_image || '');
      out.push(e);
    });
    cb(null, out);
  });
}

// Recipes come from TheMealDB's free test key.
function searchRecipe(q, cb) {
  getJSON('https://www.themealdb.com/api/json/v1/1/search.php?' + qs({ s: q }), null, function (err, d) {
    if (err) return cb(err);
    var out = [];
    (d.meals || []).slice(0, 8).forEach(function (r) {
      if (!r.idMeal || !r.strMeal) return;
      var e = entry(r.strMeal + (r.strArea ? ' - ' + r.strArea : ''), 'r:' + r.idMeal, F_RATE);
      remember(e.ref, r.strMeal + (r.strArea ? ' (' + r.strArea + ')' : ''), r.strMealThumb ? r.strMealThumb + '/preview' : '');
      out.push(e);
    });
    cb(null, out);
  });
}

// Anything else (a restaurant, a coffee, a class trip...): no lookup, whatever you said
// becomes the item. The same words always give the same item, so re-rating updates it.
function searchAnything(q, cb) {
  var text = String(q || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
  var slug = norm(text).replace(/ /g, '-').slice(0, 36);
  if (!slug) return cb(null, []);
  var e = entry(text, 'x:' + slug, F_RATE);
  remember(e.ref, text.slice(0, 80), '');
  cb(null, [e]);
}

// The position here is the "kind" number the watch sends (see KIND_NAMES in main.c).
var SEARCHERS = [searchMovie, searchTv, searchPodcast, searchAlbum, searchBook,
                 searchSong, searchGame, searchRecipe, searchAnything];

// One search across every kind (the watch's "say it first" flow sends kind 9).
// All the lookups run at once; results are ranked by how closely the title matches
// what you said, color-coded on the watch by kind, and the last row logs your words
// as they are.
var KIND_ALL = 9;
var ALL_KINDS = [0, 1, 2, 3, 5, 4, 6, 7];
var KIND_WORD = ['Movie', 'TV', 'Podcast', 'Album', 'Book', 'Song', 'Game', 'Recipe', 'Anything'];
var ALL_TOTAL = 14;
var ALL_PER_KIND = 3;
var ALL_DEADLINE_MS = 9000;

// Watch labels look like "Title - Detail" or "Title (2021)".
function splitLabel(label) {
  var i = label.lastIndexOf(' - ');
  var m;
  if (i > 0) return { base: label.slice(0, i), detail: label.slice(i + 3) };
  if ((m = /^(.*) \((\d{4})\)$/.exec(label))) return { base: m[1], detail: m[2] };
  return { base: label, detail: '' };
}

// ...and in the mixed list they become "Title - Kind, Detail".
function mixedLabel(label, k) {
  var parts = splitLabel(label);
  var base = parts.base, detail = parts.detail;
  var word = KIND_WORD[k];
  var room = 20 - 3 - word.length - 2;          // keep the kind word, trim the detail
  if (detail.length > room) detail = room > 3 ? detail.slice(0, room) : '';
  var tail = ' - ' + word + (detail ? ', ' + detail : '');
  return clean(base, LABEL_MAX - tail.length) + tail;
}

function matchScore(title, q) {
  var t = norm(title), n = norm(q);
  if (!n) return 3;
  if (t === n) return 0;
  if (t.indexOf(n) === 0) return 1;
  if (t.indexOf(n) >= 0) return 2;
  return 3;
}

function searchAll(q, cb) {
  var lists = {};
  var pending = ALL_KINDS.length;
  var finished = false;
  var firstErr = null;
  var timer = null;

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    var cands = [];
    ALL_KINDS.forEach(function (k) {
      (lists[k] || []).forEach(function (e, pos) {
        cands.push({ k: k, e: decorate(e), key: matchScore(splitLabel(e.label).base, q) * 4 + pos });
      });
    });
    var order = ALL_KINDS.slice();
    cands.sort(function (a, b) { return a.key - b.key || order.indexOf(a.k) - order.indexOf(b.k); });
    var used = {}, out = [];
    cands.forEach(function (c) {
      if (out.length >= ALL_TOTAL || (used[c.k] || 0) >= ALL_PER_KIND) return;
      used[c.k] = (used[c.k] || 0) + 1;
      out.push(entry(mixedLabel(c.e.label, c.k), c.e.ref, c.e.flags));
    });
    if (!out.length && firstErr) { cb(firstErr); return; }
    searchAnything(q, function (err, any) {
      if (any && any[0]) {
        out.push(entry(mixedLabel(any[0].label, 8), any[0].ref, F_RATE));
      }
      cb(null, out);
    });
  }

  ALL_KINDS.forEach(function (k) {
    var got = false;
    function got1(err, list) {
      if (got) return;
      got = true;
      if (err) { if (!firstErr) firstErr = err; lists[k] = []; }
      else lists[k] = list || [];
      if (--pending === 0) finish();
    }
    try { SEARCHERS[k](q, got1); } catch (e) { got1(e); }
  });
  timer = setTimeout(finish, ALL_DEADLINE_MS);
}

// ---------------------------------------------------------------- browsing

function tvInfo(id, cb) {
  var c = state.tv[id];
  if (c && Date.now() - c.ts < TV_CACHE_MS) { cb(null, c); return; }
  tmdb('/tv/' + id, {}, function (err, d) {
    if (err) { if (c) cb(null, c); else cb(err); return; }
    var seasons = {};
    (d.seasons || []).forEach(function (s) {
      if (s.season_number > 0 && s.episode_count > 0) seasons[s.season_number] = s.episode_count;
    });
    var info = { name: d.name || 'Show', seasons: seasons, poster: d.poster_path || '', ts: Date.now() };
    state.tv[id] = info;
    save('tv', state.tv);
    cb(null, info);
  });
}

function browseShow(id, cb) {
  tvInfo(id, function (err, info) {
    if (err) return cb(err);
    var showRef = 't:' + id;
    if (!meta[showRef]) remember(showRef, info.name, art(info.poster));
    var out = [entry('Rate whole show', showRef, F_RATE)];
    Object.keys(info.seasons).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      var e = entry('Season ' + n + ' (' + info.seasons[n] + ' eps)', 'ts:' + id + ':' + n, F_OPEN);
      remember(e.ref, info.name + ' S' + n, art(info.poster));
      out.push(e);
    });
    cb(null, out.slice(0, MAX_ENTRIES));
  });
}

function browseSeason(id, n, offset, cb) {
  tvInfo(id, function (err, info) {
    if (err) return cb(err);
    tmdb('/tv/' + id + '/season/' + n, {}, function (err2, d) {
      if (err2) return cb(err2);
      var eps = d.episodes || [];
      var per = MAX_ENTRIES - 1;
      var out = [];
      eps.slice(offset, offset + per).forEach(function (ep) {
        var e = entry('E' + ep.episode_number + ' ' + (ep.name || ''), 'te:' + id + ':' + n + ':' + ep.episode_number, F_RATE);
        remember(e.ref, info.name + ' S' + n + 'E' + ep.episode_number + (ep.name ? ' ' + ep.name : ''), art(info.poster));
        out.push(e);
      });
      if (eps.length > offset + per) out.push(entry('More episodes...', 'ts:' + id + ':' + n + ':' + (offset + per), F_OPEN));
      cb(null, out);
    });
  });
}

function browsePodcast(id, cb) {
  itunes('lookup', { id: id, entity: 'podcastEpisode', limit: 25 }, function (err, d) {
    if (err) return cb(err);
    var results = d.results || [];
    var show = null, eps = [];
    results.forEach(function (r) {
      if (r.kind === 'podcast') {
        show = show || r;
      } else if (r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode') {
        eps.push(r);
      }
    });
    var showName = (show && (show.collectionName || show.trackName)) || (meta['p:' + id] && meta['p:' + id].title) || 'Podcast';
    var showArt = (show && bigArt(show.artworkUrl100)) || (meta['p:' + id] && meta['p:' + id].art) || '';
    if (!meta['p:' + id]) remember('p:' + id, showName, showArt);
    eps.sort(function (a, b) { return String(b.releaseDate).localeCompare(String(a.releaseDate)); });
    var out = [entry('Rate whole podcast', 'p:' + id, F_RATE)];
    eps.slice(0, MAX_ENTRIES - 1).forEach(function (r) {
      var when = r.releaseDate ? (new Date(r.releaseDate).getMonth() + 1) + '/' + new Date(r.releaseDate).getDate() + ' ' : '';
      var e = entry(when + (r.trackName || 'Episode'), 'pe:' + id + ':' + r.trackId, F_RATE);
      remember(e.ref, showName + ': ' + (r.trackName || 'Episode'), showArt);
      out.push(e);
    });
    cb(null, out);
  });
}

function browseAlbum(id, cb) {
  itunes('lookup', { id: id, entity: 'song', limit: 50 }, function (err, d) {
    if (err) return cb(err);
    var results = d.results || [];
    var album = null, tracks = [];
    results.forEach(function (r) {
      if (r.wrapperType === 'collection') album = r;
      else if (r.wrapperType === 'track') tracks.push(r);
    });
    var artist = (album && album.artistName) || '';
    var name = (album && album.collectionName) || (meta['a:' + id] && meta['a:' + id].title) || 'Album';
    var cover = (album && bigArt(album.artworkUrl100)) || (meta['a:' + id] && meta['a:' + id].art) || '';
    if (!meta['a:' + id]) remember('a:' + id, (artist ? artist + ' - ' : '') + name, cover);
    tracks.sort(function (a, b) { return (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0); });
    var out = [entry('Rate whole album', 'a:' + id, F_RATE)];
    tracks.slice(0, MAX_ENTRIES - 1).forEach(function (r) {
      var e = entry((r.trackNumber ? r.trackNumber + '. ' : '') + r.trackName, 'at:' + id + ':' + r.trackId, F_RATE);
      remember(e.ref, (artist ? artist + ' - ' : '') + r.trackName + ' (' + name + ')', cover);
      out.push(e);
    });
    cb(null, out);
  });
}

function browse(ref, cb) {
  var p = String(ref).split(':');
  if (p[0] === 't') return browseShow(p[1], cb);
  if (p[0] === 'ts') return browseSeason(p[1], +p[2], +(p[3] || 0), cb);
  if (p[0] === 'p') return browsePodcast(p[1], cb);
  if (p[0] === 'a') return browseAlbum(p[1], cb);
  cb(new Error('Cannot open that'));
}

// ---------------------------------------------------------------- integrations
// An integration is a small object that hears about every rating:
//   name       short id, used in log lines
//   enabled()  true when the user has set it up
//   onMeet(ev)    optional: called after you log meeting someone, ev = the event (see logPerson)
//   onMark(mk)    optional: called after a note or bookmark is saved, mk = { ref, cat, title, pos, note, ts }
//   onRated(rec)  called after a rating is saved (or edited on the settings page);
//                 rec = { ref, cat, title, art, stars, ts }
//   flush()    optional: retry anything still pending (called when the app starts)
// A failing integration never gets in the way of logging a rating.

var integrations = [];

function registerIntegration(it) {
  integrations.push(it);
}

function fireRated(rec) {
  integrations.forEach(function (it) {
    try {
      if (it.enabled()) it.onRated(rec);
    } catch (e) {
      console.log('Logbook: ' + it.name + ' onRated failed: ' + e);
    }
  });
}

function fireMark(mk) {
  integrations.forEach(function (it) {
    try {
      if (it.enabled() && it.onMark) it.onMark(mk);
    } catch (e) {
      console.log('Logbook: ' + it.name + ' onMark failed: ' + e);
    }
  });
}

function fireMeet(ev) {
  integrations.forEach(function (it) {
    try {
      if (it.enabled() && it.onMeet) it.onMeet(ev);
    } catch (e) {
      console.log('Logbook: ' + it.name + ' onMeet failed: ' + e);
    }
  });
}

function flushIntegrations() {
  integrations.forEach(function (it) {
    try {
      if (it.enabled() && it.flush) it.flush();
    } catch (e) {
      console.log('Logbook: ' + it.name + ' flush failed: ' + e);
    }
  });
}

// ---------------------------------------------------------------- Google Sheets
// Sends each rating to a Google Apps Script web app (see sheets_config.js for the
// script). Rows are keyed by ref, so re-rating updates the same row and a retry can
// never create a duplicate. Ratings that cannot be sent (no signal) wait in a saved
// queue and go out later, oldest first.

var SYNC_BATCH = 40;
var SYNC_MAX = 3000;
var SYNC_RETRY_MS = 60000;
var SHEETS_URL_RE = /^https:\/\/script\.google(usercontent)?\.com\//;
var sheetsBusy = false;
var sheetsTimer = null;

function postJSON(url, body, cb) {
  var done = false;
  function finish(err, data) { if (!done) { done = true; cb(err, data); } }
  var x = new XMLHttpRequest();
  x.timeout = 25000;
  x.onload = function () {
    if (x.status < 200 || x.status >= 300) { finish(new Error('HTTP ' + x.status)); return; }
    var d = null;
    try { d = JSON.parse(x.responseText); } catch (e) {}
    // Apps Script answers with a sign-in page when "Who has access" is not Anyone.
    if (!d || d.ok !== true) { finish(new Error('Script not set up right')); return; }
    finish(null, d);
  };
  x.onerror = function () { finish(new Error('No internet')); };
  x.ontimeout = function () { finish(new Error('Timed out')); };
  x.open('POST', url);
  // text/plain keeps this a "simple" request, so no CORS preflight is needed
  x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
  x.send(JSON.stringify(body));
}

function sheetsRow(rec) {
  // the sheet's category column shows the tag you gave an Anything item, if any
  return { ref: rec.ref, title: rec.title, cat: rec.tag || rec.cat, stars: rec.stars, ts: rec.ts };
}

function sheetsEnqueue(rec) {
  var row = sheetsRow(rec);
  state.syncQueue = state.syncQueue.filter(function (q) { return q.ref !== row.ref; });
  state.syncQueue.push(row);
  if (state.syncQueue.length > SYNC_MAX) state.syncQueue = state.syncQueue.slice(-SYNC_MAX);
  save('syncQueue', state.syncQueue);
}

// Events are the second-brain log: every rating and every note is its own row and nothing
// is overwritten. The id is fixed by what happened, so sending twice never duplicates.
var EV_MAX = 6000;
var EV_BATCH = 60;

function localDay(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}

function ratingEvent(rec) {
  return { id: 'r-' + rec.ref + '-' + rec.ts, ts: rec.ts, kind: 'rated', ref: rec.ref,
           title: rec.title, cat: rec.tag || rec.cat, stars: rec.stars };
}

function markEvent(mk) {
  var tag = '';
  for (var i = 0; i < state.log.length; i++) if (state.log[i].ref === mk.ref) { tag = state.log[i].tag || ''; break; }
  return { id: 'n-' + mk.ts, ts: mk.ts, kind: mk.note ? 'note' : 'bookmark', ref: mk.ref === 'k:thought' ? '' : mk.ref,
           title: mk.title, cat: tag || mk.cat, pos: mk.pos || '', note: mk.note || '', track: mk.track || '' };
}

function evEnqueue(ev) {
  for (var i = 0; i < state.evQueue.length; i++) if (state.evQueue[i].id === ev.id) return;
  ev.day = localDay(ev.ts);
  ev.src = ev.src || 'watch';
  state.evQueue.push(ev);
  if (state.evQueue.length > EV_MAX) state.evQueue = state.evQueue.slice(-EV_MAX);
  save('evQueue', state.evQueue);
}

function sheetsFlush() {
  if (!state.sheetsUrl || sheetsBusy || !(state.syncQueue.length || state.evQueue.length)) return;
  sheetsBusy = true;
  var batch = state.syncQueue.slice(0, SYNC_BATCH);
  var evs = state.evQueue.slice(0, EV_BATCH);
  postJSON(state.sheetsUrl, { rows: batch, events: evs }, function (err, d) {
    sheetsBusy = false;
    if (err) {
      console.log('Logbook: Sheets sync failed: ' + err.message);
      if (!sheetsTimer) {
        sheetsTimer = setTimeout(function () { sheetsTimer = null; sheetsFlush(); }, SYNC_RETRY_MS);
      }
      return;
    }
    // drop what was sent; a row re-rated while in flight is a newer object and stays
    state.syncQueue = state.syncQueue.filter(function (q) { return batch.indexOf(q) < 0; });
    save('syncQueue', state.syncQueue);
    // An old (v1) script ignores events and still says ok, so events are kept until the
    // script reports version 2.
    var v2 = !!d && d.v === 2;
    if (v2) {
      state.evQueue = state.evQueue.filter(function (q) { return evs.indexOf(q) < 0; });
      save('evQueue', state.evQueue);
    } else if (evs.length) {
      toast('Update the Sheets script to sync notes');
      return;
    }
    sheetsFlush();
  });
}

function sheetsBackfill() {
  state.syncQueue = state.log.slice().sort(function (a, b) { return a.ts - b.ts; }).map(sheetsRow);
  save('syncQueue', state.syncQueue);
  state.log.forEach(function (r) { evEnqueue(ratingEvent(r)); });
  state.marks.forEach(function (mk) { evEnqueue(markEvent(mk)); });
  state.meets.forEach(function (ev) { evEnqueue(ev); });
  toast('Sending ' + state.syncQueue.length + ' ratings and ' + state.marks.length + ' notes to Sheets');
  sheetsFlush();
}

function sheetsTest() {
  postJSON(state.sheetsUrl, { test: true }, function (err, d) {
    toast(err ? 'Sheets: ' + err.message : (d && d.v === 2 ? 'Sheets is connected' : 'Connected, but update the script (v2)'));
  });
}

// Applies the Sheets part of the settings page. Returns true when sync is on.
function applySheetsSettings(s) {
  var url = String(s.url || '').trim();
  if (url && !SHEETS_URL_RE.test(url)) {
    toast('That is not a Google Apps Script URL');
    return !!state.sheetsUrl;
  }
  if (url !== state.sheetsUrl) {
    state.sheetsUrl = url;
    save('sheetsUrl', url);
    if (!url) {                       // switched off: nothing should pile up
      state.syncQueue = [];
      save('syncQueue', state.syncQueue);
      state.evQueue = [];
      save('evQueue', state.evQueue);
    }
  }
  return !!url;
}

registerIntegration({
  name: 'sheets',
  enabled: function () { return !!state.sheetsUrl; },
  onRated: function (rec) { sheetsEnqueue(rec); evEnqueue(ratingEvent(rec)); sheetsFlush(); },
  onMark: function (mk) { evEnqueue(markEvent(mk)); sheetsFlush(); },
  onMeet: function (ev) { evEnqueue(ev); sheetsFlush(); },
  flush: sheetsFlush
});

// ---------------------------------------------------------------- history

function categoryOf(ref) {
  var c = String(ref).split(':')[0];
  if (c === 'm') return 'movie';
  if (c === 't' || c === 'ts' || c === 'te') return 'tv';
  if (c === 'p' || c === 'pe') return 'podcast';
  if (c === 'a' || c === 'at') return 'music';
  if (c === 'b' || c === 'bg') return 'book';
  if (c === 's') return 'song';
  if (c === 'g') return 'game';
  if (c === 'r') return 'recipe';
  if (c === 'n') return 'person';
  if (c === 'k') return 'thought';
  return 'other';
}

function parentRef(ref) {
  var p = String(ref).split(':');
  if (p[0] === 'te' || p[0] === 'ts') return 't:' + p[1];
  if (p[0] === 'pe') return 'p:' + p[1];
  if (p[0] === 'at') return 'a:' + p[1];
  return '';
}

function trimLog() {
  if (state.log.length > MAX_LOG) {
    state.log.sort(function (a, b) { return b.ts - a.ts; });
    state.log = state.log.slice(0, MAX_LOG);
  }
}

// A tag is the short category you say for an "Anything" item (restaurant, coffee, ...).
var TAG_MAX = 20;
function cleanTag(t) {
  return clean(t, TAG_MAX + 1).toLowerCase().replace(/[^a-z0-9 '&-]/g, '').replace(/^ +| +$/g, '').slice(0, TAG_MAX).replace(/ +$/, '');
}

// Your most used tags, newest first among ties, for the watch's quick-pick list.
function tagEntries() {
  var seen = {}, order = [];
  state.log.slice().sort(function (a, b) { return b.ts - a.ts; }).forEach(function (r) {
    if (!r.tag) return;
    if (!seen[r.tag]) { seen[r.tag] = 0; order.push(r.tag); }
    seen[r.tag]++;
  });
  order.sort(function (a, b) { return seen[b] - seen[a]; });
  return order.slice(0, 6).map(function (t) { return entry(t, '', 0); });
}

function logRating(ref, watchTitle, stars, tag) {
  // The watch sends half-star steps (1 to 10); the log keeps stars (0.5 to 5).
  var halves = Math.max(1, Math.min(10, parseInt(stars, 10) || 0));
  if (!ref || !stars) return;
  stars = halves / 2;
  var m = meta[ref] || {};
  var par = meta[parentRef(ref)] || {};
  var rec = null;
  for (var i = 0; i < state.log.length; i++) if (state.log[i].ref === ref) { rec = state.log[i]; break; }
  if (!rec) { rec = { ref: ref }; state.log.push(rec); }
  rec.cat = categoryOf(ref);
  var tg = rec.cat === 'other' ? cleanTag(tag) : '';
  if (tg) rec.tag = tg;        // re-rating without a tag keeps the one it had
  rec.title = m.title || watchTitle || ref;
  rec.art = m.art || par.art || rec.art || '';
  rec.stars = stars;
  rec.ts = Date.now();
  trimLog();
  save('log', state.log);
  fireRated(rec);
}

function recentEntries() {
  var rows = state.log.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 12);
  // The watch draws the stars itself: the rating (in half stars) rides in the top
  // four bits of the flags, and the ref gives each row its kind's color.
  return rows.map(function (r) {
    return entry(r.title, r.ref, Math.round(r.stars * 2) << 4);
  });
}

// The Home screen: how today is going. The first entry is the summary line, the rest are
// today's ratings, newest first. (Entry types are the low four bits of the flags; the
// rating in half stars rides in the upper four, same as the Recent list.)
var H_SUMMARY = 1;
var H_DONE = 2;
var H_STREAK = 4;           // label is your current streak in days (the watch nudges in the evening)
var HOME_ROWS = 3;

function homeEntries() {
  var today = stats.dayNum(Date.now());
  var recs = state.log.filter(function (r) { return stats.dayNum(r.ts) === today; })
    .sort(function (a, b) { return b.ts - a.ts; });
  var sum = 0;
  recs.forEach(function (r) { sum += r.stars; });
  var line = recs.length
    ? recs.length + ' rated, average ' + (Math.round(sum / recs.length * 10) / 10).toFixed(1)
    : 'Nothing rated yet';
  var out = [entry(line, '', H_SUMMARY)];
  recs.slice(0, HOME_ROWS).forEach(function (r) {
    out.push(entry(r.title, r.ref, H_DONE | (Math.round(r.stars * 2) << 4)));
  });
  out.push(entry(String(stats.compute(state.log).activity.streak), '', H_STREAK));
  out.push(entry(String(metToday()), '', H_MET));
  return out;
}

// Next unrated episode for the shows you rated most recently.
function continueEntries(cb) {
  var latest = {};
  state.log.forEach(function (r) {
    var p = String(r.ref).split(':');
    if (p[0] !== 'te') return;
    var id = p[1];
    if (!latest[id] || r.ts > latest[id].ts) latest[id] = { ts: r.ts, s: +p[2], e: +p[3], art: r.art, id: id };
  });
  var shows = Object.keys(latest).map(function (k) { return latest[k]; })
    .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 3);
  var out = [];
  var i = 0;
  function next() {
    if (i >= shows.length) { cb(out); return; }
    var sh = shows[i++];
    tvInfo(sh.id, function (err, info) {
      if (!err && info) {
        var s = sh.s, e = sh.e + 1;
        if (!(info.seasons[s] && e <= info.seasons[s])) { s = s + 1; e = 1; }
        if (info.seasons[s]) {
          var en = entry(info.name + ' S' + s + 'E' + e, 'te:' + sh.id + ':' + s + ':' + e, F_RATE);
          remember(en.ref, info.name + ' S' + s + 'E' + e, sh.art || art(info.poster));
          out.push(en);
        }
      }
      next();
    });
  }
  next();
}

// ---------------------------------------------------------------- people
// The People tile: pick someone you have logged (or say a new name) and it records that you
// met them, with no star rating. A person is {ref: 'n:slug', name, count, last}. Every
// meeting is also an event (kind 'met', category 'person') that goes to the Sheet.
// What you say for a new person can carry the occasion: "coffee with Maria", "Maria, we
// talked about the field trip". The name is pulled out and the rest becomes the note.

var PEOPLE_MAX = 200;
var PEOPLE_SHOW = 20;
var MEETS_MAX = 1000;
var NAME_MAX = 30;
var H_MET = 8;               // Home entry: how many people you met today

function titleCase(t) {
  if (t !== t.toLowerCase()) return t;        // already capitalized by dictation: leave it
  return t.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
}

function parseWho(text) {
  var t = clean(text, NOTE_MAX).replace(/[.!?]+$/, '');
  var act = '', about = '', rest = '', m;
  var head = t;
  if ((m = /^(.*?)\s*(?:[,;:]| - )\s*(.+)$/.exec(t))) { head = m[1]; rest = m[2]; }
  if ((m = /^(.*?)\s+(?:about|regarding)\s+(.+)$/i.exec(head))) { head = m[1]; about = m[2]; }
  if ((m = /^((?:\S+\s+){0,3}?\S+)\s+(?:with|to)\s+(.+)$/i.exec(head))) { act = m[1]; head = m[2]; }
  var name = clean(titleCase(head), NAME_MAX).replace(/[.,]+$/, '');
  var note = [act, about, rest].filter(function (x) { return x; }).join(', ');
  return { name: name, note: clean(note, NOTE_MAX) };
}

function personRef(name) {
  return 'n:' + norm(name).replace(/ /g, '-').slice(0, 30);
}

// "maria" finds "Maria Lopez" when she is the only match; two Marias count as someone new.
function findPerson(name) {
  var n = norm(name);
  if (!n) return null;
  var i;
  for (i = 0; i < state.people.length; i++) if (norm(state.people[i].name) === n) return state.people[i];
  var toks = n.split(' '), hits = [];
  state.people.forEach(function (p) {
    var pt = norm(p.name).split(' ');
    if (toks.every(function (t) { return pt.indexOf(t) >= 0; })) hits.push(p);
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return null;
  // hard names: "miss camilah" and "jamila" both find "Ms. Gamilah" by how they sound
  var f = names.fuzzyFind(name, state.people, state.aliases);
  if (f && norm(name) !== norm(f.name)) {
    if (!state.aliases[n]) { state.aliases[n] = f.ref; save('aliases', state.aliases); }
  }
  return f;
}

function dayWord(ts) {
  var diff = stats.dayNum(Date.now()) - stats.dayNum(ts);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  var d = new Date(ts);
  return MONTH3[d.getMonth()] + ' ' + d.getDate();
}

function logPerson(ref, title, text) {
  var p = null, note = '', i;
  if (ref === 'n:?') {                       // a name you just said
    var w = parseWho(text);
    if (!w.name || !norm(w.name)) return;
    note = w.note;
    p = findPerson(w.name);
    if (!p) p = { ref: personRef(w.name), name: w.name, count: 0, last: 0 };
  } else {                                   // someone from the list
    for (i = 0; i < state.people.length; i++) if (state.people[i].ref === ref) { p = state.people[i]; break; }
    note = clean(text, NOTE_MAX);
    if (!p) p = { ref: ref, name: clean(title, NAME_MAX) || ref.slice(2), count: 0, last: 0 };
  }
  if (state.people.indexOf(p) < 0) {
    state.people.push(p);
    if (state.people.length > PEOPLE_MAX) {
      state.people.sort(function (a, b) { return b.last - a.last; });
      state.people.length = PEOPLE_MAX;
    }
  }
  var ts = Date.now();
  p.count++;
  p.last = ts;
  save('people', state.people);
  var ev = { id: 'm-' + p.ref + '-' + ts, ts: ts, kind: 'met', ref: p.ref, title: p.name, cat: 'person', note: note };
  state.meets.push(ev);
  if (state.meets.length > MEETS_MAX) state.meets = state.meets.slice(-MEETS_MAX);
  save('meets', state.meets);
  fireMeet(ev);
  if (ref === 'n:?') sendFlash('Logged ' + p.name);     // the watch could not know which name it matched
}

// "Name - 5x, Oct 27" (the watch splits this into a name and a smaller line)
function peopleEntries() {
  return state.people.slice().sort(function (a, b) { return b.last - a.last; })
    .slice(0, PEOPLE_SHOW).map(function (p) {
      var tail = ' - ' + p.count + 'x, ' + dayWord(p.last);
      return entry(clean(p.name, LABEL_MAX - tail.length) + tail, p.ref, 0);
    });
}

function metToday() {
  var today = stats.dayNum(Date.now());
  return state.meets.filter(function (e) { return stats.dayNum(e.ts) === today; }).length;
}

// ---------------------------------------------------------------- bookmarks and notes
// Hold Select on a result or on the rating screen, then say where you are and what
// you want to remember: "26 minutes in, the guest starts on glaciers".

var MARK_MAX = 300;
var NOTE_MAX = 250;
var ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// "twenty six minutes" -> "26 minutes"
function numberWords(text) {
  var toks = String(text).replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2').split(/\s+/);
  var out = [];
  for (var i = 0; i < toks.length; i++) {
    var w = toks[i].toLowerCase().replace(/[^a-z]/g, '');
    if (TENS.hasOwnProperty(w)) {
      var v = TENS[w];
      var nx = (toks[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
      if (ONES.hasOwnProperty(nx) && ONES[nx] >= 1 && ONES[nx] <= 9) { v += ONES[nx]; i++; }
      out.push(String(v));
    } else if (ONES.hasOwnProperty(w)) {
      out.push(String(ONES[w]));
    } else {
      out.push(toks[i]);
    }
  }
  return out.join(' ');
}

function two(n) { return n < 10 ? '0' + n : String(n); }

function fmtPos(h, m, s) {
  if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  return h > 0 ? h + ':' + two(m) + ':' + two(s || 0) : m + ':' + two(s || 0);
}

// Pulls a position (time, page or chapter) out of what you said; the rest is the note.
function parseSpoken(text) {
  var t = numberWords(String(text || '')).replace(/\s+/g, ' ');
  var pos = '';
  var m;
  if ((m = /(\d{1,3}):(\d{2})(?::(\d{2}))?/.exec(t))) {
    pos = m[3] ? fmtPos(+m[1], +m[2], +m[3]) : fmtPos(0, +m[1], +m[2]);
  } else if ((m = /(\d+)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(?:a half|(\d+)\s*(?:minutes?|mins?|m)?))?/i.exec(t))) {
    var mins = /a half/i.test(m[0]) ? 30 : (m[2] ? +m[2] : 0);
    pos = fmtPos(+m[1], mins, 0);
  } else if ((m = /(\d+)\s*(?:minutes?|mins?)\b/i.exec(t))) {
    pos = fmtPos(0, +m[1], 0);
  } else if ((m = /\bhalf an hour\b/i.exec(t))) {
    pos = '30:00';
  } else if ((m = /\b(?:an|one) hour\b/i.exec(t))) {
    pos = '1:00:00';
  } else if ((m = /\bpage\s+(\d+)/i.exec(t))) {
    pos = 'p. ' + m[1];
  } else if ((m = /\bchapter\s+(\d+)/i.exec(t))) {
    pos = 'ch. ' + m[1];
  }
  var note = t;
  if (pos && m) note = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length));
  var FILL = "(?:i'?m|i am|we'?re|now|about|around|roughly|approximately|in|into|at)";
  note = note.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  if (pos) {          // the words that led into or out of the position ("I'm about ... in,")
    var lead = new RegExp('^' + FILL + '\\b[\\s,.:;-]*', 'i'), tail = new RegExp('[\\s,.:;-]*\\b' + FILL + '$', 'i'), prev;
    do { prev = note; note = note.replace(lead, '').replace(tail, ''); } while (note !== prev);
  }
  note = note.replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  return { pos: pos, note: clean(note, NOTE_MAX) };
}

function sendFlash(text) {      // the watch shows this briefly (list token 0)
  outq.push({ token: 0, tries: 0, p: { LIST_TOKEN: 0, LIST_TOTAL: 1, LIST_INDEX: 0, LIST_LABEL: clean(text, LABEL_MAX), LIST_FLAGS: 8 } });
  pump();
}

// raw: a note about a person or a loose thought. The words are kept as spoken (no "26 minutes in"
// parsing) and nothing is counted: a person is not "met" again, a thought is not a rating.
function addMark(ref, watchTitle, text, raw) {
  var p = raw ? { pos: '', note: clean(text, NOTE_MAX) } : parseSpoken(text);
  if (raw && ref.indexOf('k:') === 0) { ref = 'k:thought'; watchTitle = 'Thought'; }
  if (raw && ref.indexOf('n:') === 0) {
    for (var pi = 0; pi < state.people.length; pi++) if (state.people[pi].ref === ref) { watchTitle = state.people[pi].name; break; }
  }
  var m = meta[ref] || {};
  var par = meta[parentRef(ref)] || {};
  var rec = null;
  for (var i = 0; i < state.log.length; i++) if (state.log[i].ref === ref) { rec = state.log[i]; break; }
  var mark = {
    ref: ref,
    cat: categoryOf(ref),
    title: m.title || (rec && rec.title) || splitLabel(String(watchTitle || '')).base || ref,
    art: m.art || par.art || (rec && rec.art) || '',
    pos: p.pos,
    note: p.note,
    ts: Date.now()
  };
  // Nothing said about where you are: ask the music plugin what is playing. A position from the
  // plugin fills "pos"; with no position the track is kept on its own. The mark is saved either way.
  if (!raw && !p.pos && mark.cat !== 'person' && mark.cat !== 'thought' && nowplaying.enabled()) {
    nowplaying.read(function (np) {
      if (np) {
        mark.track = nowplaying.label(np);
        if (np.position !== null) mark.pos = nowplaying.fmtSeconds(np.position);
      }
      commitMark(mark, raw);
    });
    return;
  }
  commitMark(mark, raw);
}

function commitMark(mark, raw) {
  state.marks.unshift(mark);
  if (state.marks.length > MARK_MAX) state.marks.length = MARK_MAX;
  save('marks', state.marks);
  fireMark(mark);
  if (raw) { sendFlash('Note saved'); return; }
  if (mark.pos) sendFlash('Saved @' + mark.pos);
  else if (mark.track) sendFlash(mark.note ? 'Note saved' : 'Bookmarked: ' + mark.track);
  else sendFlash(mark.note ? 'Note saved' : 'Bookmarked');
}

function markEntries() {          // Shelf > Bookmarks: places in things, not notes about people
  return state.marks.filter(function (mk) { return mk.cat !== 'person' && mk.cat !== 'thought'; }).slice(0, 12).map(function (mk) {
    var tail = ' - ' + (mk.pos ? '@' + mk.pos : (mk.track || 'note')) + (mk.note ? ' ' + mk.note : '');
    if (tail.length > 20) tail = tail.slice(0, 20);
    return entry(clean(mk.title, LABEL_MAX - tail.length) + tail, mk.ref, 0);
  });
}

// ---------------------------------------------------------------- reflect
// The Reflect page on the watch: your latest ratings, each showing whether it already has a
// note or a bookmark. Pick one to see what you wrote about it and to add more.
//   A "bookmark" is a mark with a position or with no words at all; a "note" is a mark with
//   words. (A spoken "26 minutes in, great interview" is both.)

var REFLECT_ROWS = 12;
var NOTE_ROWS = 8;
var NOTE_TEXT_MAX = 70;     // a note row travels as label (31) + space + ref (38)
var R_BOOKMARK = 4;         // flag on a Reflect row (has a bookmark) and on a note row (bare bookmark)
var R_NOTE = 8;             // flag on a Reflect row: has a note
var MONTH3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isBareBookmark(mk) { return !mk.pos && !mk.note; }

function reflectEntries() {
  var seen = {};                         // ref -> {note, bm}
  state.marks.forEach(function (mk) {
    var o = seen[mk.ref] || (seen[mk.ref] = { note: false, bm: false });
    if (mk.note) o.note = true;
    if (mk.pos || !mk.note) o.bm = true;
  });
  var rows = state.log.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, REFLECT_ROWS);
  return rows.map(function (r) {
    var o = seen[r.ref] || {};
    var flags = (Math.round(r.stars * 2) << 4) | (o.bm ? R_BOOKMARK : 0) | (o.note ? R_NOTE : 0);
    return entry(r.title, r.ref, flags);
  });
}

// One mark as a line of text: "Oct 27 @26:00 the guest starts on glaciers".
function markLine(mk) {
  var d = new Date(mk.ts);
  var t = MONTH3[d.getMonth()] + ' ' + d.getDate();
  if (mk.pos) t += ' @' + mk.pos;
  else if (mk.track) t += ' ' + mk.track;
  t += mk.note ? ' ' + mk.note : (mk.pos ? '' : ' Bookmarked');
  t = clean(t, 200);
  if (t.length > NOTE_TEXT_MAX) {             // too long for the watch: stop at a word, say so
    var stop = t.lastIndexOf(' ', NOTE_TEXT_MAX - 3);
    if (stop < 20) stop = NOTE_TEXT_MAX - 3;
    t = t.slice(0, stop) + '...';
  }
  return t;
}

// The watch has two fields to spare per row, so a long line is cut at a word and carried in
// the label and the ref; the watch glues them back together with a space.
function noteEntries(ref) {
  return state.marks.filter(function (mk) { return mk.ref === ref; })
    .slice(0, NOTE_ROWS).map(function (mk) {
      var text = markLine(mk), head = text, tail = '';
      if (text.length > LABEL_MAX) {
        var cut = text.lastIndexOf(' ', LABEL_MAX);
        if (cut < 8) cut = LABEL_MAX;                 // one very long word: cut it where it falls
        head = text.slice(0, cut);
        tail = text.slice(cut).replace(/^ /, '');
      }
      return entry(head, tail, isBareBookmark(mk) ? R_BOOKMARK : 0);
    });
}

// The Note tile: what you can add a note to. "A thought" first, then the people you saw most
// recently, then your latest ratings.
function noteTargets() {
  var rows = [entry('A thought', 'k:?', 0)];
  state.people.slice().sort(function (a, b) { return b.last - a.last; }).slice(0, 6).forEach(function (pp) {
    rows.push(entry(clean(pp.name, LABEL_MAX), pp.ref, 0));
  });
  state.log.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 6).forEach(function (r) {
    rows.push(entry(r.title, r.ref, 0));
  });
  return rows;
}

// One press on "Bookmark this": adds a bookmark with no words, or takes it off again.
function toggleBookmark(ref, watchTitle) {
  var had = state.marks.length;
  state.marks = state.marks.filter(function (mk) { return !(mk.ref === ref && isBareBookmark(mk)); });
  if (state.marks.length < had) {
    save('marks', state.marks);
    sendFlash('Bookmark removed');
  } else {
    addMark(ref, watchTitle, '');            // flashes "Bookmarked"
  }
}

// ---------------------------------------------------------------- favorites
// Pin a show, podcast or album (hold Select on it in a list) and it sits at the top of the
// watch's menu, one press from its episodes.

var FAV_MAX = 20;
var FAV_SHOW = 8;

function toggleFav(ref, label) {
  var i;
  for (i = 0; i < state.favs.length; i++) {
    if (state.favs[i].ref === ref) {
      state.favs.splice(i, 1);
      save('favs', state.favs);
      return false;
    }
  }
  var title = (meta[ref] && meta[ref].title) ? meta[ref].title : splitLabel(String(label || '')).base;
  state.favs.unshift({ ref: ref, cat: categoryOf(ref), title: clean(title || ref, 60) });
  if (state.favs.length > FAV_MAX) state.favs.length = FAV_MAX;
  save('favs', state.favs);
  return true;
}

function favEntries() {
  return state.favs.slice(0, FAV_SHOW).map(function (f) { return entry(f.title, f.ref, F_OPEN); });
}

// ---------------------------------------------------------------- seen (Letterboxd and your log)
// Search results get "seen 4.5" when you already rated something, and "logged" for a show
// or album you have rated part of.

var SEEN_MAX = 6000;

function movieKey(title, yr) {
  return 'k:' + norm(title) + '|' + String(yr || '').slice(0, 4);
}

function seenInfo(ref, label) {
  var i, r;
  for (i = 0; i < state.log.length; i++) {
    r = state.log[i];
    if (r.ref === ref) return { stars: r.stars };
  }
  if (state.seen[ref] !== undefined) return { stars: state.seen[ref] };
  if (ref.charAt(0) === 'm') {
    var p = splitLabel(label);
    var k = movieKey(p.base, p.detail);
    if (state.seen[k] !== undefined) return { stars: state.seen[k] };
  }
  for (i = 0; i < state.log.length; i++) {
    if (parentRef(state.log[i].ref) === ref) return { logged: true };
  }
  return null;
}

function decorate(e) {
  if (!e || !e.ref) return e;
  var info = seenInfo(e.ref, e.label);
  if (!info) return e;
  var parts = splitLabel(e.label);
  var tag = info.logged ? 'logged' : (info.stars ? 'seen ' + info.stars : 'seen');
  var tail = ' - ' + (parts.detail ? parts.detail + ', ' : '') + tag;
  if (tail.length > 24) tail = ' - ' + tag;
  return { label: clean(parts.base, LABEL_MAX - tail.length) + tail, ref: e.ref, flags: e.flags };
}

// ---------------------------------------------------------------- Letterboxd
// Reads your public diary feed (letterboxd.com/NAME/rss, the latest entries) and an
// optional pasted export, so search knows what you have already watched.

var LB_USER_RE = /^[A-Za-z0-9_]{2,40}$/;
var LB_EVERY_MS = 6 * 3600 * 1000;

function xmlText(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function lbParse(xml) {
  var out = [];
  String(xml).split('<item>').slice(1).forEach(function (it) {
    function tag(n) {
      var m = new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>').exec(it);
      return m ? xmlText(m[1]).replace(/^\s+|\s+$/g, '') : '';
    }
    var title = tag('letterboxd:filmTitle');
    if (!title) return;                      // lists and other items
    out.push({
      title: title,
      year: tag('letterboxd:filmYear'),
      rating: parseFloat(tag('letterboxd:memberRating')) || 0,
      tmdb: tag('tmdb:movieId'),
      watched: tag('letterboxd:watchedDate'),
      pub: tag('pubDate')
    });
  });
  return out;
}

function lbMerge(items) {
  var added = 0, updated = 0;
  items.forEach(function (it) {
    var ref = /^\d+$/.test(it.tmdb) ? 'm:' + it.tmdb : '';
    var ts = it.watched ? Date.parse(it.watched + 'T12:00:00') : Date.parse(it.pub);
    if (!ts || isNaN(ts)) ts = Date.now();
    var key = ref || movieKey(it.title, it.year);
    if (Object.keys(state.seen).length < SEEN_MAX) {
      if (it.rating) state.seen[key] = it.rating;
      else if (state.seen[key] === undefined) state.seen[key] = 0;
    }
    if (!ref || !it.rating) return;
    var rec = null;
    for (var i = 0; i < state.log.length; i++) if (state.log[i].ref === ref) { rec = state.log[i]; break; }
    if (!rec) {
      for (i = 0; i < state.log.length; i++) {
        if (/^m:lb-/.test(state.log[i].ref) && norm(state.log[i].title) === norm(withYear(it.title, it.year))) { rec = state.log[i]; rec.ref = ref; break; }
      }
    }
    if (rec) {
      if (ts > rec.ts && rec.stars !== it.rating) { rec.stars = it.rating; rec.ts = ts; updated++; fireRated(rec); }
    } else {
      rec = { ref: ref, cat: 'movie', title: withYear(it.title, it.year), art: '', stars: it.rating, ts: ts };
      state.log.push(rec);
      added++;
      fireRated(rec);
    }
  });
  trimLog();
  save('log', state.log);
  save('seen', state.seen);
  return { added: added, updated: updated };
}

function lbSync(force) {
  if (!state.lbUser) return;
  if (!force && Date.now() - state.lbAt < LB_EVERY_MS) return;
  var x = new XMLHttpRequest();
  x.timeout = 15000;
  x.onload = function () {
    if (x.status < 200 || x.status >= 300) { console.log('Logbook: Letterboxd HTTP ' + x.status); if (force) toast('Letterboxd: could not read that profile'); return; }
    var r = lbMerge(lbParse(x.responseText));
    state.lbAt = Date.now();
    save('lbAt', state.lbAt);
    if (force) toast('Letterboxd: ' + r.added + ' new, ' + r.updated + ' updated');
  };
  x.onerror = function () { console.log('Logbook: Letterboxd unreachable'); };
  x.ontimeout = x.onerror;
  x.open('GET', 'https://letterboxd.com/' + state.lbUser + '/rss/');
  x.send();
}

// Rows from the settings page: "Name|Year|Rating|Date" lines out of your Letterboxd export.
// Every row marks the film as seen; with hist on, rated rows also join the history and stats
// (without pinging Sheets, since an import should not flood it).
function lbImportRows(rows, hist) {
  var n = 0, added = 0;
  (rows || []).forEach(function (line) {
    var p = String(line).split('|');
    if (p.length < 2 || !p[0]) return;
    var key = movieKey(p[0], p[1]);
    var r = parseFloat(p[2]) || 0;
    if (Object.keys(state.seen).length < SEEN_MAX && (r || state.seen[key] === undefined)) { state.seen[key] = r; n++; }
    if (!hist || !(r >= 0.5 && r <= 5)) return;
    var title = withYear(p[0], p[1]);
    var ts = p[3] ? Date.parse(p[3] + 'T12:00:00') : 0;
    if (!ts || isNaN(ts)) ts = Date.now();
    var ref = 'm:lb-' + norm(p[0]).replace(/ /g, '-') + '-' + String(p[1] || '').slice(0, 4);
    for (var i = 0; i < state.log.length; i++) {
      if (state.log[i].ref === ref) return;
      if (state.log[i].cat === 'movie' && norm(state.log[i].title) === norm(title)) return;   // already logged
    }
    state.log.push({ ref: ref, cat: 'movie', title: title, art: '', stars: r, ts: ts });
    added++;
  });
  trimLog();
  save('log', state.log);
  save('seen', state.seen);
  return { seen: n, added: added };
}

function applyLetterboxdSettings(lb) {
  var u = String(lb.user || '').replace(/^\s+|\s+$/g, '').replace(/^@/, '');
  if (u && !LB_USER_RE.test(u)) { toast('That is not a Letterboxd username'); u = state.lbUser; }
  var changed = u !== state.lbUser;
  state.lbUser = u;
  save('lbUser', u);
  var imp = lbImportRows(lb.rows, lb.hist);
  if (lb.hist && lb.sheets && state.sheetsUrl) {      // upserts by ref, so re-sending is safe
    var sent = 0;
    state.log.forEach(function (x) { if (/^m:lb-/.test(x.ref)) { sheetsEnqueue(x); sent++; } });
    if (sent) toast('Sending ' + sent + ' Letterboxd films to your Sheet');
  }
  if (imp.seen || imp.added) toast('Letterboxd: ' + imp.seen + ' films marked seen' + (imp.added ? ', ' + imp.added + ' added to history' : ''));
  if (u && (changed || lb.sync)) { state.lbAt = 0; lbSync(true); }
}

// ---------------------------------------------------------------- sending

var outq = [];
var pumping = false;

function removeItem(item) {
  var i = outq.indexOf(item);
  if (i >= 0) outq.splice(i, 1);
}

function pump() {
  if (pumping || !outq.length) return;
  pumping = true;
  var item = outq[0];
  Pebble.sendAppMessage(item.p, function () {
    removeItem(item);
    pumping = false;
    pump();
  }, function () {
    item.tries++;
    if (item.tries >= 3) {
      // drop the rest of this list, a half-sent list is useless
      outq = outq.filter(function (x) { return x.token !== item.token; });
    }
    pumping = false;
    setTimeout(pump, 800);
  });
}

function sendList(token, entries) {
  // (The watch ignores lists it no longer waits for, so stale ones are harmless.)
  var list = entries.slice(0, MAX_ENTRIES);
  if (!list.length) {
    outq.push({ token: token, tries: 0, p: { LIST_TOKEN: token, LIST_TOTAL: 0 } });
  } else {
    list.forEach(function (e, i) {
      var p = { LIST_TOKEN: token, LIST_TOTAL: list.length, LIST_INDEX: i, LIST_LABEL: e.label, LIST_FLAGS: e.flags };
      if (e.ref) p.LIST_REF = e.ref;
      outq.push({ token: token, tries: 0, p: p });
    });
  }
  pump();
}

function sendError(token, msg) {
  outq.push({ token: token, tries: 0, p: { LIST_TOKEN: token, LIST_ERROR: clean(msg, 35) } });
  pump();
}

// ---------------------------------------------------------------- events

function handleRequest(p) {
  var token = p.REQ_TOKEN;
  var arg = p.REQ_ARG || '';
  function reply(err, entries) {
    if (err) sendError(token, err.message || 'Something went wrong');
    else sendList(token, entries);
  }
  switch (p.REQ_TYPE) {
    case 1: {
      if (p.REQ_KIND === KIND_ALL) { searchAll(arg, reply); break; }
      var f = SEARCHERS[p.REQ_KIND];
      if (!f) return sendError(token, 'Unknown kind');
      f(arg, function (err, list) { reply(err, err ? null : (list || []).map(decorate)); });
      break;
    }
    case 2: browse(arg, reply); break;
    case 3: continueEntries(function (list) { sendList(token, list); }); break;
    case 4: sendList(token, recentEntries()); break;
    case 5: sendList(token, homeEntries()); break;
    case 7: sendList(token, tagEntries()); break;
    case 8: sendList(token, markEntries()); break;
    case 9: {                                  // pin / unpin: REQ_ARG is "ref|title"
      var cut = arg.indexOf('|');
      var pinned = toggleFav(cut > 0 ? arg.slice(0, cut) : arg, cut > 0 ? arg.slice(cut + 1) : '');
      sendFlash(pinned ? 'Pinned to favorites' : 'Removed from favorites');
      break;
    }
    case 10: sendList(token, favEntries()); break;
    case 11: sendList(token, reflectEntries()); break;       // Reflect: latest ratings
    case 12: sendList(token, noteEntries(arg)); break;       // Reflect: what you wrote about one
    case 14: sendList(token, peopleEntries()); break;        // People tile
    case 15: sendList(token, noteTargets()); break;          // Note tile
    case 13: {                                               // Reflect: bookmark / unbookmark, "ref|title"
      var mcut = arg.indexOf('|');
      toggleBookmark(mcut > 0 ? arg.slice(0, mcut) : arg, mcut > 0 ? arg.slice(mcut + 1) : '');
      break;
    }
    case 6: {
      // REQ_KIND picks the range: 0 week, 1 month, 2 year, 3 all time
      var range = stats.RANGES[p.REQ_KIND] || 'w';
      sendList(token, stats.watchEntries(stats.compute(state.log), range, function (t, n) { return clean(t, n); }));
      break;
    }
  }
}

Pebble.addEventListener('ready', function () {
  flushIntegrations();          // send anything that was waiting for a connection
  lbSync(false);                // pick up new Letterboxd diary entries (at most every few hours)
});

Pebble.addEventListener('appmessage', function (e) {
  var p = e.payload || {};
  if (p.REQ_TYPE !== undefined) { handleRequest(p); return; }
  if (p.LOG_REF !== undefined) {
    var lref = String(p.LOG_REF), ltitle = String(p.LOG_TITLE || '');
    if (!p.LOG_STARS && p.LOG_NOTE && (lref.indexOf('k:') === 0 || (lref.indexOf('n:') === 0 && String(p.LOG_TAG || '') === 'note'))) {
      addMark(lref, ltitle, String(p.LOG_NOTE), true);     // a note only: no meeting counted
      return;
    }
    if (lref.indexOf('n:') === 0 && !p.LOG_STARS) {        // a person: met them (no stars), maybe with a note
      logPerson(lref, ltitle, String(p.LOG_NOTE || ''));
      return;
    }
    if (p.LOG_STARS) logRating(lref, ltitle, p.LOG_STARS, String(p.LOG_TAG || ''));
    if (p.LOG_NOTE) addMark(lref, ltitle, String(p.LOG_NOTE));
  }
});

Pebble.addEventListener('showConfiguration', function () {
  var recent = state.log.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, PAGE_LOG);
  var init = {
    tmdbKey: state.tmdbKey,
    log: recent,
    total: state.log.length,
    sheetsUrl: state.sheetsUrl,
    sheetsPending: state.syncQueue.length,
    stats: stats.compute(state.log),
    marks: state.marks.slice(0, 100),
    marksTotal: state.marks.length,
    favs: state.favs,
    lbUser: state.lbUser,
    seenCount: Object.keys(state.seen).length
  };
  var json = JSON.stringify(init).replace(/</g, '\\u003c');
  var html = sheetsConfig.patch(configHtml).replace('/*INIT*/null', function () { return json; });
  Pebble.openURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  var r;
  try {
    r = JSON.parse(decodeURIComponent(e.response));
  } catch (err) {
    console.log('Logbook: could not read settings: ' + err);
    return;
  }
  state.tmdbKey = String(r.tmdbKey || '').trim();
  save('tmdbKey', state.tmdbKey);

  var sheetsOn = r.sheets ? applySheetsSettings(r.sheets) : !!state.sheetsUrl;

  if (r.mdel && r.mdel.length) {
    state.marks = state.marks.filter(function (mk) { return r.mdel.indexOf(mk.ts) < 0; });
    save('marks', state.marks);
  }
  if (r.fdel && r.fdel.length) {
    state.favs = state.favs.filter(function (f) { return r.fdel.indexOf(f.ref) < 0; });
    save('favs', state.favs);
  }
  if (r.lb) applyLetterboxdSettings(r.lb);

  var edits = r.edits || {};
  var deletes = r.deletes || [];
  state.log = state.log.filter(function (x) { return deletes.indexOf(x.ref) < 0; });
  var changed = [];
  state.log.forEach(function (x) {
    var s = Math.round(parseFloat(edits[x.ref]) * 2) / 2;
    if (s >= 0.5 && s <= 5 && s !== x.stars) { x.stars = s; changed.push(x); }
  });
  save('log', state.log);
  changed.forEach(fireRated);   // edited ratings go to the integrations too

  if (sheetsOn && r.sheets) {
    if (r.sheets.backfill) sheetsBackfill();
    if (r.sheets.test) sheetsTest();
  }
  flushIntegrations();
});
