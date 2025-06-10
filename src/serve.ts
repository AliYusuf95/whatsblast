console.time('Server startup');

import { serve, type Server } from 'bun';
import index from '@/index.html';
import { trpcHandler } from '@/server';
import { whatsappConnectionManager } from '@/server/services';
import { bunHandler as authBunHandler } from './server/auth/config';
import { runMigrations } from './server/db/config';
import { workersManager } from './server/workers/workers-manager';

const server = serve({
  hostname: '0.0.0.0', // Bind to all interfaces
  idleTimeout: 50,
  routes: {
    // Serve index.html for all unmatched routes.
    '/*': index,

    '/health': new Response('OK'),
    '/api/auth/*': authBunHandler,

    '/trpc/*': async (request: Request, server: Server) => {
      return trpcHandler(request, server) ?? new Response('Not found', { status: 404 });
    },
  },

  development: process.env.NODE_ENV !== 'production' && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

// Handle process signals
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  await server.stop();
  await whatsappConnectionManager.removeAllConnections();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  await server.stop();
  await whatsappConnectionManager.removeAllConnections();
  process.exit(0);
});

console.timeEnd('Server startup');
console.log(`🚀 Server running at ${server.url}`);
console.log(
  'Server configuration:',
  JSON.stringify({
    hostname: server.hostname,
    port: server.port,
    development: process.env.NODE_ENV !== 'production',
  }),
);

runMigrations().catch((error) => {
  console.error('Error running database migrations:', error);
  process.exit(1);
});

// start queue workers
workersManager
  .initialize()
  .catch((error) => {
    console.error('Error initializing workers:', error);
    process.exit(1);
  })
  .then(() => {
    console.log('✅ Workers initialized successfully');
  });
