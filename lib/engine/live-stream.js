'use strict';
/**
 * Live remote browser streaming via CDP Page.startScreencast.
 * Feature flag: SOLOHOST_LIVE_MODE=auto|on|off (default auto: available when Playwright session exists).
 * WebSocket path: /api/browser/live?sessionId=&token=
 */
const url = require('url');
const appLog = require('../app-log');

const liveSessions = new Map(); // pwSessionId -> { clients:Set, cdp, quality, lastFrame }

function liveEnabled() {
  const m = String(process.env.SOLOHOST_LIVE_MODE || 'auto').toLowerCase();
  if (m === 'off' || m === '0') return false;
  if (m === 'on' || m === '1') return true;
  return true; // auto
}

function perfQuality() {
  // v11.0.2 — default snappier Live (less bandwidth / decode work)
  const p = String(process.env.SOLOHOST_PERF_PROFILE || 'balanced').toLowerCase();
  if (p === 'low') return { quality: 35, maxWidth: 720, maxHeight: 1100, everyNthFrame: 3 };
  if (p === 'high') return { quality: 65, maxWidth: 1280, maxHeight: 1600, everyNthFrame: 1 };
  // balanced: slightly lower quality + skip frames → feels faster on mobile/Pi
  return { quality: 45, maxWidth: 960, maxHeight: 1280, everyNthFrame: 2 };
}

async function attachCdp(playwrightEngine, pwSessionId) {
  if (!liveEnabled()) return null;
  if (liveSessions.has(pwSessionId)) return liveSessions.get(pwSessionId);
  const page = typeof playwrightEngine.getPage === 'function'
    ? await playwrightEngine.getPage(pwSessionId)
    : null;
  // Fallback: access via evaluate path — need CDP session from page
  let cdp = null;
  try {
    if (page && page.context) {
      cdp = await page.context().newCDPSession(page);
    }
  } catch (e) {
    appLog.log('warn', 'live.cdp_fail', { error: String(e.message || e).slice(0, 120) });
    return null;
  }
  if (!cdp) return null;
  const cfg = perfQuality();
  const entry = { clients: new Set(), cdp, page, quality: cfg, lastFrame: null, pwSessionId };
  liveSessions.set(pwSessionId, entry);

  cdp.on('Page.screencastFrame', async (frame) => {
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch (_) {}
    const buf = Buffer.from(frame.data, 'base64');
    entry.lastFrame = buf;
    const meta = JSON.stringify({
      type: 'meta',
      metadata: frame.metadata || {},
      ts: Date.now()
    });
    for (const ws of entry.clients) {
      try {
        if (ws.readyState === 1) {
          ws.send(meta);
          ws.send(buf);
        }
      } catch (_) {}
    }
  });

  try {
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: cfg.quality,
      maxWidth: cfg.maxWidth,
      maxHeight: cfg.maxHeight,
      everyNthFrame: cfg.everyNthFrame
    });
    appLog.log('info', 'live.screencast_started', { pwSessionId: String(pwSessionId).slice(0, 12) });
  } catch (e) {
    appLog.log('warn', 'live.screencast_start_fail', { error: String(e.message || e).slice(0, 120) });
    liveSessions.delete(pwSessionId);
    return null;
  }
  return entry;
}

async function stopLive(pwSessionId) {
  const entry = liveSessions.get(pwSessionId);
  if (!entry) return;
  try { await entry.cdp.send('Page.stopScreencast'); } catch (_) {}
  try { await entry.cdp.detach(); } catch (_) {}
  for (const ws of entry.clients) {
    try { ws.close(); } catch (_) {}
  }
  liveSessions.delete(pwSessionId);
}

