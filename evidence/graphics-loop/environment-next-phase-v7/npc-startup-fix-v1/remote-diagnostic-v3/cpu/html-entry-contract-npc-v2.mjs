import path from 'node:path';

function safeOutputPath(value) {
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`Unsafe compiled HTML entry path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === '.' || normalized !== value) throw new Error(`Non-canonical compiled HTML entry path: ${value}`);
  return normalized;
}

export function moduleScriptSources(html) {
  const sources = [];
  const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let match; (match = scriptTag.exec(html));) {
    const attrs = match[1];
    const type = /\btype=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (type !== 'module') continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1];
    sources.push(src ?? null);
  }
  return sources;
}

/** Require the real HTML module URL to resolve to the exact emitted entry record. */
export function validateHtmlEntry(html, entryOutput, outputs) {
  const expected = safeOutputPath(entryOutput);
  const sources = moduleScriptSources(html);
  if (sources.length !== 1 || typeof sources[0] !== 'string') {
    throw new Error(`Expected exactly one external module entry in HTML; found ${sources.length}`);
  }
  const src = sources[0];
  if (!src.startsWith('./') || src.includes('?') || src.includes('#')) throw new Error(`HTML module entry must be a plain package-relative URL: ${src}`);
  const resolved = safeOutputPath(path.posix.normalize(src.slice(2)));
  if (resolved !== expected) throw new Error(`HTML requests ${resolved}, but compiler emitted entry ${expected}`);
  const output = outputs.find(item => (typeof item === 'string' ? item : item?.path) === expected);
  if (!output || (typeof output !== 'string' && (!Number.isSafeInteger(output.bytes) || output.bytes < 1
    || !/^[a-f0-9]{64}$/.test(output.sha256)))) {
    throw new Error(`Exact HTML entry is absent from hashed compiled outputs: ${expected}`);
  }
  return { entryOutput: expected, htmlSource: src, output: typeof output === 'string' ? { path: output } : output };
}

/** Rewrite only the exact authoring entry tag, then validate against the actual output records. */
export function rewriteHtmlEntry(html, authoringTag, importMap, entryOutput, outputs) {
  if (html.split(authoringTag).length !== 2) throw new Error('Reviewed authoring HTML entry tag changed');
  const target = `./${safeOutputPath(entryOutput)}`;
  const rewritten = html.replace(authoringTag,
    `<script type="importmap">${JSON.stringify(importMap)}</script>\n  <script type="module" src="${target}"></script>`);
  validateHtmlEntry(rewritten, entryOutput, outputs);
  return rewritten;
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedObject(value[key])]));
  return value;
}

/** Validate the emitted HTML entry and every import-map target against hashed outputs. */
export function validateHtmlPackage(html, packageRecord, outputs) {
  if (!packageRecord || typeof packageRecord !== 'object' || !packageRecord.importMap || typeof packageRecord.importMap !== 'object') {
    throw new Error('Compiled package import-map record is missing');
  }
  const importMapScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => /\btype=[\"']importmap[\"']/i.test(attrs));
  if (importMapScripts.length !== 1) throw new Error(`Expected exactly one import map in HTML; found ${importMapScripts.length}`);
  let imports;
  try { imports = JSON.parse(importMapScripts[0][2]).imports; }
  catch { throw new Error('HTML import map is invalid JSON'); }
  const expectedImports = packageRecord.importMap.imports ?? packageRecord.importMap;
  if (JSON.stringify(sortedObject(imports)) !== JSON.stringify(sortedObject(expectedImports))) {
    throw new Error('HTML import map differs from compiled package record');
  }
  for (const [specifier, target] of Object.entries(imports ?? {})) {
    if (typeof target !== 'string' || !target.startsWith('./') || target.includes('?') || target.includes('#')) {
      throw new Error(`Unsafe import-map target for ${specifier}: ${target}`);
    }
    const targetPath = safeOutputPath(target.slice(2));
    const row = outputs.find(item => (typeof item === 'string' ? item : item?.path) === targetPath);
    if (!row || (typeof row !== 'string' && (!Number.isSafeInteger(row.bytes) || row.bytes < 1 || !/^[a-f0-9]{64}$/.test(row.sha256)))) {
      throw new Error(`Import-map target is absent from hashed compiled outputs: ${specifier} -> ${targetPath}`);
    }
  }
  if (typeof packageRecord.entryOutput !== 'string' || packageRecord.htmlEntry !== `./${packageRecord.entryOutput}`) {
    throw new Error('Compiled package entry receipt is inconsistent');
  }
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (!/\brel=["']stylesheet["']/i.test(attrs)) continue;
    const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href || !href.startsWith('./') || href.includes('?') || href.includes('#')) throw new Error(`Unsafe stylesheet URL: ${href}`);
    const targetPath = safeOutputPath(href.slice(2));
    const row = outputs.find(item => item?.path === targetPath);
    if (!row || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(`Stylesheet absent from hashed outputs: ${targetPath}`);
  }
  return { ...validateHtmlEntry(html, packageRecord.entryOutput, outputs), importMap: imports };
}
