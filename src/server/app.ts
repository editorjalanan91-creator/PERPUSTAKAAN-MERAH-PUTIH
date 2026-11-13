import express, { Request, Response } from 'express';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Health and status endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'PERPUSTAKAAN MERAH PUTIH',
      database: 'Supabase PostgreSQL',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
