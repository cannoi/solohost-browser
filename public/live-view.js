/* SoloHost Live View — CDP screencast + reliable input (V11.0.1)
 * Fixes: coordinate mapping to device metrics, mouse buttons bitmask,
 * continuous focus, keyDown+char+keyUp sequence, pointer capture.
 * WebSocket: /api/browser/live?sessionId=&token=
 */
(function (global) {
  'use strict';

  function LiveView(opts) {
    this.canvas = opts.canvas || null;
    this.ctx = this.canvas && this.canvas.getContext ? this.canvas.getContext('2d') : null;
    this.sessionId = opts.sessionId || '';
    this.token = opts.token || '';
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.lastMeta = null;
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    this.onError = typeof opts.onError === 'function' ? opts.onError : function () {};
    this._bound = false;
    this._pageW = 1280;
    this._pageH = 800;
    this._offsetTop = 0;
    this._offsetLeft = 0;
    this._pressed = false;
    this._handlers = [];
    this._lastMoveSent = 0;
    this._movePending = null;
  }

  LiveView.prototype._status = function (s, extra) {
    try { this.onStatus(s, extra || {}); } catch (_) {}
  };

  LiveView.prototype.connect = function () {
    var self = this;
    if (!this.sessionId || !this.token) {
      this._status('missing_auth');
      return;
    }
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.connecting = true;
    this._status('connecting');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var u = proto + '//' + location.host + '/api/browser/live?sessionId=' +
      encodeURIComponent(this.sessionId) + '&token=' + encodeURIComponent(this.token);
    try {
      this.ws = new WebSocket(u);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = function () {
        self.connected = true;
        self.connecting = false;
        self._status('connected');
        self._bindInput();
        // request initial size based on canvas CSS box
        try {
          if (self.canvas) {
            var r = self.canvas.getBoundingClientRect();
            self.resize(Math.round(r.width) || 1024, Math.round(r.height) || 720);
          }
        } catch (_) {}
      };
      this.ws.onclose = function () {
        self.connected = false;
        self.connecting = false;
        self._status('closed');
      };
      this.ws.onerror = function () {
        self.connecting = false;
        self._status('error');
        self.onError('ws_error');
      };
      this.ws.onmessage = function (ev) {
        if (typeof ev.data === 'string') {
          try {
            var msg = JSON.parse(ev.data);
            if (msg.type === 'meta' && msg.metadata) {
              self.lastMeta = msg.metadata;
              if (msg.metadata.deviceWidth) self._pageW = msg.metadata.deviceWidth;
              if (msg.metadata.deviceHeight) self._pageH = msg.metadata.deviceHeight;
              if (msg.metadata.offsetTop != null) self._offsetTop = msg.metadata.offsetTop;
              if (msg.metadata.offsetLeft != null) self._offsetLeft = msg.metadata.offsetLeft;
            } else if (msg.type === 'error') {
              self.onError(msg.error || 'live_error');
            }
          } catch (_) {}
          return;
        }
        // binary jpeg frame
        if (self.ctx && ev.data) {
          try {
            var blob = new Blob([ev.data], { type: 'image/jpeg' });
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () {
              try {
                if (self.canvas.width !== img.width) self.canvas.width = img.width;
                if (self.canvas.height !== img.height) self.canvas.height = img.height;
                self.ctx.drawImage(img, 0, 0);
              } catch (_) {}
              URL.revokeObjectURL(url);
            };
            img.src = url;
          } catch (_) {}
        }
      };
    } catch (e) {
      this.connecting = false;
      this._status('error');
      this.onError(String(e && e.message || e));
    }
  };

  LiveView.prototype.send = function (obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch (_) {
      return false;
    }
  };

  /**
   * Map client (screen) coordinates → page CSS pixels used by CDP Input.
   * Prefer deviceWidth/Height from screencast metadata when available.
   */
  LiveView.prototype._toPage = function (clientX, clientY) {
    if (!this.canvas) return { x: 0, y: 0 };
    var rect = this.canvas.getBoundingClientRect();
    var relX = clientX - rect.left;
    var relY = clientY - rect.top;
    var cssW = rect.width || 1;
    var cssH = rect.height || 1;
    var pageW = this._pageW || this.canvas.width || 1280;
    var pageH = this._pageH || this.canvas.height || 800;
    var x = Math.round((relX / cssW) * pageW) + (this._offsetLeft || 0);
    var y = Math.round((relY / cssH) * pageH) + (this._offsetTop || 0);
    return {
      x: Math.max(0, Math.min(pageW, x)),
      y: Math.max(0, Math.min(pageH, y))
    };
  };

  LiveView.prototype._on = function (el, type, fn, opts) {
    el.addEventListener(type, fn, opts || false);
    this._handlers.push({ el: el, type: type, fn: fn, opts: opts });
  };

  LiveView.prototype._bindInput = function () {
    if (this._bound || !this.canvas) return;
    this._bound = true;
    var self = this;
    var canvas = this.canvas;
    canvas.setAttribute('tabindex', '0');
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';

    function btnName(e) {
      if (e.button === 1) return 'middle';
      if (e.button === 2) return 'right';
      return 'left';
    }
    function buttonsMask(e) {
      // CDP: 1 left, 2 right, 4 middle
      var m = 0;
      if (e.buttons & 1) m |= 1;
      if (e.buttons & 2) m |= 2;
      if (e.buttons & 4) m |= 4;
      return m;
    }
    function mods(e) {
      return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
    }

    this._on(canvas, 'pointerdown', function (e) {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      try { canvas.focus(); } catch (_) {}
      self._pressed = true;
      var p = self._toPage(e.clientX, e.clientY);
      self.send({
        type: 'mouse',
        eventType: 'mousePressed',
        x: p.x, y: p.y,
        button: btnName(e),
        buttons: buttonsMask(e) || 1,
        clickCount: 1,
        modifiers: mods(e)
      });
    });
    this._on(canvas, 'pointerup', function (e) {
      e.preventDefault();
      self._pressed = false;
      var p = self._toPage(e.clientX, e.clientY);
      self.send({
        type: 'mouse',
        eventType: 'mouseReleased',
        x: p.x, y: p.y,
        button: btnName(e),
        buttons: buttonsMask(e),
        clickCount: 1,
        modifiers: mods(e)
      });
    });
    this._on(canvas, 'pointermove', function (e) {
      var p = self._toPage(e.clientX, e.clientY);
      var payload = {
        type: 'mouse',
        eventType: 'mouseMoved',
        x: p.x, y: p.y,
        button: self._pressed ? btnName(e) : 'none',
        buttons: buttonsMask(e),
        clickCount: 0,
        modifiers: mods(e)
      };
      // Throttle move events (~30fps) to keep Live responsive under load
      var now = Date.now();
      if (now - (self._lastMoveSent || 0) < 33 && !self._pressed) {
        self._movePending = payload;
        return;
      }
      self._lastMoveSent = now;
      self._movePending = null;
      self.send(payload);
    });
    this._on(canvas, 'wheel', function (e) {
      e.preventDefault();
      var p = self._toPage(e.clientX, e.clientY);
      self.send({
        type: 'wheel',
        x: p.x, y: p.y,
        deltaX: e.deltaX || 0,
        deltaY: e.deltaY || 0,
        modifiers: mods(e)
      });
    }, { passive: false });
    this._on(canvas, 'contextmenu', function (e) { e.preventDefault(); });

    this._on(canvas, 'keydown', function (e) {
      // Let browser handle pure shortcuts to UI elsewhere only if meta/ctrl without target focus intent
      e.preventDefault();
      e.stopPropagation();
      var key = e.key || '';
      var code = e.code || '';
      // Printable → insertText is more reliable for Unicode / IME result
      if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        self.send({ type: 'insertText', text: key });
        return;
      }
      self.send({
        type: 'key',
        eventType: 'keyDown',
        key: key,
        code: code,
        keyCode: e.keyCode || e.which || 0,
        text: key.length === 1 ? key : undefined,
        modifiers: mods(e)
      });
      if (key === 'Enter' || key === 'Tab' || key === 'Escape' || key === 'Backspace' || key === 'Delete' ||
          key.indexOf('Arrow') === 0 || key.indexOf('Page') === 0 || key === 'Home' || key === 'End') {
        // also send keyUp for navigation keys
      }
    });
    this._on(canvas, 'keyup', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var key = e.key || '';
      if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return; // handled via insertText
      self.send({
        type: 'key',
        eventType: 'keyUp',
        key: key,
        code: e.code || '',
        keyCode: e.keyCode || e.which || 0,
        modifiers: mods(e)
      });
    });
    this._on(canvas, 'paste', function (e) {
      e.preventDefault();
      var text = '';
      try { text = (e.clipboardData && e.clipboardData.getData('text')) || ''; } catch (_) {}
      if (text) self.send({ type: 'insertText', text: String(text).slice(0, 4096) });
    });

    // Keep focus when user taps canvas
    this._on(canvas, 'click', function () { try { canvas.focus(); } catch (_) {} });
  };

  LiveView.prototype.resize = function (w, h) {
    this.send({
      type: 'resize',
      width: Math.max(320, Math.min(1920, w | 0)),
      height: Math.max(480, Math.min(1600, h | 0))
    });
  };

  LiveView.prototype.close = function () {
    var h;
    while ((h = this._handlers.pop())) {
      try { h.el.removeEventListener(h.type, h.fn, h.opts || false); } catch (_) {}
    }
    this._bound = false;
    this._pressed = false;
    try { if (this.ws) this.ws.close(); } catch (e) {}
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this._status('closed');
  };

  global.SoloHostLiveView = LiveView;
})(typeof window !== 'undefined' ? window : global);
