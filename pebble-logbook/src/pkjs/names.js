'use strict';
// Matching a spoken name to someone you already know. Speech recognition spells hard names
// differently each time ("Gamilah", "Camilah", "Jamila"). This compares how names SOUND,
// so all of those find the same person instead of creating three.
var HONOR = { ms: 1, miss: 1, mz: 1, mrs: 1, missus: 1, mr: 1, mister: 1, dr: 1, doctor: 1, prof: 1, professor: 1, coach: 1 };

function norm(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '');
}

function lev(a, b) {
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// a rough sound code: similar-sounding consonants share a letter, vowels and h/w/y are dropped
function sound(tok) {
  var s = String(tok).replace(/^(kn|gn|pn)/, 'n').replace(/^wr/, 'r').replace(/ph/g, 'f').replace(/ck/g, 'k');
  s = s.replace(/[cgjkq]/g, 'k').replace(/z/g, 's').replace(/v/g, 'f').replace(/b/g, 'p').replace(/d/g, 't').replace(/[hwy]/g, '');
  s = s.charAt(0) + s.slice(1).replace(/[aeiou]/g, '');
  return s.replace(/(.)\1+/g, '$1');
}

function tokens(name) { return norm(name).split(' ').filter(Boolean); }
function core(name) {
  var t = tokens(name), c = t.filter(function (x) { return !HONOR[x]; });
  return c.length ? c : t;
}

function tokMatch(a, b) {
  if (a === b) return true;
  var sa = sound(a), sb = sound(b);
  if (sa === sb && sa.length >= 3 && lev(a, b) <= 3) return true;
  return sa.length >= 5 && sb.length >= 5 && lev(sa, sb) <= 1 && lev(a, b) <= 2;
}

function nameMatch(spoken, known) {
  var s = core(spoken), k = core(known), i;
  if (!s.length || !k.length) return false;
  if (s.length === k.length) { for (i = 0; i < s.length; i++) if (!tokMatch(s[i], k[i])) return false; return true; }
  if (s.length === 1) return k.some(function (t) { return tokMatch(s[0], t); });   // just a first or last name
  return false;
}

// people: [{ref, name, count}]. aliases: { 'what was heard': ref } learned earlier. Returns a person or null.
function fuzzyFind(spoken, people, aliases) {
  var n = norm(spoken), i, hits = [];
  if (!n) return null;
  if (aliases && aliases[n]) for (i = 0; i < people.length; i++) if (people[i].ref === aliases[n]) return people[i];
  for (i = 0; i < people.length; i++) if (nameMatch(spoken, people[i].name)) hits.push(people[i]);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {                       // two or more candidates: only pick one that clearly dominates
    hits.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    if ((hits[0].count || 0) >= 3 && (hits[0].count || 0) >= 2 * (hits[1].count || 0)) return hits[0];
  }
  return null;
}

module.exports = { norm: norm, sound: sound, nameMatch: nameMatch, fuzzyFind: fuzzyFind };
