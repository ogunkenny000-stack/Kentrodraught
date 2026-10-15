import express, { type Express, type ErrorRequestHandler, type Request } from 'express';

/** Large puzzle imports are allowed only after authorization. Ordinary API
 * requests never need to buffer the import endpoint's 50 MB allowance. */
export function installBodyParsing(app: Express, mayImport: (req: Request) => Promise<boolean>): void {
  const largeJson = express.json({ limit: '50mb' });
  app.use(['/api/admin/puzzles/bulk', '/api/admin/puzzles/sql-file'], async (req, res, next) => {
    if (req.method !== 'POST') return next();
    try {
      if (!await mayImport(req)) return res.status(403).json({ error: 'Not authorized' });
      largeJson(req, res, next);
    } catch (error) { next(error); }
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: false }));
  const parsingErrors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request body.' });
    next(error);
  };
  app.use(parsingErrors);
}