async function handleInput(entry, msg) {
  const cdp = entry.cdp;
  if (!cdp || !msg || !msg.type || typeof msg.type !== 'string') return;
  // Keep the live input bridge bounded and restrict event names to CDP-supported values.
  const boundedText = (value, max) => String(value == null ? '' : value).slice(0, max);
  const coord = (value) => Number.isFinite(Number(value)) ? Math.max(-10000, Math.min(10000, Number(value))) : 0;
  try {
    if (msg.type === 'mouse') {
      const et = ['mousePressed', 'mouseReleased', 'mouseMoved'].includes(msg.eventType) ? msg.eventType : 'mousePressed';
      let buttons = msg.buttons != null ? Number(msg.buttons) : (et === 'mouseMoved' ? 0 : 1);
      if (!Number.isFinite(buttons)) buttons = et === 'mouseMoved' ? 0 : 1;
      await cdp.send('Input.dispatchMouseEvent', {
        type: et,
        x: coord(msg.x),
        y: coord(msg.y),
        button: msg.button || (et === 'mouseMoved' ? 'none' : 'left'),
        buttons,
        clickCount: msg.clickCount || (et === 'mouseMoved' ? 0 : 1),
        modifiers: msg.modifiers || 0
      });
    } else if (msg.type === 'mouseMove') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: coord(msg.x),
        y: coord(msg.y),
        modifiers: msg.modifiers || 0
      });
    } else if (msg.type === 'wheel') {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: coord(msg.x),
        y: coord(msg.y),
        deltaX: coord(msg.deltaX),
        deltaY: coord(msg.deltaY),
        modifiers: msg.modifiers || 0
      });
    } else if (msg.type === 'key') {
      await cdp.send('Input.dispatchKeyEvent', {
        type: ['keyDown', 'keyUp', 'rawKeyDown', 'char'].includes(msg.eventType) ? msg.eventType : 'keyDown',
        text: msg.text ? boundedText(msg.text, 128) : undefined,
        unmodifiedText: msg.text ? boundedText(msg.text, 128) : undefined,
        key: boundedText(msg.key, 64),
        code: boundedText(msg.code, 64),
        windowsVirtualKeyCode: msg.keyCode,
        nativeVirtualKeyCode: msg.keyCode,
        modifiers: msg.modifiers || 0
      });
    } else if (msg.type === 'insertText') {
      await cdp.send('Input.insertText', { text: boundedText(msg.text, 4096) });
    } else if (msg.type === 'touch') {
      await cdp.send('Input.dispatchTouchEvent', {
        type: ['touchStart', 'touchMove', 'touchEnd', 'touchCancel'].includes(msg.eventType) ? msg.eventType : 'touchStart',
        touchPoints: Array.isArray(msg.touchPoints) ? msg.touchPoints.slice(0, 5).map((pt) => ({ x: coord(pt && pt.x), y: coord(pt && pt.y) })) : [{ x: coord(msg.x), y: coord(msg.y) }]
      });
    }
  } catch (e) {
    appLog.log('warn', 'live.input_fail', { error: String(e.message || e).slice(0, 100) });
  }
}

/**
 * Attach WebSocket upgrade handler to HTTP server.
 * Expected query: sessionId (pw or bridge id), token, bridgeSession optional.
 */
