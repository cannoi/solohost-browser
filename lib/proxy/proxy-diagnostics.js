'use strict';
const { STATES, redactErrorMessage } = require('./proxy-config');
function messageFor(state, lang, detail) {
  const vi = lang === 'vi';
  const d = detail ? ' — ' + redactErrorMessage(detail) : '';
  const map = {
    [STATES.DISCONNECTED]: vi ? 'Chưa kết nối (trực tiếp)' : 'Disconnected (direct)',
    [STATES.CONNECTING]: vi ? 'Đang kết nối…' : 'Connecting…',
    [STATES.CONNECTED]: vi ? 'Đã kết nối an toàn qua proxy' : 'Connected via proxy',
    [STATES.CONNECTION_FAILED]: vi ? 'Kết nối thất bại' : 'Connection failed',
    [STATES.AUTHENTICATION_FAILED]: vi ? 'Sai user/password proxy' : 'Proxy authentication failed',
    [STATES.PROXY_UNAVAILABLE]: vi ? 'Proxy không phản hồi' : 'Proxy unavailable',
    [STATES.TIMEOUT]: vi ? 'Hết thời gian chờ' : 'Connection timed out',
    [STATES.INVALID_CONFIGURATION]: vi ? 'Cấu hình proxy không hợp lệ' : 'Invalid proxy configuration',
    [STATES.LOCATION_UNAVAILABLE]: vi ? 'Vị trí không khả dụng' : 'Location unavailable'
  };
  return (map[state] || state) + d;
}
function buildDiagnostics(status, entry) {
  return {
    state: status.state, publicIp: status.publicIp || null, directIp: status.directIp || null,
    ipChanged: !!(status.publicIp && status.directIp && status.publicIp !== status.directIp),
    location: status.location || (entry && entry.location) || null,
    latencyMs: status.latencyMs != null ? status.latencyMs : null,
    protocol: entry ? entry.protocol : null, host: entry ? entry.host : null, port: entry ? entry.port : null,
    provider: entry ? entry.provider : null, checkedAt: status.checkedAt || null,
    message: status.message || null, errorCode: status.errorCode || null,
    note: 'Proxy routing is a connectivity feature. It does not guarantee CAPTCHA bypass or Google login success.'
  };
}
module.exports = { messageFor, buildDiagnostics };
