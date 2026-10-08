import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const REMOTE_API_TARGET = process.env.OPEN_COUNTER_API || 'https://open-counter.opencounter.workers.dev';

app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Forward all /api/* and /mcp/* calls directly to the real Open Counter backend
const proxyHandler: express.RequestHandler = async (req, res) => {
  const targetUrl = `${REMOTE_API_TARGET}${req.originalUrl}`;

  try {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (
        key !== 'host' &&
        key !== 'connection' &&
        key !== 'origin' &&
        key !== 'referer' &&
        typeof value === 'string'
      ) {
        headers[key] = value;
      }
    }

    // Default MCP streaming headers if not set
    if (!headers['accept']) {
      headers['accept'] = 'application/json, text/event-stream';
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
      fetchOptions.body = req.body as any;
    }

    const remoteRes = await fetch(targetUrl, fetchOptions);

    res.status(remoteRes.status);
    remoteRes.headers.forEach((val, key) => {
      if (key !== 'content-encoding' && key !== 'transfer-encoding') {
        res.setHeader(key, val);
      }
    });

    const bodyBuffer = await remoteRes.arrayBuffer();
    res.send(Buffer.from(bodyBuffer));
  } catch (err: any) {
    console.error(`Proxy error calling ${targetUrl}:`, err);
    res.status(502).json({
      error: 'unreachable',
      message: `Failed to connect to real Open Counter API at ${REMOTE_API_TARGET}. ${err.message}`,
    });
  }
};

app.use('/api', proxyHandler);
app.use('/mcp', proxyHandler);

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Open Counter full-stack gateway running on port ${PORT} -> ${REMOTE_API_TARGET}`);
  });
}

startServer();
