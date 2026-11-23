// Fast drop-in for makefun-site 1.0.0.
//
// Written from the makefun-site README spec (front matter, template dialect,
// Markdown subset, slug rule, report). No dependency, no copy of any existing
// generator: the Markdown renderer is a single-pass line scanner with an
// index-range inline renderer, and templates are parsed once and compiled to
// small JavaScript functions (via new Function) that render straight into a
// string, with loop bindings resolved to locals at compile time.
//
// run(input) returns, for one case's { site, templates, files }, the output
// tree makefun-site 1.0.0 returns: a JSON object of every path it writes and
// that file's text, byte for byte.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ text */

// The HTML escape table, in the README's order: & < > " '
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
function escStr(s) {
  return s.replace(ESC_RE, (c) => ESCAPES[c]);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The slug of `text` (README "Text"). Results are cached: titles and tag names repeat across a site. */
const slugCache = new Map();
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  // NFKD is the identity on ASCII and combining marks are never ASCII, so
  // an all-ASCII string skips the normalise-and-strip step entirely.
  let plain = text;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  if (!ascii) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i];
    let keep = '';
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === '') { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it). */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/** A YYYY-MM-DD date in words, from the string alone. */
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/* ------------------------------------------------------------ front matter */

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      if (raw.length !== 10 || raw.charCodeAt(4) !== 45 || raw.charCodeAt(7) !== 45) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      let y = 0, mo = 0, d = 0;
      for (let i = 0; i < 4; i++) {
        const c = raw.charCodeAt(i);
        if (c < 48 || c > 57) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
        y = y * 10 + (c - 48);
      }
      for (let i = 5; i < 7; i++) {
        const c = raw.charCodeAt(i);
        if (c < 48 || c > 57) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
        mo = mo * 10 + (c - 48);
      }
      for (let i = 8; i < 10; i++) {
        const c = raw.charCodeAt(i);
        if (c < 48 || c > 57) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
        d = d * 10 + (c - 48);
      }
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { error: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) return { error: 'key "layout": not a template name' };
      }
      return { value: raw };
    }
    case 'slug': {
      if (raw.length === 0 || raw.length > 64) return { error: 'key "slug": not a slug' };
      let prevDash = true;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '-') {
          if (prevDash) return { error: 'key "slug": not a slug' };
          prevDash = true;
        } else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) prevDash = false;
        else return { error: 'key "slug": not a slug' };
      }
      if (prevDash) return { error: 'key "slug": not a slug' };
      return { value: raw };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

/**
 * A source's front matter and body: { data, body }, or { error }. Only the
 * front-matter region is split into lines; the body is sliced, never split.
 * `text` has "\n" line ends.
 */
function parseFrontMatter(text) {
  if (text.length < 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45 ||
      (text.length > 3 && text.charCodeAt(3) !== 10)) {
    return { error: 'no front matter' };
  }
  // The closing line: a line exactly '---'.
  let pos = 3;
  let closeIdx = -1;
  let closeEnd = -1;
  while (true) {
    const idx = text.indexOf('\n---', pos);
    if (idx === -1) break;
    const after = idx + 4;
    if (after === text.length || text.charCodeAt(after) === 10) {
      closeIdx = idx;
      closeEnd = after === text.length ? after : after + 1;
      break;
    }
    pos = idx + 1;
  }
  if (closeIdx === -1) return { error: 'the front matter is not closed' };
  const fmLines = text.slice(4, closeIdx).split('\n');
  const data = {};
  for (let j = 0; j < fmLines.length; j++) {
    const line = fmLines[j];
    if (line.charCodeAt(0) === 35) continue; // a comment opens on '#'
    if (isBlank(line)) continue;
    let k = 0;
    while (k < line.length) {
      const c = line.charCodeAt(k);
      if ((c >= 97 && c <= 122) || c === 95) k++;
      else break;
    }
    if (k === 0 || k >= line.length || line.charCodeAt(k) !== 58) return { error: `line ${j + 2} is not "key: value"` };
    const key = line.slice(0, k);
    let raw;
    if (k + 1 === line.length) raw = '';
    else if (line.charCodeAt(k + 1) === 32) raw = line.slice(k + 2);
    else return { error: `line ${j + 2} is not "key: value"` };
    let e = raw.length;
    while (e > 0 && (raw.charCodeAt(e - 1) === 32 || raw.charCodeAt(e - 1) === 9)) e--;
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(closeEnd) };
}

