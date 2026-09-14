'use strict';

// Minimal git config parser. Produces one entry per key with its section,
// optional subsection, 1-based line number and unquoted value, so rules can
// match on structure (`section === 'filter' && key === 'clean'`) instead of
// string-matching dotted key names.

function unquoteValue(raw) {
  const t = raw.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    const body = t.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c !== '\\') {
        out += c;
        continue;
      }
      const n = body[++i];
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'b') out += '\b';
      else if (n === undefined) out += '\\';
      else out += n;
    }
    return out;
  }
  return t;
}

function parseGitConfig(text) {
  const entries = [];
  if (typeof text !== 'string') return entries;

  const lines = text.split(/\r?\n/);
  let section = null;
  let rawSection = null;
  let subsection = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed[0] === '#' || trimmed[0] === ';') continue;

    if (trimmed[0] === '[') {
      const m = trimmed.match(/^\[\s*([A-Za-z0-9._-]+)(?:\s+"([^"]*)")?\s*\]/);
      if (!m) continue;
      rawSection = m[1];
      section = m[1].toLowerCase();
      subsection = m[2] === undefined ? null : m[2];
      // Legacy `[section.subsection]` form.
      if (subsection === null && section.includes('.')) {
        const dot = section.indexOf('.');
        subsection = section.slice(dot + 1);
        rawSection = rawSection.slice(0, dot);
        section = section.slice(0, dot);
      }
      continue;
    }

    if (section === null) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const rawKey = trimmed.slice(0, eq).trim();
    const key = rawKey.toLowerCase();
    if (!key) continue;

    entries.push({
      section,
      subsection,
      key,
      value: unquoteValue(trimmed.slice(eq + 1)),
      // Original casing, for display. `match` predicates use section/subsection/key.
      name: subsection === null ? `${rawSection}.${rawKey}` : `${rawSection}.${subsection}.${rawKey}`,
      line: i + 1,
    });
  }

  return entries;
}

// git treats true/yes/on/1 (and absent value) as enabled booleans. Anything
// else stored in a boolean-ish key is a path or command git will execute.
function isBooleanish(v) {
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'true' || s === 'false' || s === 'yes' || s === 'no' || s === 'on' || s === 'off' || s === '1' || s === '0';
}

module.exports = { parseGitConfig, unquoteValue, isBooleanish };
