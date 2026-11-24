'use strict';
/**
 * SoloHost Browser — central EN + VI strings (v11.0.2)
 * Default language: English. User switches via EN/VI button.
 */
(function (global) {
  const STR = {
    en: {
      live: 'Live',
      liveTitle: 'Full interaction (Live)',
      liveExit: 'Exit Live (back to fast view)',
      liveConnected: 'Live · connected',
      liveConnecting: 'Live · connecting…',
      liveDisconnected: 'Live · disconnected',
      liveHint: 'Full interaction — click, type, scroll. No audio in Live.',
      liveNeedPage: 'Open a page first, then enable Live.',
      liveClientMissing: 'Live client not loaded.',
      signedIn: 'Signed-in sites',
      cookiesTitle: 'Signed-in sites',
      cookiesHint: 'Clear cookies for a site to sign out. Passwords are never stored.',
      clearSite: 'Clear',
      importCookies: 'Import cookies',
      exportCookies: 'Export cookies',
      commonTasks: 'Common tasks',
      workflows: 'Workflows',
      schedules: 'Schedules',
      scheduleNote: 'Schedules only run while the app is active on SoloHost.',
      agentRunning: 'Agent is working…',
      agentStop: 'Stop',
      agentAllow: 'Allow',
      agentDeny: 'Deny',
      agentLocked: 'Agent is using the browser — controls are locked. Watch the page below.',
      agentPlanning: 'Planning & running in the browser…',
      allow: 'Allow',
      deny: 'Deny',
      mediaCache: 'Media cache',
      openYoutube: 'Open on YouTube ↗',
      useLive: 'Use Live (◉) to watch the official page.',
      sessionExpired: 'Session expired — please reload.',
      save: 'Save',
      cancel: 'Cancel',
      run: 'Run',
      record: 'Record workflow',
      stopRecord: 'Stop recording',
      searchPlaceholder: 'Search or enter address',
      chatPlaceholder: 'Ask anything or tell me what to do…',
      library: 'Library',
      bookmarks: '☆ Bookmarks',
      history: '◷ History',
      clearHistory: 'Clear history',
      newTab: 'New tab',
      openTab: 'Open tab ↗',
      askAi: 'Ask AI',
      menu_section_tabs: 'Tabs',
      menu_section_connection: 'Connection',
      menu_section_page: 'Page',
      menu_section_library: 'Library',
      menu_section_settings: 'Settings',
      menu_live: '◉ Full interaction (Live)',
      menu_cookies: '🍪 Signed-in sites',
      menu_lang: 'Language',
      menu_theme: 'Theme',
      menu_reader: 'Reader',
      menu_summary: 'Summary',
      menu_translate: 'Translate',
      continue: '▶ Continue',
      clearMemory: 'Clear memory',
      working: 'Working…',
      langBtnTitle: 'Language: English (click for Vietnamese)',
      privateTab: 'Private tab',
      searchEngineSaved: 'Search engine saved.',
      searchEngineInvalid: 'URL must use HTTP(S) and contain {query} or %s.',
      agentStart: 'Starting',
      minutes: 'min',
      plan: 'Plan',
      close: 'Close'
    },
    vi: {
      live: 'Live',
      liveTitle: 'Tương tác đầy đủ (Live)',
      liveExit: 'Thoát Live (về xem nhanh)',
      liveConnected: 'Live · đã kết nối',
      liveConnecting: 'Live · đang kết nối…',
      liveDisconnected: 'Live · mất kết nối',
      liveHint: 'Tương tác đầy đủ — bấm, gõ, cuộn. Live không có âm thanh.',
      liveNeedPage: 'Hãy mở một trang trước, rồi bật Live.',
      liveClientMissing: 'Live client chưa tải.',
      signedIn: 'Trang đã đăng nhập',
      cookiesTitle: 'Trang đã đăng nhập',
      cookiesHint: 'Xóa cookie để đăng xuất. Mật khẩu không bao giờ được lưu.',
      clearSite: 'Xóa',
      importCookies: 'Nhập cookie',
      exportCookies: 'Xuất cookie',
      commonTasks: 'Việc hay làm',
      workflows: 'Quy trình',
      schedules: 'Lịch chạy',
      scheduleNote: 'Lịch chỉ chạy khi app đang hoạt động trên SoloHost.',
      agentRunning: 'Agent đang chạy…',
      agentStop: 'Dừng',
      agentAllow: 'Cho phép',
      agentDeny: 'Từ chối',
      agentLocked: 'Agent đang dùng trình duyệt — điều khiển bị khóa. Theo dõi trang bên dưới.',
      agentPlanning: 'Đang lập kế hoạch & chạy trên trình duyệt…',
      allow: 'Cho phép',
      deny: 'Từ chối',
      mediaCache: 'Bộ nhớ media',
      openYoutube: 'Mở trên YouTube ↗',
      useLive: 'Dùng Live (◉) để xem trang chính thức.',
      sessionExpired: 'Phiên hết hạn — hãy tải lại.',
      save: 'Lưu',
      cancel: 'Hủy',
      run: 'Chạy',
      record: 'Ghi quy trình',
      stopRecord: 'Dừng ghi',
      searchPlaceholder: 'Tìm kiếm hoặc nhập địa chỉ',
      chatPlaceholder: 'Hỏi bất kỳ điều gì hoặc bảo tôi làm…',
      library: 'Thư viện',
      bookmarks: '☆ Dấu trang',
      history: '◷ Lịch sử',
      clearHistory: 'Xóa lịch sử',
      newTab: 'Tab mới',
      openTab: 'Mở tab ↗',
      askAi: 'AI gợi ý',
      menu_section_tabs: 'Tab',
      menu_section_connection: 'Kết nối',
      menu_section_page: 'Trang',
      menu_section_library: 'Thư viện',
      menu_section_settings: 'Cài đặt',
      menu_live: '◉ Tương tác đầy đủ (Live)',
      menu_cookies: '🍪 Trang đã đăng nhập',
      menu_lang: 'Ngôn ngữ',
      menu_theme: 'Giao diện',
      menu_reader: 'Đọc',
      menu_summary: 'Tóm tắt',
      menu_translate: 'Dịch',
      continue: '▶ Tiếp tục',
      clearMemory: 'Xóa bộ nhớ',
      working: 'Đang xử lý…',
      langBtnTitle: 'Ngôn ngữ: Tiếng Việt (bấm để English)',
      privateTab: 'Tab riêng tư',
      searchEngineSaved: 'Đã lưu công cụ tìm kiếm.',
      searchEngineInvalid: 'URL phải dùng HTTP(S) và chứa {query} hoặc %s.',
      agentStart: 'Bắt đầu',
      minutes: 'phút',
      plan: 'Kế hoạch',
      close: 'Đóng'
    }
  };

  function detect() {
    try {
      const saved = localStorage.getItem('solo_lang');
      if (saved === 'vi' || saved === 'en') return saved;
    } catch (_) {}
    return 'en';
  }

  let lang = detect();

  function t(key) {
    const pack = STR[lang] || STR.en;
    return pack[key] || STR.en[key] || key;
  }

  function setLang(l) {
    lang = l === 'vi' ? 'vi' : 'en';
    try { localStorage.setItem('solo_lang', lang); } catch (_) {}
    applyDom();
    try {
      document.documentElement.lang = lang;
      window.dispatchEvent(new CustomEvent('solo:lang', { detail: { lang: lang } }));
    } catch (_) {}
  }

  function applyDom() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', t(k));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      const k = el.getAttribute('data-i18n-aria');
      if (k) el.setAttribute('aria-label', t(k));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k));
    });
  }

  global.SoloI18n = { t: t, setLang: setLang, getLang: function () { return lang; }, applyDom: applyDom, STR: STR };
})(typeof window !== 'undefined' ? window : global);
