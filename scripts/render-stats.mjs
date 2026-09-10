#!/usr/bin/env node
// render-stats.mjs
// Builds two self-hosted SVG cards - assets/stats-light.svg and assets/stats-dark.svg -
// from the GitHub GraphQL API. Node built-ins only (uses the global fetch), zero npm deps.
//
// Data shown:
//   - user(login: "NapolianAdmin").contributionsCollection.contributionCalendar.totalContributions
//     (already public on the profile; leaks nothing)
//   - language mix aggregated over PUBLIC, non-fork repositories OWNED by the user only.
//     Private-repo data is never requested and never rendered.
//
// The query is scoped by user(login: "NapolianAdmin") so it resolves to the
// profile owner regardless of which identity the token belongs to. This lets it
// run on the stock Actions GITHUB_TOKEN (identity: github-actions[bot]); every
// field read here is available under user(login:) with a basic read-only token.
//
// Requires GITHUB_TOKEN in the environment.
// Fails loud (exit 1, writes nothing) on any API/transport error, a GraphQL error
// payload, a malformed response, or a genuinely empty account (no contributions,
// no public repos, no language bytes).

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_LIGHT = ROOT + 'assets/stats-light.svg';
const OUT_DARK = ROOT + 'assets/stats-dark.svg';
const MAX_BYTES = 20000;
const TOP_N = 6;

const THEMES = {
  light: {
    bg: '#fcfcfb',
    text: '#111418',
    muted: '#55606b',
    accent: '#1f6f5c',
    hairline: '#b7bcc3',
    track: '#e7e9ec',
    ramp: ['#1f6f5c', '#3f7c8a', '#7d6a9c', '#8a6d3b', '#4f6b52', '#9aa0a6'],
  },
  dark: {
    bg: '#0d1117',
    text: '#f0f3f6',
    muted: '#9ba6b2',
    accent: '#53d2b6',
    hairline: '#39414c',
    track: '#222a35',
    ramp: ['#53d2b6', '#6fb0c4', '#a99bd0', '#c9a86a', '#7fbf8f', '#8b949e'],
  },
};

const QUERY = `query {
  user(login: "NapolianAdmin") {
    login
    contributionsCollection {
      contributionCalendar { totalContributions }
    }
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
      totalCount
      nodes { languages(first: 20) { edges { size node { name } } } }
    }
  }
}`;

function fail(msg) {
  console.error('render-stats: ' + msg);
  process.exit(1);
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function queryApi(token) {
  let res;
  try {
    res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'NapolianAdmin-profile-render-stats',
      },
      body: JSON.stringify({ query: QUERY }),
    });
  } catch (err) {
    fail('network error calling the GitHub GraphQL API: ' + err.message);
  }
  if (!res.ok) {
    fail('GitHub GraphQL API returned HTTP ' + res.status + ' ' + res.statusText);
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    fail('could not parse the GraphQL response as JSON: ' + err.message);
  }
  if (json.errors) {
    fail('GraphQL error: ' + JSON.stringify(json.errors));
  }
  const account = json && json.data && json.data.user;
  if (!account) fail('GraphQL response has no data.user');
  return account;
}

function aggregate(account) {
  const total =
    account.contributionsCollection &&
    account.contributionsCollection.contributionCalendar &&
    account.contributionsCollection.contributionCalendar.totalContributions;
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    fail('totalContributions missing or not a number');
  }

  const repos = (account.repositories && account.repositories.nodes) || [];
  const repoCount =
    (account.repositories && account.repositories.totalCount) || repos.length;

  const bySize = new Map();
  for (const repo of repos) {
    const edges = (repo.languages && repo.languages.edges) || [];
    for (const edge of edges) {
      const name = edge && edge.node && edge.node.name;
      const size = edge && edge.size;
      if (!name || typeof size !== 'number' || size <= 0) continue;
      bySize.set(name, (bySize.get(name) || 0) + size);
    }
  }

  let langs = [...bySize.entries()]
    .map(([name, size]) => ({ name, size }))
    .sort((a, b) => b.size - a.size);

  const langTotal = langs.reduce((s, l) => s + l.size, 0);

  if (total === 0 && langTotal === 0 && repoCount === 0) {
    fail('empty account: no contributions, no public repos, no language bytes - nothing to render');
  }

  let top = langs.slice(0, TOP_N);
  const rest = langs.slice(TOP_N);
  if (rest.length > 0) {
    const otherSize = rest.reduce((s, l) => s + l.size, 0);
    if (otherSize > 0) top = top.concat([{ name: 'Other', size: otherSize }]);
  }
  const withPct = top.map((l) => ({
    name: l.name,
    size: l.size,
    pct: langTotal > 0 ? (l.size / langTotal) * 100 : 0,
  }));

  return {
    login: account.login,
    contributions: total,
    repoCount,
    langTotal,
    langs: withPct,
  };
}

