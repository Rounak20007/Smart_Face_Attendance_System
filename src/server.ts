import type { ViteDevServer } from 'vite';

// For development, we'll create a Vite dev server
// For production, this will be replaced by the built server entry
export async function createViteServer(): Promise<ViteDevServer | null> {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const vite = await import('vite');
  return await vite.createServer({
    root: process.cwd(),
    server: {
      middlewareMode: true
    }
  });
}

// This is the entry point that TanStack Start will call
export default async function createServer() {
  const viteServer = await createViteServer();
  return viteServer?.middlewares ?? (() => {});
}