/* ---------------------------------------------------------------- markdown */

/** A line of spaces and tabs only. */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A line with spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

/** A fence opening line: its language, or null when the line is no fence. */
function fenceLang(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) j++;
    else break;
  }
  const lang = line.slice(3, j);
  for (; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
  }
  return lang;
}

/** A fence closing line: three backticks, spaces or tabs after them. */
function isFenceClose(line) {
  if (line.length < 3 || line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  let d = 0;
  while (d < line.length && line.charCodeAt(d) === 35) d++;
  if (d === 0 || d > 6 || d >= line.length) return null;
  const c = line.charCodeAt(d);
  if (c !== 32 && c !== 9) return null;
  let j = d;
  while (j < line.length && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
  let e = line.length;
  while (e > j && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === j) return null;
  return { depth: d, text: line.slice(j, e) };
}

/** A thematic break: `---` or `***`, then spaces or tabs only. */
function isHr(line) {
  if (line !== '---' && line !== '***') {
    if (!line.startsWith('---') && !line.startsWith('***')) return false;
    for (let j = 3; j < line.length; j++) {
      const c = line.charCodeAt(j);
      if (c !== 32 && c !== 9) return false;
    }
  }
  return true;
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  if (isBlank(line)) return true;
  if (line.charCodeAt(0) === 96 && fenceLang(line) !== null) return true;
  if (line.charCodeAt(0) === 35 && headingOf(line) !== null) return true;
  return isHr(line);
}

const CONTINUED = /^ {2,}\S/;

/** The characters a backslash escapes (as char codes). */
function isEscapableCode(c) {
  return c === 92 || c === 96 || c === 42 || c === 95 || c === 91 || c === 93 || c === 40 || c === 41 ||
    c === 35 || c === 43 || c === 45 || c === 46 || c === 33 || c === 62;
}

/** The first index in [from, end) where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from, end) {
  const wlen = what.length;
  for (let j = from; j <= end - wlen; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < end && isEscapableCode(s.charCodeAt(j + 1))) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * in [from, end) (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from, end) {
  for (let j = from; j < end; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < end && isEscapableCode(s.charCodeAt(j + 1))) { j++; continue; }
    if (c !== 42) continue;
    if (j + 1 < end && s.charCodeAt(j + 1) === 42) { j++; continue; }
    return j;
  }
  return -1;
}

/** The characters that can act inline: backslash, backtick, *, [, and the five HTML escapes. */
const SPECIAL = /[\\`*\[&<>"']/g;

/**
 * `s[a..b)` rendered inline into `out` (an array of string pieces);
 * `link(target)` is a link's href. A native scan jumps from one special
 * character to the next, so plain runs are pushed as single slices and the
 * only per-character work is inside emphasis and link candidates.
 */
function renderInline(s, a, b, link, out) {
  let i = a;
  let run = a;
  while (i < b) {
    // A global regex's test() reports the next special character without
    // building a match array: the match is one character, so it sits at
    // lastIndex - 1.
    SPECIAL.lastIndex = i;
    if (!SPECIAL.test(s)) break;
    i = SPECIAL.lastIndex - 1;
    if (i >= b) break;
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < b && isEscapableCode(s.charCodeAt(i + 1))) {
        if (i > run) out.push(s.slice(run, i));
        const n = s.charCodeAt(i + 1);
        out.push(n === 62 ? '&gt;' : s[i + 1]);
        i += 2;
        run = i;
      } else i++;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j < b && j > i + 1) {
        if (i > run) out.push(s.slice(run, i));
        out.push('<code>', escStr(s.slice(i + 1, j)), '</code>');
        i = j + 1;
        run = i;
      } else i++;
      continue;
    }
    if (c === 42) {
      if (i + 1 < b && s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2, b);
        if (j > i + 2) {
          if (i > run) out.push(s.slice(run, i));
          out.push('<strong>');
          renderInline(s, i + 2, j, link, out);
          out.push('</strong>');
          i = j + 2;
          run = i;
        } else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1, b);
      if (j > i + 1) {
        if (i > run) out.push(s.slice(run, i));
        out.push('<em>');
        renderInline(s, i + 1, j, link, out);
        out.push('</em>');
        i = j + 1;
        run = i;
      } else i++;
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1, b);
      let mm = -1;
      if (k !== -1 && k + 1 < b && s.charCodeAt(k + 1) === 40) {
        mm = s.indexOf(')', k + 2);
        if (mm === -1 || mm >= b) mm = -1;
      }
      if (mm !== -1) {
        const target = s.slice(k + 2, mm);
        if (target !== '' && !/\s/.test(target)) {
          if (i > run) out.push(s.slice(run, i));
          out.push('<a href="', escStr(link(target)), '">');
          renderInline(s, i + 1, k, link, out);
          out.push('</a>');
          i = mm + 1;
          run = i;
          continue;
        }
      }
      i++;
      continue;
    }
    // one of & < > " '
    if (i > run) out.push(s.slice(run, i));
    out.push(c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;');
    i++;
    run = i;
  }
  if (b > run) out.push(s.slice(run, b));
}

/**
 * `src` rendered in one pass over its lines, straight into one array of
 * pieces: its HTML (each block on its own lines, a "\n" after the last), its
 * table of contents (every level 2 and 3 heading: level, id and its inline
 * HTML) and its excerpt (the first paragraph's inline HTML, or ""). A block
 * whose inline HTML is needed elsewhere (a heading's, the first paragraph's)
 * is read back off the pieces just written.
 */
function renderMarkdown(src, link) {
  const lines = src.split('\n');
  const n = lines.length;
  const out = [];
  const toc = [];
  let excerpt = null;
  const ids = new Set();
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const c0 = line.charCodeAt(0);
    if (c0 === 96) {
      const lang = fenceLang(line);
      if (lang !== null) {
        const body = [];
        i++;
        while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
        if (i < n) i++;
        out.push(`<pre><code${lang === '' ? '' : ` class="language-${escStr(lang)}"`}>`);
        for (const l of body) out.push(escStr(l), '\n');
        out.push('</code></pre>', '\n');
        continue;
      }
    }
    if (c0 === 35) {
      const h = headingOf(line);
      if (h !== null) {
        const id = uniqueSlug(slugify(h.text), ids);
        out.push(`<h${h.depth} id="${id}">`);
        const start = out.length;
        renderInline(h.text, 0, h.text.length, link, out);
        const html = out.slice(start).join('');
        out.push(`</h${h.depth}>`, '\n');
        if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
        i++;
        continue;
      }
    }
    if (isHr(line)) { out.push('<hr>', '\n'); i++; continue; }
    if (c0 === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const parts = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') parts.push(t);
      }
      if (parts.length === 0) out.push('<blockquote>\n</blockquote>', '\n');
      else {
        out.push('<blockquote>\n<p>');
        const joined = parts.join('\n');
        renderInline(joined, 0, joined.length, link, out);
        out.push('</p>\n</blockquote>', '\n');
      }
      continue;
    }
    let listKind = 0;
    let listStart = 1;
    let firstText = '';
    if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) {
      listKind = 1;
      firstText = line.slice(2);
    } else if (c0 >= 48 && c0 <= 57) {
      let j = 0;
      while (j < line.length && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
      if (j >= 1 && j <= 9 && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) {
        listKind = 2;
        listStart = Number(line.slice(0, j));
        firstText = line.slice(j + 2);
      }
    }
    if (listKind !== 0) {
      const items = [[trimLine(firstText)]];
      i++;
      while (i < n) {
        const l = lines[i];
        let mText = null;
        if (listKind === 1) {
          if ((l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) mText = l.slice(2);
        } else {
          let j = 0;
          while (j < l.length && l.charCodeAt(j) >= 48 && l.charCodeAt(j) <= 57) j++;
          if (j >= 1 && j <= 9 && l.charCodeAt(j) === 46 && l.charCodeAt(j + 1) === 32) mText = l.slice(j + 2);
        }
        if (mText !== null) { items.push([trimLine(mText)]); i++; continue; }
        if (CONTINUED.test(l)) { items[items.length - 1].push(trimLine(l)); i++; continue; }
        break;
      }
      const tag = listKind === 2 ? 'ol' : 'ul';
      const open = listKind === 2 && listStart !== 1 ? `<ol start="${listStart}">` : `<${tag}>`;
      out.push(`${open}\n`);
      for (const parts of items) {
        const text = parts.join('\n');
        out.push('<li>');
        renderInline(text, 0, text.length, link, out);
        out.push('</li>\n');
      }
      out.push(`</${tag}>`, '\n');
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const text = body.join('\n');
    out.push('<p>');
    const start = out.length;
    renderInline(text, 0, text.length, link, out);
    if (excerpt === null) excerpt = out.slice(start).join('');
    out.push('</p>', '\n');
  }
  return { html: out.join(''), toc, excerpt: excerpt ?? '' };
}

/* --------------------------------------------------------------- templates */

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** Whether `src[a..b)` holds spaces or tabs only. */
function onlySpaces(src, a, b) {
  for (let i = a; i < b; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src.charCodeAt(open + 1);
    if (next !== 123 && next !== 37) {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === 123) {
      const raw = src.charCodeAt(open + 2) === 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = onlySpaces(src, lineStart, open) && onlySpaces(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') { body.push({ kind: 'text', text: tok.text }); continue; }
    if (tok.t === 'var' || tok.t === 'raw') { body.push({ kind: tok.t, path: tok.path }); continue; }
    const tag = tok.tag;
    const top = stack[stack.length - 1];
    let m;
    if ((m = FOR_RE.exec(tag)) !== null) {
      const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
      body.push(node);
      stack.push(node);
      body = node.body;
    } else if ((m = IF_RE.exec(tag)) !== null) {
      const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
      body.push(node);
      stack.push(node);
      body = node.then;
    } else if (tag === 'else') {
      if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
      top.else = [];
      body = top.else;
    } else if (tag === 'endfor' || tag === 'endif') {
      if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
      stack.pop();
      const parent = stack[stack.length - 1];
      body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
    } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
      body.push({ kind: 'include', name: m[1] });
    } else {
      throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** A value as text, HTML-escaped: E(X(v)) in one call, strings fast-pathed. */
function escVal(v) {
  if (typeof v === 'string') return escStr(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return escStr(v.map(textOf).join(', '));
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** One own property step of a path: the value, or undefined. */
function g1(v, k) {
  return v !== null && typeof v === 'object' && Object.hasOwn(v, k) ? v[k] : undefined;
}

/** The value at `ks` under `v`, or undefined. */
function g(v, ks) {
  for (let i = 0; i < ks.length; i++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, ks[i])) return undefined;
    v = v[ks[i]];
  }
  return v;
}

/** Whether `list` (or anything nested in it) holds an include. */
function hasInclude(list) {
  for (const n of list) {
    if (n.kind === 'include') return true;
    if (n.kind === 'for' && hasInclude(n.body)) return true;
    if (n.kind === 'if' && (hasInclude(n.then) || (n.else !== null && hasInclude(n.else)))) return true;
  }
  return false;
}

/**
 * A parsed template compiled to a function (T, E, X, U, G1, G, e0, d):
 * T the compiled templates by name, E the value-as-escaped-text, X the
 * value-as-text, U the if-truthiness, G1/G the path steps, e0 the scope (a
 * null-prototype object of the names in scope, so a missing name reads
 * undefined) and d the include depth. Loop bindings are resolved to locals
 * at compile time: the innermost loop that binds a name wins, and `loop`
 * always names the loop object. A loop whose body holds no include needs
 * no scope object of its own: its bindings are carried as pending and
 * merged into a scope only where an include (or a loop that has one)
 * needs them.
 */
function compileTemplate(nodes) {
  let code = 'let o="";';
  let level = 0;
  let envCounter = 0;
  const envVars = new Set();
  const bindings = [];
  // The codegen-time scope state: envVar names the JS variable holding a
  // scope with every binding in scope except the ones in pending.
  const st = { envVar: 'e0', pending: [] };
  function freshEnv() {
    const ev = `e${++envCounter}`;
    envVars.add(ev);
    return ev;
  }
  function ensureEnv() {
    if (st.pending.length === 0) return st.envVar;
    const ev = freshEnv();
    const parts = st.pending.map((bd) => `${JSON.stringify(bd.varName)}:${bd.elem},loop:${bd.loop}`).join(',');
    code += `${ev}=Object.assign(Object.create(null),${st.envVar},{${parts}});`;
    st.envVar = ev;
    st.pending = [];
    return st.envVar;
  }
  function pathExpr(path) {
    const first = path[0];
    let expr;
    for (let b = bindings.length - 1; b >= 0; b--) {
      const bd = bindings[b];
      if (first === 'loop') { expr = bd.loop; break; }
      if (first === bd.varName) { expr = bd.elem; break; }
    }
    if (expr === undefined) expr = `${st.envVar}.${first}`;
    if (path.length === 1) return expr;
    if (path.length === 2) return `G1(${expr},${JSON.stringify(path[1])})`;
    return `G(${expr},${JSON.stringify(path.slice(1))})`;
  }
  function gen(list) {
    for (const n of list) {
      if (n.kind === 'text') { code += `o+=${JSON.stringify(n.text)};`; continue; }
      if (n.kind === 'var') { code += `o+=E(${pathExpr(n.path)});`; continue; }
      if (n.kind === 'raw') { code += `o+=X(${pathExpr(n.path)});`; continue; }
      if (n.kind === 'if') {
        if (hasInclude(n.then) || (n.else !== null && hasInclude(n.else))) ensureEnv();
        const savedEnv = st.envVar, savedPending = st.pending;
        code += `if(U(${pathExpr(n.path)})!==${n.not}){`;
        gen(n.then);
        st.envVar = savedEnv;
        st.pending = savedPending;
        code += '}';
        if (n.else !== null) {
          code += 'else{';
          gen(n.else);
          st.envVar = savedEnv;
          st.pending = savedPending;
          code += '}';
        }
        continue;
      }
      if (n.kind === 'for') {
        level++;
        const lv = level;
        const xs = `_a${lv}`, k = `_k${lv}`, el = `_v${lv}`, lp = `_l${lv}`;
        const head = `{const ${xs}=${pathExpr(n.path)};if(Array.isArray(${xs})){for(let ${k}=0;${k}<${xs}.length;${k}++){const ${el}=${xs}[${k}];const ${lp}={index:${k}+1,first:${k}===0,last:${k}===${xs}.length-1,length:${xs}.length};`;
        if (hasInclude(n.body)) {
          const ev = freshEnv();
          const parts = [...st.pending, { varName: n.name, elem: el, loop: lp }]
            .map((bd) => `${JSON.stringify(bd.varName)}:${bd.elem},loop:${bd.loop}`).join(',');
          code += `${head}${ev}=Object.assign(Object.create(null),${st.envVar},{${parts}});`;
          const savedEnv = st.envVar, savedPending = st.pending;
          st.envVar = ev;
          st.pending = [];
          bindings.push({ varName: n.name, elem: el, loop: lp });
          gen(n.body);
          bindings.pop();
          st.envVar = savedEnv;
          st.pending = savedPending;
        } else {
          code += head;
          bindings.push({ varName: n.name, elem: el, loop: lp });
          st.pending.push({ varName: n.name, elem: el, loop: lp });
          gen(n.body);
          st.pending.pop();
          bindings.pop();
        }
        code += '}}}';
        level--;
        continue;
      }
      // include
      const ev = ensureEnv();
      code += `if(d<8){const _f=T.get(${JSON.stringify(n.name)});if(_f!==undefined)o+=_f(T,E,X,U,G1,G,${ev},d+1);}`;
    }
  }
  gen(nodes);
  code += 'return o;';
  if (envVars.size > 0) code = `let ${[...envVars].join(',')};` + code;
  return new Function('T', 'E', 'X', 'U', 'G1', 'G', 'e0', 'd', code);
}

/** Compiled templates by their source text: a template's compiled form depends on its source alone. */
const compileCache = new Map();

/* --------------------------------------------------------------------- build */

const RESERVED = ['posts', 'tags', 'page'];
const REPORT_FILE = 'build-report.txt';

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Whether a char code is JavaScript whitespace (the \s set). */
function isWsCode(c) {
  if (c < 128) return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
  return c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
    c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

const WS_RUN = /\s+/g;

/** The words of a body: its runs of characters other than whitespace.
 * Words are whitespace runs + 1, less one for leading and one for trailing
 * whitespace; the runs are counted with test(), which builds no match. */
function countWords(text) {
  if (text.length === 0) return 0;
  let runs = 0;
  WS_RUN.lastIndex = 0;
  while (WS_RUN.test(text)) runs++;
  let w = runs + 1;
  if (isWsCode(text.charCodeAt(0))) w--;
  if (isWsCode(text.charCodeAt(text.length - 1))) w--;
  return w;
}

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Whether a link target is kept as written: it has a scheme, or opens on `/` or `#`. */
function isExternal(target) {
  const c0 = target.charCodeAt(0);
  if (c0 === 47 || c0 === 35) return true;
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < target.length; i++) {
    const c = target.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

/** One site's output tree: path -> text. */
export function run(input) {
  const report = [];
  const templates = new Map();
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    const src = input.templates[name];
    let fn = compileCache.get(src);
    if (fn === undefined) {
      try {
        fn = compileTemplate(parseTemplate(name, src));
      } catch (err) {
        if (!(err instanceof TemplateError)) throw err;
        report.push(err.message);
        continue;
      }
      compileCache.set(src, fn);
    }
    templates.set(name, fn);
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }

  // Front matter, in source order; a refused source or a draft is reported and dropped.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // Permalinks: each page's slug made unique in its directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // Markdown, each body's links resolved to the pages and static files they name.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const link = (target) => {
      if (isExternal(target)) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, link);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.readingMinutes = Math.max(1, Math.ceil(countWords(s.body) / 200));
  }

  // Collections: the posts, newest date first, and equal dates by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // Tags: each post's tags, each slug once, in its own order; a tag named as
  // first met walking the posts in collection order.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push([name, slug]);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const [name, slug] of ownTags(p)) {
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map(([name, slug]) => bySlug.get(slug) ?? { name, slug, url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // Layouts.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: s.readingMinutes,
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const pageOf = (s) => ({
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });
  const cards = new Map();
  for (const p of posts) cards.set(p, cardOf(p));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const baseEnv = { site, tags: allTags, recent };
  const output = {};
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    const env = Object.assign(Object.create(null), baseEnv, vars);
    return fn(templates, escVal, textOf, truthy, g1, g, env, 0);
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // The report: every line reported above and each broken link, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}
