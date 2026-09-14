'use strict';

const { SEVERITY_ORDER, SEVERITY_RANK } = require('./util');


const RAW = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  critical: '\x1b[97;41m',
  high: '\x1b[31m',
  medium: '\x1b[33m',
  low: '\x1b[36m',
  info: '\x1b[90m',
};

const PLAIN = {
  reset: '', bold: '', dim: '',
  critical: '', high: '', medium: '', low: '', info: '',
};

const WIDTH = 78;

function makeColors(enabled) {
  return enabled ? RAW : PLAIN;
}

function wrap(text, indent, width = WIDTH) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

const ANSI = /\x1b\[[0-9;]*m/g;

// Wrap a value across lines, keeping the first line's label in the left gutter
// and aligning continuations under it.
function wrapLabelled(text, label, contIndent, width = WIDTH) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let prefix = label;
  let line = '';
  for (const word of words) {
    const visible = prefix.replace(ANSI, '').length;
    if (line && visible + line.length + 1 + word.length > width) {
      lines.push(prefix + line);
      prefix = contIndent;
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(prefix + line);
  return lines.join('\n');
}

function verdict(summary) {
  if (summary.critical > 0) {
    return {
      text: 'STOP. Do not open this folder with an agent until the critical findings are cleared.',
      tone: 'critical',
    };
  }
  if (summary.high > 0) {
    return {
      text: 'Review the high findings before letting an agent write to this folder.',
      tone: 'high',
    };
  }
  if (summary.medium > 0 || summary.low > 0) {
    return {
      text: 'No execution vectors at high or above. The remaining findings are context-dependent.',
      tone: 'medium',
    };
  }
  return { text: 'Clean. No execution vectors found.', tone: 'info' };
}

function render(result, options = {}) {
  const C = makeColors(options.color !== false);
  const quiet = !!options.quiet;
  const short = !!options.short;

  const threshold = quiet ? SEVERITY_RANK.medium : 0;
  const shown = result.findings.filter((f) => SEVERITY_RANK[f.severity] >= threshold);

  const lines = [];
  const push = (s = '') => lines.push(s);

  push(`${C.bold}gitspawn-scan${C.reset} ${C.dim}${result.version}${C.reset}`);
  push(`${C.dim}target${C.reset}  ${result.target}`);
  push(`${C.dim}scope${C.reset}   ${result.scope.gitRepositories} git director${result.scope.gitRepositories === 1 ? 'y' : 'ies'} · ${result.summary.total} finding${result.summary.total === 1 ? '' : 's'}`);
  push('');

  if (shown.length === 0) {
    push(`  ${C.info}no findings at this severity${C.reset}`);
    push('');
  }

  for (const f of shown) {
    const tag = C[`${f.severity}`] || '';
    const label = f.severity.toUpperCase();
    push(`  ${tag}${label}${C.reset}  ${C.bold}${f.ruleId}${C.reset}  ${f.title}`);

    const where = f.line ? `${f.file}:${f.line}` : f.file;
    const GUTTER = '          ';
    const CONT = `${GUTTER}        `;

    push(`${GUTTER}${C.dim}at${C.reset}      ${where}`);
    if (f.key) push(`${GUTTER}${C.dim}key${C.reset}     ${f.key}`);
    if (f.evidence) {
      push(wrapLabelled(f.evidence, `${GUTTER}${C.dim}value${C.reset}   `, CONT));
    }
    if (f.remediation) {
      push(wrapLabelled(f.remediation, `${GUTTER}${C.dim}fix${C.reset}     `, CONT));
    }
    if (!short && f.rationale) {
      push(wrap(f.rationale, GUTTER));
    }
    push('');
  }

  push(C.dim + '─'.repeat(WIDTH) + C.reset);

  const parts = SEVERITY_ORDER.slice()
    .reverse()
    .filter((s) => result.summary[s] > 0)
    .map((s) => `${C[s]}${result.summary[s]} ${s}${C.reset}`);

  push(parts.length ? parts.join(C.dim + ' · ' + C.reset) : 'nothing found');

  const v = verdict(result.summary);
  push('');
  push(`${C[v.tone] || ''}${v.text}${C.reset}`);

  if (result.findings.some((f) => f.ruleId === 'GS001')) {
    push('');
    push(`${C.dim}Harden every repository at once: ${C.reset}git config --global core.fsmonitor false`);
  }

  return lines.join('\n');
}

function toJson(result) {
  return JSON.stringify(result, null, 2);
}

module.exports = { render, toJson };
