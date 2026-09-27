import http from 'http';
import net from 'net';

const MAX_BODY_BYTES = 1024 * 1024;

export function portOpen(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const sock = net.connect({ port, host });
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export function getJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      let overflow = false;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (overflow) return;
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          overflow = true;
          finish({ ok: false, status: res.statusCode, data: null });
          req.destroy();
        }
      });
      res.on('error', () => finish({ ok: false, status: res.statusCode || 0, data: null }));
      res.on('end', () => {
        if (overflow) return;
        try {
          finish({ ok: true, status: res.statusCode, data: JSON.parse(body) });
        } catch {
          finish({ ok: false, status: res.statusCode, data: null });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => finish({ ok: false, status: 0, data: null }));
  });
}

export async function isTerraflowHealthy(baseUrl) {
  const r = await getJson(`${baseUrl}/api/health`);
  return Boolean(r.ok && r.status === 200 && r.data && r.data.status === 'ok');
}

export async function waitFor(probe, { timeoutMs = 30000, stepMs = 1000, abort } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (await probe()) return true;
    if (abort && abort()) return false;
    if (Date.now() >= deadline) return false;
    await wait(stepMs);
  }
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
