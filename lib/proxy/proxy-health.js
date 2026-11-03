'use strict';
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { redactErrorMessage } = require('./proxy-config');

const IP_ENDPOINTS = [
  { url: 'https://api.ipify.org?format=json', parse: (b) => { try { return JSON.parse(b).ip; } catch { return null; } } },
  { url: 'https://ifconfig.me/ip', parse: (b) => String(b).trim().split(/\s/)[0] },
  { url: 'https://ipinfo.io/json', parse: (b) => { try { return JSON.parse(b).ip; } catch { return null; } } }
];
const DEFAULT_TIMEOUT_MS = Math.max(3000, Number(process.env.SOLOHOST_PROXY_TEST_TIMEOUT_MS) || 12000);

function withTimeout(ms, fn) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { const err = new Error('Connection timed out'); err.code = 'TIMEOUT'; reject(err); }, ms);
    Promise.resolve().then(fn).then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
  });
}

function fetchDirect(url, timeoutMs) {
  return withTimeout(timeoutMs || DEFAULT_TIMEOUT_MS, () => new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'application/json,text/plain' } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  }));
}

async function resolvePublicIpDirect(timeoutMs) {
  for (const ep of IP_ENDPOINTS) {
    try {
      const body = await fetchDirect(ep.url, timeoutMs);
      const ip = ep.parse(body);
      if (ip && /^[\d.:a-fA-F]+$/.test(ip)) return { ip, source: ep.url };
    } catch (_) {}
  }
  return { ip: null, source: null };
}

function httpProxyRequest(entry, targetUrl, timeoutMs) {
  return withTimeout(timeoutMs || DEFAULT_TIMEOUT_MS, () => new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const destPort = u.port || (u.protocol === 'https:' ? 443 : 80);
    const connectReq = 'CONNECT ' + u.hostname + ':' + destPort + ' HTTP/1.1\r\nHost: ' + u.hostname + ':' + destPort + '\r\n' +
      (entry.username ? 'Proxy-Authorization: Basic ' + Buffer.from(entry.username + ':' + (entry.password || ''), 'utf8').toString('base64') + '\r\n' : '') +
      'Connection: keep-alive\r\n\r\n';
    const socket = net.connect({ host: entry.host, port: entry.port }, () => socket.write(connectReq));
    let buf = Buffer.alloc(0); let headerDone = false;
    socket.on('data', chunk => {
      if (headerDone) return;
      buf = Buffer.concat([buf, chunk]);
      const s = buf.toString('utf8');
      const idx = s.indexOf('\r\n\r\n');
      if (idx < 0) return;
      headerDone = true;
      const statusLine = s.slice(0, s.indexOf('\r\n'));
      if (/ 407 /.test(statusLine)) { const err = new Error('Proxy authentication failed'); err.code = 'AUTHENTICATION_FAILED'; socket.destroy(); return reject(err); }
      if (!/ 200 /.test(statusLine)) { const err = new Error('Proxy CONNECT failed: ' + statusLine.slice(0, 80)); err.code = 'CONNECTION_FAILED'; socket.destroy(); return reject(err); }
      const rest = buf.slice(idx + 4);
      const tlsSock = tls.connect({ socket, servername: u.hostname, ALPNProtocols: ['http/1.1'] }, () => {
        const path = u.pathname + (u.search || '');
        tlsSock.write('GET ' + path + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\nAccept: application/json,text/plain\r\nConnection: close\r\n\r\n');
      });
      let bodyBuf = rest;
      tlsSock.on('data', c => { bodyBuf = Buffer.concat([bodyBuf, c]); });
      tlsSock.on('end', () => { const text = bodyBuf.toString('utf8'); const bodyIdx = text.indexOf('\r\n\r\n'); resolve(bodyIdx >= 0 ? text.slice(bodyIdx + 4) : text); });
      tlsSock.on('error', reject);
    });
    socket.on('error', e => { const err = new Error(redactErrorMessage(e.message)); err.code = e.code === 'ECONNREFUSED' ? 'PROXY_UNAVAILABLE' : 'CONNECTION_FAILED'; reject(err); });
  }));
}

