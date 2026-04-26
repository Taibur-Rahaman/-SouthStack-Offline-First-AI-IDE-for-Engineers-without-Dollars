import { createServer } from 'node:http';

const port = Number(process.env.IMAGE_UI_API_PORT ?? 8788);
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'image-to-ui-api-stub' }));
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`[image-to-ui stub] http://127.0.0.1:${port}/health`);
});