function fmtInt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function renderSvg(model, themeName) {
  const t = THEMES[themeName];
  const W = 480;
  const PAD = 20;
  const barX = PAD;
  const barY = 82;
  const barW = W - PAD * 2;
  const barH = 10;

  const hasLangs = model.langTotal > 0 && model.langs.length > 0;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="__H__" viewBox="0 0 ${W} __H__" role="img" aria-label="${xmlEscape(
      'Language mix and contribution summary for Ninad Rai'
    )}">`
  );
  parts.push(`<title>Language mix and contribution summary for Ninad Rai</title>`);
  parts.push(
    `<rect x="0" y="0" width="${W}" height="__H__" fill="${t.bg}"/>`
  );

  const FONT =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  // headline numbers
  parts.push(
    `<text x="${PAD}" y="44" font-family="${FONT}" font-size="30" font-weight="700" fill="${t.text}">${xmlEscape(
      fmtInt(model.contributions)
    )}</text>`
  );
  parts.push(
    `<text x="${PAD}" y="63" font-family="${FONT}" font-size="11" fill="${t.muted}">contributions in the last year</text>`
  );
  parts.push(
    `<text x="250" y="44" font-family="${FONT}" font-size="30" font-weight="700" fill="${t.text}">${xmlEscape(
      fmtInt(model.repoCount)
    )}</text>`
  );
  parts.push(
    `<text x="250" y="63" font-family="${FONT}" font-size="11" fill="${t.muted}">public repositories</text>`
  );

  let H;
  if (hasLangs) {
    // stacked language bar, clipped to a rounded rect so segment corners read as rounded
    const clipId = 'barclip-' + themeName;
    parts.push(
      `<defs><clipPath id="${clipId}"><rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="5"/></clipPath></defs>`
    );
    parts.push(`<g clip-path="url(#${clipId})">`);
    parts.push(
      `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="${t.track}"/>`
    );
    let cursor = barX;
    const total = model.langs.reduce((s, l) => s + l.size, 0);
    const colorFor = (l, i) => (l.name === 'Other' ? t.muted : t.ramp[i % t.ramp.length]);
    model.langs.forEach((l, i) => {
      const w = Math.max(0, (l.size / total) * barW);
      const color = colorFor(l, i);
      parts.push(
        `<rect x="${cursor.toFixed(2)}" y="${barY}" width="${w.toFixed(
          2
        )}" height="${barH}" fill="${color}"/>`
      );
      cursor += w;
    });
    parts.push('</g>');

    // legend, flow layout
    const legendY0 = barY + barH + 20;
    let lx = PAD;
    let ly = legendY0;
    const lineH = 18;
    const rightEdge = W - PAD;
    model.langs.forEach((l, i) => {
      const label = `${l.name} ${l.pct.toFixed(l.pct < 10 ? 1 : 0)}%`;
      const est = 14 + label.length * 6.2 + 14; // swatch + text + gap
      if (lx + est > rightEdge && lx > PAD) {
        lx = PAD;
        ly += lineH;
      }
      const color = colorFor(l, i);
      parts.push(
        `<rect x="${lx.toFixed(2)}" y="${(ly - 9).toFixed(
          2
        )}" width="9" height="9" rx="2" fill="${color}"/>`
      );
      parts.push(
        `<text x="${(lx + 14).toFixed(
          2
        )}" y="${ly.toFixed(2)}" font-family="${FONT}" font-size="11" fill="${t.text}">${xmlEscape(
          label
        )}</text>`
      );
      lx += est;
    });
    H = ly + 16;
  } else {
    parts.push(
      `<rect x="${barX}" y="${barY + 3}" width="${barW}" height="2" rx="1" fill="${t.hairline}"/>`
    );
    parts.push(
      `<text x="${PAD}" y="${barY + 26}" font-family="${FONT}" font-size="11" fill="${t.muted}">Language mix appears here as public repositories are added.</text>`
    );
    H = barY + 44;
  }

  parts.push('</svg>');
  return parts.join('\n').replace(/__H__/g, String(H)) + '\n';
}

function writeIfChanged(path, content) {
  let prev = null;
  try {
    prev = readFileSync(path, 'utf8');
  } catch {
    /* no previous file */
  }
  const changed = prev !== content;
  if (changed) writeFileSync(path, content);
  return changed;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) fail('GITHUB_TOKEN is not set');

  const account = await queryApi(token);
  const model = aggregate(account);

  const light = renderSvg(model, 'light');
  const dark = renderSvg(model, 'dark');

  const lb = Buffer.byteLength(light, 'utf8');
  const db = Buffer.byteLength(dark, 'utf8');
  if (lb > MAX_BYTES || db > MAX_BYTES) {
    fail('rendered SVG exceeds ' + MAX_BYTES + ' bytes (light ' + lb + ', dark ' + db + ')');
  }

  const c1 = writeIfChanged(OUT_LIGHT, light);
  const c2 = writeIfChanged(OUT_DARK, dark);

  console.log(
    'render-stats: login=' +
      model.login +
      ' contributions=' +
      model.contributions +
      ' publicRepos=' +
      model.repoCount +
      ' languages=' +
      (model.langs.length ? model.langs.map((l) => l.name + ':' + l.pct.toFixed(1) + '%').join(', ') : '(none yet)')
  );
  console.log(
    'render-stats: stats-light.svg ' +
      lb +
      ' bytes (' +
      (c1 ? 'updated' : 'unchanged') +
      '), stats-dark.svg ' +
      db +
      ' bytes (' +
      (c2 ? 'updated' : 'unchanged') +
      ')'
  );
}

main();
