'use strict';
/**
 * Optional guidance for contact/register forms.
 * NEVER autofills password/OTP/payment — safety stays in agent-actions + backend-agent.
 */
function matchFillFormIntent(task) {
  const t = String(task || '').toLowerCase();
  if (/(?:điền form|dien form|fill (?:the |this )?form|điền mẫu|dien mau)/.test(t)) return true;
  if (/(?:form liên hệ|contact form|registration form|đăng ký tài khoản|dang ky tai khoan)/.test(t)) return true;
  if (/(?:điền|fill).{0,40}(?:họ tên|name|email|số điện thoại|phone|địa chỉ|address)/.test(t) && !/(?:mật khẩu|password|otp|cvv|thẻ|card)/.test(t)) return true;
  return false;
}

function buildChecklist(task, lang) {
  return {
    kind: 'fill_form',
    citation_required: false,
    output_language: lang === 'vi' ? 'vi' : 'en',
    safety: {
      never_fill_secrets: true,
      confirm_submit: true,
      blocked_fields: ['password', 'otp', 'cvv', 'credit_card']
    },
    steps_hint: [
      'Locate visible non-secret form fields',
      'Fill name/email/phone/message from the user task only',
      'Do not submit high-risk actions without confirmation',
      'Never type into password/OTP/payment fields — ask_user instead'
    ]
  };
}

function suggestedActions() {
  // Let the LLM observe the page; no blind navigation.
  return [{ type: 'extract_page' }];
}

module.exports = {
  id: 'fill_form',
  matchFillFormIntent,
  match: matchFillFormIntent,
  buildChecklist,
  suggestedActions
};
