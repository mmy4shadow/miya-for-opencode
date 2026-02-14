import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (error) => {
      reject(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('gateway_test_port_allocation_failed'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function createGatewayAcceptanceProjectDir(): Promise<string> {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miya-gateway-acceptance-'));
  const runtimeDir = path.join(projectDir, '.opencode', 'miya');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const port = await allocateFreePort();
  fs.writeFileSync(
    path.join(runtimeDir, 'config.json'),
    `${JSON.stringify({ gateway: { bindHost: '127.0.0.1', port } }, null, 2)}\n`,
    'utf-8',
  );
  return projectDir;
}
