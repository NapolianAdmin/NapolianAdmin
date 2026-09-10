#!/usr/bin/env node
// render-projects.mjs
// Regenerates the Selected Work card block in README.md from data/projects.json,
// per A5-DESIGN.md section 3. Node built-ins only, zero npm dependencies.
//
// Usage:
//   node scripts/render-projects.mjs           write README.md in place if changed
//   node scripts/render-projects.mjs --check    do not write; exit 3 if it would change
//
// Fails loud (exit 1, writes nothing) if data/projects.json is missing, invalid,
// or has zero entries, or if the README markers are absent.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = ROOT + 'data/projects.json';
const README = ROOT + 'README.md';

const START = '<!-- PROJECTS:START -->';
const END = '<!-- PROJECTS:END -->';
const MIDDOT = '·'; // U+00B7 MIDDLE DOT
const MAX_CARDS = 6;
const MORE_LINE =
  'More on the [repositories tab](https://github.com/NapolianAdmin?tab=repositories).';

// stack string (exact) -> icon slug, or null for text-only fallback. A5-DESIGN.md section 3.
const stackToIconSlug = {
  'Next.js': 'nextjs',
  'TypeScript': 'typescript',
  'Python': 'python',
  'FastAPI': 'fastapi',
  'Supabase': 'supabase',
  'GitHub Actions': 'githubactions',
  'Vercel': 'vercel',
  'React': 'react',
  'Render': null,
};

function fail(msg) {
  console.error('render-projects: ' + msg);
  process.exit(1);
}

function warn(msg) {
  console.error('render-projects: warning: ' + msg);
}

function loadManifest() {
  let raw;
  try {
    raw = readFileSync(MANIFEST, 'utf8');
  } catch (err) {
    fail('cannot read data/projects.json (' + err.code + ')');
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    fail('data/projects.json is not valid JSON: ' + err.message);
  }
  if (!Array.isArray(data)) fail('data/projects.json must be a JSON array');
  if (data.length === 0) fail('data/projects.json has zero entries');
  data.forEach((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      fail('entry ' + i + ' is not an object');
    }
    if (typeof e.name !== 'string' || e.name.trim() === '') {
      fail('entry ' + i + ' has no non-empty string "name"');
    }
    if (typeof e.tagline !== 'string' || e.tagline.trim() === '') {
      fail('entry ' + i + ' ("' + e.name + '") has no non-empty string "tagline"');
    }
    if (!Array.isArray(e.stack)) {
      fail('entry ' + i + ' ("' + e.name + '") has no "stack" array');
    }
  });
  return data;
}

// highlight entries first (manifest order preserved), then the rest (manifest order).
function orderEntries(entries) {
  const highlighted = entries.filter((e) => e.highlight === true);
  const rest = entries.filter((e) => e.highlight !== true);
  return highlighted.concat(rest);
}

function iconLinesFor(stack) {
  const lines = [];
  for (const item of stack) {
    let slug;
    if (Object.prototype.hasOwnProperty.call(stackToIconSlug, item)) {
      slug = stackToIconSlug[item];
    } else {
      warn('unknown stack string "' + item + '" - rendering as text only, no icon');
      slug = null;
    }
    if (slug == null) continue;
    lines.push(
      '  <img src="./assets/icons/' +
        slug +
        '.svg" alt="' +
        item +
        '" title="' +
        item +
        '" height="28">'
    );
  }
  return lines;
}

function renderCard(entry) {
  const status = entry.status;
  const hasUrl = typeof entry.url === 'string' && entry.url.trim() !== '';

  let linked = false;
  let chip;
  if (status === 'private-soon') {
    chip = '`Private ' + MIDDOT + ' opening soon`';
  } else if (status === 'public') {
    if (hasUrl) {
      linked = true;
      chip = '`Public`';
    } else {
      warn(
        '"' + entry.name + '" has status "public" but no url - rendering as private-soon, no link'
      );
      chip = '`Private ' + MIDDOT + ' opening soon`';
    }
  } else {
    warn(
      '"' + entry.name + '" has unknown status "' + String(status) + '" - rendering status pending, no link'
    );
    chip = '`Status pending`';
  }

  const heading = linked
    ? '### [' + entry.name + '](' + entry.url + ')'
    : '### ' + entry.name;

  const lines = [heading, '', entry.tagline, ''];

  const icons = iconLinesFor(entry.stack);
  if (icons.length > 0) {
    lines.push('<p>');
    for (const l of icons) lines.push(l);
    lines.push('</p>');
    lines.push('');
  }

  lines.push('Stack: ' + entry.stack.join(', '));
  lines.push('');
  lines.push(chip);

  return lines.join('\n');
}

function renderBlock(entries) {
  const ordered = orderEntries(entries);
  const shown = ordered.slice(0, MAX_CARDS);
  const cards = shown.map(renderCard);
  let block = cards.join('\n\n');
  if (entries.length > MAX_CARDS) {
    block += '\n\n' + MORE_LINE;
  }
  return block;
}

function splice(readme, block) {
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s < 0 || e < 0 || e < s) {
    fail('README.md is missing the PROJECTS:START / PROJECTS:END markers');
  }
  const before = readme.slice(0, s + START.length);
  const after = readme.slice(e);
  return before + '\n' + block + '\n' + after;
}

function main() {
  const check = process.argv.includes('--check');
  const entries = loadManifest();
  const block = renderBlock(entries);

  let readme;
  try {
    readme = readFileSync(README, 'utf8');
  } catch (err) {
    fail('cannot read README.md (' + err.code + ')');
  }

  const next = splice(readme, block);

  if (next === readme) {
    console.log('render-projects: README.md already up to date (' + entries.length + ' entries)');
    return;
  }

  if (check) {
    console.error('render-projects: README.md is stale - run without --check to update');
    process.exit(3);
  }

  writeFileSync(README, next);
  console.log('render-projects: README.md updated (' + entries.length + ' entries)');
}

main();
