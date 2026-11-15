import { createServer } from 'node:http';

createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
}).listen(9100, '0.0.0.0');
