'use strict';

module.exports = function bridgeViewContentSecurityPolicy(pageUrl) {
  let baseSources = "'self'";
  try {
    const page = new URL(String(pageUrl || ''));
    if (page.protocol === 'https:' || page.protocol === 'http:') {
      baseSources += ' ' + page.origin;
    }
  } catch (_) {}
  return "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; media-src https: http:; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.tiktok.com https://www.vimeo.com https://player.vimeo.com https://open.spotify.com https://player.twitch.tv https://www.twitch.tv https://www.dailymotion.com https://geo.dailymotion.com https://www.bing.com https://bing.com https://*.bing.com https://*.bing.net; script-src 'none'; base-uri " + baseSources + "; form-action https: http:";
};
