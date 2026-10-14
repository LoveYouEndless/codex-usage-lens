import { createServer } from 'node:http';
import { fixtureHTML, sample } from './fixture.mjs';
import { installLens } from '../src/ui.mjs';

const server = createServer(async (request, response) => {
  if (request.url !== '/') { response.writeHead(404).end(); return; }
  const html = fixtureHTML({ language: 'zh-CN' });
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html.replace('</body>', `<script>(${installLens.toString()})(${JSON.stringify(sample)});</script></body>`));
});
server.listen(0, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${server.address().port}/`));
