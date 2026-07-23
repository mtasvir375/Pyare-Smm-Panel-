import app, { startServer } from '../server';

let initPromise: Promise<void> | null = null;

export default async function handler(req: any, res: any) {
  if (!initPromise) {
    initPromise = startServer();
  }
  await initPromise;
  return app(req, res);
}
