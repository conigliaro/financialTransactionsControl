import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import en from '../i18n/en.js';
import es from '../i18n/es.js';
import ptBR from '../i18n/pt-BR.js';

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function extractTKeys(source) {
  const keys = new Set();
  const re = /\bt\(\s*['"`]([^'"`]+)['"`]\s*(?:,|\))/g;
  let m;
  while ((m = re.exec(source))) {
    keys.add(m[1]);
  }
  return keys;
}

describe('i18n dictionaries', () => {
  it('contain all statically-referenced t("...") keys', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const files = [
      path.join(repoRoot, 'financie-app.js'),
      ...listJsFiles(path.join(repoRoot, 'components')),
      ...listJsFiles(path.join(repoRoot, 'host')),
      ...listJsFiles(path.join(repoRoot, 'sync')),
    ].filter((p) => fs.existsSync(p));

    const usedKeys = new Set();
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const k of extractTKeys(src)) usedKeys.add(k);
    }

    const dicts = { en, es, 'pt-BR': ptBR };
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const key of usedKeys) {
        expect(dict, `${lang} missing key: ${key}`).toHaveProperty(key);
      }
    }
  });
});

