import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const hashed = /-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ico)$/;
const denied = /(?:^|\/)(?:server\.(?:cjs|js)(?:\.map)?|kentro-edge)(?:\.(?:br|gz))?$/i;

export function encodingQuality(header: string, encoding: string): number {
  const values = new Map<string, number>();
  for (const entry of header.toLowerCase().split(',')) {
    const [name, ...parameters] = entry.trim().split(';');
    if (!name) continue;
    const parameter = parameters.find(value => /^\s*q\s*=/.test(value));
    const q = parameter ? Number(parameter.split('=')[1].trim()) : 1;
    values.set(name.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0);
  }
  if (values.has(encoding)) return values.get(encoding)!;
  if (encoding === 'identity') return values.get('*') === 0 ? 0 : header.trim() ? 0.001 : 1;
  return values.get('*') ?? 0;
}

export function mountProductionStatic(app: Express, directory: string): void {
  const root = path.resolve(directory);
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    let uri: string;
    try { uri = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
    if (uri.includes('\0') || uri.split('/').some(part => part.startsWith('.')) || denied.test(uri) || /\.(?:cjs|map|br|gz)$/i.test(uri)) return res.sendStatus(404);
    if (uri === '/api' || uri.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint not found' });
    const candidate = path.resolve(root, '.' + uri);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) return res.sendStatus(404);
    let file = candidate;
    try { if (!fs.statSync(file).isFile()) file = ''; } catch { file = ''; }
    if (!file) {
      if (path.extname(uri)) return res.sendStatus(404);
      file = path.join(root, 'index.html');
    }
    // Distribution contents may grow; serve only supported public formats.
    if (!/\.(?:html|js|css|json|svg|png|jpg|jpeg|webp|woff2?|ico|txt|wasm)$/i.test(file)) return res.sendStatus(404);
    res.vary('Accept-Encoding');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', uri.startsWith('/assets/') && hashed.test(path.basename(file)) ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate');
    const header = String(req.headers['accept-encoding'] || '');
    const options = [
      { coding: 'br', suffix: '.br' }, { coding: 'gzip', suffix: '.gz' }, { coding: 'identity', suffix: '' },
    ].map(option => ({ ...option, q: encodingQuality(header, option.coding) }))
      .filter(option => option.q > 0 && fs.existsSync(file + option.suffix))
      .sort((a, b) => b.q - a.q);
    if (!options.length) return res.sendStatus(406);
    const selected = options[0];
    if (selected.coding !== 'identity') res.setHeader('Content-Encoding', selected.coding);
    res.type(path.extname(file));
    res.sendFile(file + selected.suffix, { dotfiles: 'deny' }, error => { if (error) next(error); });
  });
}
