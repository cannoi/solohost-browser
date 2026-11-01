'use strict';
const net = require('net');
const dns = require('dns').promises;
const { PROTOCOLS } = require('./proxy-config');

function isPrivateIp(ip) {
  if (!ip || !net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}
function allowPrivateProxy() {
  const v = String(process.env.SOLOHOST_ALLOW_PRIVATE_PROXY || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
async function validateProxyHost(host, opts = {}) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) { const e = new Error('Proxy host required'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  if (/[\s\/?#]/.test(h) || h.includes('://')) { const e = new Error('Proxy host must be a hostname or IP only'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  if (h === 'metadata.google.internal' || h === 'metadata' || h.endsWith('.internal') || h === 'kubernetes.default' || h === 'kubernetes.default.svc') {
    const e = new Error('Proxy host not allowed'); e.code = 'INVALID_CONFIGURATION'; throw e;
  }
  let ips = [];
  if (net.isIP(h)) ips = [h];
  else {
    try {
      const results = await dns.lookup(h, { all: true, verbatim: true });
      ips = (results || []).map(r => r.address).filter(Boolean);
    } catch (err) {
      const e = new Error('Proxy host DNS resolution failed'); e.code = 'PROXY_UNAVAILABLE'; throw e;
    }
    if (!ips.length) { const e = new Error('Proxy host has no addresses'); e.code = 'PROXY_UNAVAILABLE'; throw e; }
  }
  const privateHit = ips.some(ip => isPrivateIp(ip) || isLoopbackHost(ip));
  if (privateHit && !allowPrivateProxy() && !opts.allowPrivate) {
    const e = new Error('Private/local proxy requires SOLOHOST_ALLOW_PRIVATE_PROXY=1'); e.code = 'INVALID_CONFIGURATION'; throw e;
  }
  return { host: h, ips, private: privateHit };
}
function validateProtocol(protocol) {
  const p = String(protocol || '').toLowerCase();
  if (!PROTOCOLS.includes(p)) { const e = new Error('Protocol must be http, https, or socks5'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  return p;
}
function validatePort(port) {
  const n = Number(port);
  if (!Number.isFinite(n) || n < 1 || n > 65535) { const e = new Error('Invalid proxy port'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  return n;
}
module.exports = { isPrivateIp, isLoopbackHost, allowPrivateProxy, validateProxyHost, validateProtocol, validatePort };
