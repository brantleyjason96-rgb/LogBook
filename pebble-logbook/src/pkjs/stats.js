// Logbook stats engine. Pure functions over the rating log, so the same numbers
// feed the watch's stats pages and the settings page.
//   log record: { ref, cat, title, stars (0.5 to 5), ts (ms) }

var DAY = 86400000;
var CAT_LETTER = { movie: 'm', tv: 't', podcast: 'p', music: 'a', book: 'b',
                   song: 's', game: 'g', recipe: 'r', other: 'x' };
var RANGES = ['w', 'm', 'y', 'a'];
var RANGE_TITLES = { w: 'Last 7 days', m: 'Last 30 days', y: 'Last 12 months', a: 'All time' };
var WEEKDAY1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
var MONTH1 = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// Whole local days, so "today" follows the phone's clock and time zone.
function dayNum(ms) {
  var d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

function dayDate(n) {            // a Date whose UTC fields hold that local calendar day
  return new Date(n * DAY);
}

function monthKey(ms) {
  var d = new Date(ms);
  return d.getFullYear() * 12 + d.getMonth();
}

function r1(x) { return Math.round(x * 10) / 10; }

function summarize(recs) {
  var sum = 0;
  recs.forEach(function (r) { sum += r.stars; });
  return { n: recs.length, avg: recs.length ? r1(sum / recs.length) : 0 };
}

function inDays(log, firstDay, lastDay) {
  return log.filter(function (r) {
    var d = dayNum(r.ts);
    return d >= firstDay && d <= lastDay;
  });
}

// ---- bars: how many things you rated in each bucket ----

function barsFor(range, log, today, now) {
  var out = [], i;
  if (range === 'w') {
    for (i = 6; i >= 0; i--) {
      var d = today - i;
      out.push({ l: WEEKDAY1[dayDate(d).getUTCDay()], n: inDays(log, d, d).length, now: i === 0 });
    }
  } else if (range === 'm') {
    for (i = 5; i >= 0; i--) {                       // six buckets of five days
      var last = today - i * 5, first = last - 4;
      out.push({ l: String(dayDate(first).getUTCDate()), n: inDays(log, first, last).length, now: i === 0 });
    }
  } else if (range === 'y') {
    var mk = monthKey(now);
    for (i = 11; i >= 0; i--) {
      var key = mk - i;
      out.push({
        l: MONTH1[((key % 12) + 12) % 12],
        n: log.filter(function (r) { return monthKey(r.ts) === key; }).length,
        now: i === 0
      });
    }
  } else {
    var d0 = new Date(now);
    var qk = d0.getFullYear() * 4 + Math.floor(d0.getMonth() / 3);
    var firstQ = qk;
    log.forEach(function (r) {
      var d1 = new Date(r.ts);
      var k = d1.getFullYear() * 4 + Math.floor(d1.getMonth() / 3);
      if (k < firstQ) firstQ = k;
    });
    if (qk - firstQ > 7) firstQ = qk - 7;
    for (var q = firstQ; q <= qk; q++) {
      out.push({
        l: 'Q' + (((q % 4) + 4) % 4 + 1),
        n: log.filter(function (r) {
          var d2 = new Date(r.ts);
          return d2.getFullYear() * 4 + Math.floor(d2.getMonth() / 3) === q;
        }).length,
        now: q === qk
      });
    }
  }
  return out;
}

// ---- activity: a calendar grid of days, Monday first ----

function levelFor(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 2;
  if (n <= 4) return 3;
  return 4;
}

// weeks columns x 7 rows, column-major, oldest first. Days after today are -1.
function heatGrid(log, today, weeks) {
  var counts = {};
  log.forEach(function (r) {
    var d = dayNum(r.ts);
    counts[d] = (counts[d] || 0) + 1;
  });
  var row = (dayDate(today).getUTCDay() + 6) % 7;    // Monday = 0
  var start = today - row - (weeks - 1) * 7;
  var cells = [];
  for (var i = 0; i < weeks * 7; i++) {
    var d = start + i;
    cells.push(d > today ? -1 : levelFor(counts[d] || 0));
  }
  return { cells: cells, counts: counts, start: start };
}

function streaks(counts, today) {
  var days = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
  var best = 0, run = 0, prev = null;
  days.forEach(function (d) {
    run = (prev !== null && d === prev + 1) ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  });
  // The current streak survives until the end of today, so count back from today
  // or, if nothing is logged yet today, from yesterday.
  var cur = 0;
  var d2 = counts[today] ? today : today - 1;
  while (counts[d2]) { cur++; d2--; }
  return { cur: cur, best: best };
}

// ---- one range ----

function rangeStats(log, range, today, now) {
  var span = range === 'w' ? 7 : range === 'm' ? 30 : range === 'y' ? 365 : 0;
  var cur = span ? inDays(log, today - span + 1, today) : log.slice();
  var prev = span ? inDays(log, today - 2 * span + 1, today - span) : null;
  var s = summarize(cur);
  var p = prev ? summarize(prev) : null;

  var hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  cur.forEach(function (r) {
    var h = Math.max(1, Math.min(10, Math.round(r.stars * 2)));
    hist[h - 1]++;
  });
  var mode = 0;
  hist.forEach(function (c, i) { if (c > 0 && c >= hist[mode]) mode = i; });   // ties go to the higher rating

  var byCat = {};
  cur.forEach(function (r) {
    var c = byCat[r.cat] || (byCat[r.cat] = { cat: r.cat, n: 0, sum: 0 });
    c.n++;
    c.sum += r.stars;
  });
  var kinds = Object.keys(byCat).map(function (k) {
    var c = byCat[k];
    return { cat: c.cat, letter: CAT_LETTER[c.cat] || 'x', n: c.n, avg: r1(c.sum / c.n) };
  }).sort(function (a, b) { return b.n - a.n || (a.cat < b.cat ? -1 : 1); });

  var byTag = {};
  cur.forEach(function (r) {
    if (!r.tag) return;
    var t = byTag[r.tag] || (byTag[r.tag] = { tag: r.tag, n: 0, sum: 0 });
    t.n++;
    t.sum += r.stars;
  });
  var tags = Object.keys(byTag).map(function (k) {
    return { tag: k, n: byTag[k].n, avg: r1(byTag[k].sum / byTag[k].n) };
  }).sort(function (a, b) { return b.n - a.n || (a.tag < b.tag ? -1 : 1); }).slice(0, 8);

  var ranked = cur.slice().sort(function (a, b) { return b.stars - a.stars || b.ts - a.ts; });
  var top = ranked.slice(0, 3).map(function (r) { return { title: r.title, ref: r.ref, stars: r.stars }; });
  var low = null;
  if (ranked.length >= 4) {
    var w = ranked[ranked.length - 1];
    if (w.stars <= 2.5) low = { title: w.title, ref: w.ref, stars: w.stars };
  }

  var tone = 'Fair judge';
  if (s.n < 3) tone = 'Rate a few more';
  else if (s.avg >= 4) tone = 'Generous rater';
  else if (s.avg < 3) tone = 'Tough critic';
  var common = s.n ? 'Mostly ' + (mode + 1) / 2 + ' stars' : 'Nothing rated yet';
  var loved = 0;
  hist.forEach(function (c, i) { if (i >= 7) loved += c; });

  return {
    range: range,
    title: RANGE_TITLES[range],
    n: s.n,
    avg: s.avg,
    prevN: p ? p.n : null,
    prevAvg: p ? p.avg : null,
    bars: barsFor(range, log, today, now),
    hist: hist,
    common: common,
    tone: tone,
    lovedShare: s.n ? Math.round(100 * loved / s.n) : 0,
    kinds: kinds,
    tags: tags,
    top: top,
    low: low
  };
}

// Everything the watch and the settings page need.
function compute(log, now) {
  now = now || Date.now();
  var today = dayNum(now);
  var grid = heatGrid(log, today, 12);
  var wide = heatGrid(log, today, 26);
  var st = streaks(grid.counts, today);
  var all = {};
  RANGES.forEach(function (r) { all[r] = rangeStats(log, r, today, now); });
  var activeDays = 0;
  grid.cells.forEach(function (c) { if (c > 0) activeDays++; });
  var todayRecs = inDays(log, today, today);
  var tsum = summarize(todayRecs);
  var first = 0;
  log.forEach(function (r) { if (!first || r.ts < first) first = r.ts; });
  return {
    ranges: all,
    activity: {
      heat: grid.cells,
      heatWide: wide.cells,
      heatWideStart: wide.start,
      streak: st.cur,
      best: st.best,
      activeDays: activeDays,
      total: log.length,
      first: first
    },
    today: { n: tsum.n, avg: tsum.avg }
  };
}

// ---- watch encoding (see the STATS_* parser in main.c) ----

var B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function scaled(values) {         // 0..35 per value, relative to the biggest
  var max = 0;
  values.forEach(function (v) { if (v > max) max = v; });
  return values.map(function (v) {
    if (!max || !v) return 0;
    return Math.max(1, Math.round(35 * v / max));
  });
}

function b36(values) {
  return scaled(values).map(function (v) { return B36.charAt(v); }).join('');
}

function avg10(a) { return Math.round(a * 10); }

// Packs the 84 heat cells (levels 0-4, or 5 for a day still to come) two to a character.
function heatChars(cells) {
  var out = '';
  for (var i = 0; i < cells.length; i += 2) {
    var a = cells[i] < 0 ? 5 : cells[i];
    var b = cells[i + 1] < 0 ? 5 : cells[i + 1];
    out += B36.charAt(a * 6 + b);
  }
  return out;
}

// Entry types (low four bits of the flags); the stars of a pick ride in the upper four.
var T = { OVERVIEW: 1, HEAT: 2, HIST: 3, KINDS: 4, TOP: 5, LOW: 6 };

function watchEntries(stats, range, clean) {
  var rs = stats.ranges[range];
  var act = stats.activity;
  var out = [];

  var barH = [], barL = [];
  rs.bars.forEach(function (b) { barH.push(b.n); barL.push(b.l); });
  out.push({
    label: [rs.n, avg10(rs.avg), rs.prevN === null ? -1 : rs.prevN,
            rs.prevAvg === null ? -1 : avg10(rs.prevAvg), act.streak, act.best].join(' '),
    ref: b36(barH) + '/' + barL.join(','),
    flags: T.OVERVIEW,
    title: rs.title
  });

  var hc = heatChars(act.heat);                       // 42 characters
  out.push({ label: hc.slice(0, 21), ref: hc.slice(21), flags: T.HEAT });

  out.push({ label: b36(rs.hist), ref: rs.common + '|' + rs.tone, flags: T.HIST });

  var parts = rs.kinds.slice(0, 7).map(function (k) {
    return k.letter + Math.min(k.n, 999) + ',' + avg10(k.avg);
  });
  out.push({ label: parts.slice(0, 3).join(' '), ref: parts.slice(3).join(' '), flags: T.KINDS });

  rs.top.forEach(function (t) {
    out.push({ label: clean(t.title, 31), ref: t.ref, flags: T.TOP | (Math.round(t.stars * 2) << 4) });
  });
  if (rs.low) {
    out.push({ label: clean(rs.low.title, 31), ref: rs.low.ref, flags: T.LOW | (Math.round(rs.low.stars * 2) << 4) });
  }
  return out;
}

module.exports = {
  compute: compute,
  watchEntries: watchEntries,
  dayNum: dayNum,
  RANGES: RANGES,
  RANGE_TITLES: RANGE_TITLES,
  T: T,
  heatChars: heatChars
};
