/**
 * Web Dashboard Server
 *
 * Express server that serves the web dashboard and API endpoints.
 */

import express from 'express';
import * as path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';
import { registerApiRoutes } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3847;

/**
 * Find an available port starting from the default
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.on('error', () => {
      // Port in use, try next
      resolve(findAvailablePort(startPort + 1));
    });

    server.listen(startPort, () => {
      server.close(() => {
        resolve(startPort);
      });
    });
  });
}

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');
  const platform = process.platform;

  let command: string;
  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command);
}

export interface ServerOptions {
  port?: number;
  openBrowser?: boolean;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Start the web dashboard server
 */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const app = express();

  // Parse JSON bodies
  app.use(express.json());

  // Serve static files
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  // Register API routes
  registerApiRoutes(app);

  // Serve index.html for root
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Find available port
  const port = await findAvailablePort(options.port || DEFAULT_PORT);

  // Start server
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;

      if (options.openBrowser !== false) {
        openBrowser(url);
      }

      resolve({
        port,
        url,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