function attachToServer(server, deps) {
  if (!liveEnabled()) return;
  const domBridge = deps.domBridge;
  const playwrightEngine = deps.playwrightEngine;

  // Provide getPage on playwright engine if missing
  if (playwrightEngine && !playwrightEngine.getPage) {
    playwrightEngine.getPage = async function getPage(id) {
      const s = playwrightEngine._sessions && playwrightEngine._sessions.get
        ? playwrightEngine._sessions.get(id)
        : null;
      // internal sessions map is not exported — use evaluate bridge via CDP from module state
      return null;
    };
  }

  server.on('upgrade', async (req, socket, head) => {
    try {
      const u = url.parse(req.url, true);
      if (!u.pathname || !u.pathname.includes('/api/browser/live')) {
        return; // not our path — leave for other handlers
      }
      const sessionId = String(u.query.sessionId || '');
      const token = String(u.query.token || '');
      const session = domBridge && domBridge.authSession(sessionId, token);
      if (!session || !session.pwSessionId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      // Minimal WebSocket handshake without 'ws' package
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }
      const crypto = require('crypto');
      const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
          accept +
          '\r\n\r\n'
      );

      const fakeWs = {
        readyState: 1,
        socket,
        send(data) {
          try {
            if (Buffer.isBuffer(data)) {
              // binary frame
              const len = data.length;
              let header;
              if (len < 126) {
                header = Buffer.alloc(2);
                header[0] = 0x82;
                header[1] = len;
              } else if (len < 65536) {
                header = Buffer.alloc(4);
                header[0] = 0x82;
                header[1] = 126;
                header.writeUInt16BE(len, 2);
              } else {
                header = Buffer.alloc(10);
                header[0] = 0x82;
                header[1] = 127;
                header.writeUInt32BE(0, 2);
                header.writeUInt32BE(len, 6);
              }
              socket.write(Buffer.concat([header, data]));
            } else {
              const payload = Buffer.from(String(data));
              const len = payload.length;
              let header;
              if (len < 126) {
                header = Buffer.alloc(2);
                header[0] = 0x81;
                header[1] = len;
              } else {
                header = Buffer.alloc(4);
                header[0] = 0x81;
                header[1] = 126;
                header.writeUInt16BE(len, 2);
              }
              socket.write(Buffer.concat([header, payload]));
            }
          } catch (_) {}
        },
        close() {
          try { socket.end(); } catch (_) {}
          this.readyState = 3;
        }
      };

      // Need CDP page from playwright — use session.pwSessionId with internal API
      let entry = liveSessions.get(session.pwSessionId);
      if (!entry) {
        // Try create CDP via playwright connection
        try {
          const pe = require('./playwright-engine');
          // Access session page through navigate evaluate side-channel
          const engineSession = typeof pe.getSession === 'function' ? pe.getSession(session.pwSessionId) : null;
          const pageHolder = { page: engineSession && engineSession.page ? engineSession.page : null };
          if (!pageHolder.page) {
            fakeWs.send(JSON.stringify({ type: 'error', error: 'live_page_unavailable' }));
            appLog.log('warn', 'live.no_page', { id: session.pwSessionId });
          } else {
            const cdp = await pageHolder.page.context().newCDPSession(pageHolder.page);
            entry = {
              clients: new Set(),
              cdp,
              page: pageHolder.page,
              quality: perfQuality(),
              lastFrame: null,
              pwSessionId: session.pwSessionId
            };
            liveSessions.set(session.pwSessionId, entry);
            const cfg = entry.quality;
            cdp.on('Page.screencastFrame', async (frame) => {
              try { await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch (_) {}
              const buf = Buffer.from(frame.data, 'base64');
              entry.lastFrame = buf;
              const meta = JSON.stringify({ type: 'frameMeta', metadata: frame.metadata || {}, ts: Date.now() });
              for (const ws of entry.clients) {
                try {
                  if (ws.readyState === 1) {
                    ws.send(meta);
                    ws.send(buf);
                  }
                } catch (_) {}
              }
            });
            await cdp.send('Page.startScreencast', {
              format: 'jpeg',
              quality: cfg.quality,
              maxWidth: cfg.maxWidth,
              maxHeight: cfg.maxHeight,
              everyNthFrame: cfg.everyNthFrame
            });
          }
        } catch (e) {
          appLog.log('warn', 'live.attach_fail', { error: String(e.message || e).slice(0, 160) });
          fakeWs.send(JSON.stringify({ type: 'error', error: 'live_attach_failed' }));
        }
      }

      if (entry) {
        entry.clients.add(fakeWs);
        if (entry.lastFrame) {
          try { fakeWs.send(entry.lastFrame); } catch (_) {}
        }
        fakeWs.send(JSON.stringify({ type: 'hello', mode: 'live', url: session.url || '' }));
      }

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        // Very small client messages expected as text frames
        while (buf.length >= 2) {
          const finOpcode = buf[0];
          const opcode = finOpcode & 0x0f;
          const mask = (buf[1] & 0x80) !== 0;
          let len = buf[1] & 0x7f;
          let offset = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            return; // ignore huge
          }
          const maskLen = mask ? 4 : 0;
          if (buf.length < offset + maskLen + len) return;
          let payload = buf.slice(offset + maskLen, offset + maskLen + len);
          if (mask) {
            const m = buf.slice(offset, offset + 4);
            for (let i = 0; i < payload.length; i++) payload[i] ^= m[i % 4];
          }
          buf = buf.slice(offset + maskLen + len);
          if (opcode === 0x8) {
            if (entry) entry.clients.delete(fakeWs);
            try { socket.end(); } catch (_) {}
            return;
          }
          if (opcode === 0x1) {
            try {
              const msg = JSON.parse(payload.toString('utf8'));
              if (entry) handleInput(entry, msg);
            } catch (_) {}
          }
        }
      });
      socket.on('close', () => {
        if (entry) entry.clients.delete(fakeWs);
        fakeWs.readyState = 3;
      });
    } catch (e) {
      try { socket.destroy(); } catch (_) {}
    }
  });
}

module.exports = {
  liveEnabled,
  attachToServer,
  attachCdp,
  stopLive,
  handleInput,
  liveSessions
};
