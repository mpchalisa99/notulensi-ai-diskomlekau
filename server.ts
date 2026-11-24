import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import summarizeHandler from './api/summarize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.post('/api/summarize', summarizeHandler);

app.all('/api/*', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({
    error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err) {
    res.setHeader('Content-Type', 'application/json');
    res.status(400).json({
      error:
        err?.type === 'entity.too.large'
          ? 'Ukuran data terlalu besar untuk dikirim sekaligus.'
          : err?.message || 'Permintaan tidak valid.',
    });
    return;
  }
  next();
});

async function startServer() {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (req.path === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AEGIS-BRIEF DISKOMLEKAU Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
