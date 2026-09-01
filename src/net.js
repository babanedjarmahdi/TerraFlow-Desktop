import http from 'http';
import net from 'net';

export function portOpen(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export function getJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ ok: true, status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ ok: false, status: res.statusCode, data: null });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ok: false, status: 0, data: null }));
  });
}

export async function isTerraflowHealthy(baseUrl) {
  const r = await getJson(`${baseUrl}/api/health`);
  return r.ok && r.status === 200 && r.data && r.data.status === 'ok';
}

export function waitFor(probe, { timeoutMs = 30000, stepMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return (async function loop() {
    if (await probe()) return true;
    if (Date.now() >= deadline) return false;
    await wait(stepMs);
    return loop();
  })();
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}