'use strict';
const PROVIDERS = [
  { id: 'custom', name: 'Custom proxy', nameVi: 'Proxy tùy chỉnh', protocols: ['http','https','socks5'], supportsLocations: false, locations: [], docs: 'Enter your own HTTP(S) or SOCKS5 proxy. Credentials stay on the server.' },
  { id: 'selfhosted', name: 'Self-hosted', nameVi: 'Tự host', protocols: ['http','https','socks5'], supportsLocations: false, locations: [], docs: 'Proxy you run yourself. Set SOLOHOST_ALLOW_PRIVATE_PROXY=1 for LAN IPs.' },
  { id: 'manual-provider', name: 'Commercial (manual config)', nameVi: 'Thương mại (cấu hình tay)', protocols: ['http','https','socks5'], supportsLocations: true, locations: [], docs: 'Paste host/port/user/pass from your provider. Location is a label only.' }
];
function listProviders() { return PROVIDERS.map(p => ({ ...p })); }
function getProvider(id) { return PROVIDERS.find(p => p.id === id) || PROVIDERS[0]; }
module.exports = { listProviders, getProvider, PROVIDERS };
