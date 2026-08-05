// Copies the single-file build artifact from dist/index.html to the repo
// root, where GitHub Pages (branch mode, root folder) serves it. Fails the
// build if the artifact is not self-contained or still carries the old
// product name.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = resolve(root, 'dist/index.html');
const target = resolve(root, 'index.html');

const html = readFileSync(artifact, 'utf8');

const externalScripts = html.match(/<script[^>]+src=["']http/gi) ?? [];
if (externalScripts.length > 0) {
  console.error('postbuild: artifact references external scripts:', externalScripts);
  process.exit(1);
}

// Fonts load from Google Fonts at runtime; every script and style must be inline.
const externalModules = html.match(/<script[^>]+src=/gi) ?? [];
if (externalModules.length > 0) {
  console.error('postbuild: artifact has non-inlined scripts:', externalModules);
  process.exit(1);
}

// Stylesheets, preloads, and modulepreloads must be inlined too; only the
// data-URI favicon may remain as a link href.
const externalLinks = html.match(/<link[^>]+href=["'](?!data:)/gi) ?? [];
if (externalLinks.length > 0) {
  console.error('postbuild: artifact references external link hrefs:', externalLinks);
  process.exit(1);
}

// The pattern is assembled from parts so the guard itself never trips a
// repo-wide search for the old product name.
const oldBrand = html.match(new RegExp(['pa', 'pele'].join(''), 'gi')) ?? [];
if (oldBrand.length > 0) {
  console.error(`postbuild: artifact still contains the old product name (${oldBrand.length} occurrences)`);
  process.exit(1);
}

writeFileSync(target, html);
console.log(`postbuild: wrote index.html (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