function socks5ProxyRequest(entry, targetUrl, timeoutMs) {
  return withTimeout(timeoutMs || DEFAULT_TIMEOUT_MS, () => new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const destPort = Number(u.port || 443);
    const socket = net.connect({ host: entry.host, port: entry.port }, () => {
      socket.write(entry.username ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });
    let step = 'greet'; let buf = Buffer.alloc(0);
    const fail = (msg, code) => { const err = new Error(msg); err.code = code || 'CONNECTION_FAILED'; socket.destroy(); reject(err); };
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (step === 'greet') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return fail('Invalid SOCKS5 response', 'CONNECTION_FAILED');
        const method = buf[1]; buf = buf.slice(2);
        if (method === 0x02) {
          step = 'auth';
          const user = Buffer.from(entry.username || '', 'utf8');
          const pass = Buffer.from(entry.password || '', 'utf8');
          const auth = Buffer.alloc(3 + user.length + pass.length);
          auth[0] = 0x01; auth[1] = user.length; user.copy(auth, 2); auth[2 + user.length] = pass.length; pass.copy(auth, 3 + user.length);
          socket.write(auth); return;
        }
        if (method === 0x00) step = 'connect';
        else if (method === 0xff) return fail('SOCKS5 authentication required/failed', 'AUTHENTICATION_FAILED');
        else return fail('SOCKS5 method not accepted', 'CONNECTION_FAILED');
      }
      if (step === 'auth') {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return fail('SOCKS5 authentication failed', 'AUTHENTICATION_FAILED');
        buf = buf.slice(2); step = 'connect';
      }
      if (step === 'connect') {
        const hostBuf = Buffer.from(u.hostname, 'utf8');
        const req = Buffer.alloc(7 + hostBuf.length);
        req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03; req[4] = hostBuf.length;
        hostBuf.copy(req, 5); req.writeUInt16BE(destPort, 5 + hostBuf.length);
        socket.write(req); step = 'conn_reply'; return;
      }
      if (step === 'conn_reply') {
        if (buf.length < 5) return;
        if (buf[1] !== 0x00) return fail('SOCKS5 connect failed code=' + buf[1], 'CONNECTION_FAILED');
        let offset = 3; const atyp = buf[3];
        if (atyp === 0x01) offset += 4; else if (atyp === 0x03) offset += 1 + buf[4]; else if (atyp === 0x04) offset += 16;
        offset += 2; if (buf.length < offset) return; buf = buf.slice(offset); step = 'http';
        const tlsSock = tls.connect({ socket, servername: u.hostname }, () => {
          const path = u.pathname + (u.search || '');
          tlsSock.write('GET ' + path + ' HTTP/1.1\r\nHost: ' + u.hostname + '\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36\r\nConnection: close\r\n\r\n');
        });
        let body = Buffer.alloc(0);
        tlsSock.on('data', c => { body = Buffer.concat([body, c]); });
        tlsSock.on('end', () => { const text = body.toString('utf8'); const i = text.indexOf('\r\n\r\n'); resolve(i >= 0 ? text.slice(i + 4) : text); });
        tlsSock.on('error', reject);
      }
    });
    socket.on('error', e => { const err = new Error(redactErrorMessage(e.message)); err.code = e.code === 'ECONNREFUSED' ? 'PROXY_UNAVAILABLE' : 'CONNECTION_FAILED'; reject(err); });
  }));
}

async function fetchViaProxy(entry, timeoutMs) {
  const protocol = entry.protocol === 'socks5' ? 'socks5' : 'http';
  let lastErr;
  for (const ep of IP_ENDPOINTS) {
    try {
      const body = protocol === 'socks5' ? await socks5ProxyRequest(entry, ep.url, timeoutMs) : await httpProxyRequest(entry, ep.url, timeoutMs);
      const ip = ep.parse(body);
      if (ip && /^[\d.:a-fA-F]+$/.test(ip)) return { ip, source: ep.url };
    } catch (e) {
      lastErr = e;
      if (e.code === 'AUTHENTICATION_FAILED' || e.code === 'TIMEOUT') throw e;
    }
  }
  if (lastErr) throw lastErr;
  const err = new Error('Could not read public IP through proxy'); err.code = 'CONNECTION_FAILED'; throw err;
}

async function runHealthCheck(entry, opts = {}) {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const result = { ok: false, latencyMs: null, publicIp: null, directIp: null, source: null, errorCode: null, message: null };
  try {
    if (opts.skipDirect !== true) {
      try { const d = await resolvePublicIpDirect(Math.min(8000, timeoutMs)); result.directIp = d.ip; } catch (_) {}
    }
    const via = await fetchViaProxy(entry, timeoutMs);
    result.publicIp = via.ip; result.source = via.source; result.latencyMs = Date.now() - started; result.ok = true;
    return result;
  } catch (e) {
    result.latencyMs = Date.now() - started; result.errorCode = e.code || 'CONNECTION_FAILED'; result.message = redactErrorMessage(e.message);
    return result;
  }
}

module.exports = { IP_ENDPOINTS, DEFAULT_TIMEOUT_MS, resolvePublicIpDirect, fetchViaProxy, runHealthCheck, httpProxyRequest, socks5ProxyRequest };
