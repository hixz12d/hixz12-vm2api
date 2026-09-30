/**
 * Account-level failures (the account itself, not the network) from the latest
 * usage probe / profile / refresh error. Shared by the panel list and 同步账号.
 * Only the latest result counts: the next successful probe drops the issue.
 */

const ISSUE_RULES = [
  {
    code: 'oauth_not_allowed',
    re: /OAuth authentication is currently not allowed/i,
    text: '无法用 OAuth 登录（可能已降级为 Free 或被限制）',
  },
  {
    code: 'account_disabled',
    re: /organization.*(disabled|suspended)|account.*(disabled|suspended|banned)/i,
    text: '账号或组织已被停用',
  },
]

/** Timeouts, ECONN*, proxy, 5xx, 429 and official /usage throttling are never account issues. */
const TRANSIENT =
  /timeout|timed out|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|proxy|socks|rate.?limit|限流|\b429\b|\b5\d\d\b|overloaded/i

function errorText(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const inner = value.error && typeof value.error === 'object' ? value.error : value
    const text = inner.message || inner.code || inner.type || ''
    if (text) return String(text)
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

function matchIssue(value) {
  const text = errorText(value)
  if (!text) return null
  for (const rule of ISSUE_RULES) {
    if (!rule.re.test(text)) continue
    if (rule.code !== 'oauth_not_allowed' && TRANSIENT.test(text)) return null
    return rule
  }
  return null
}

/** → `{ code, text, since }` or null. `since` is the probe time. */
export function detectAccountIssue({ probeError = null, profileError = null, refreshError = null, probedAt = null } = {}) {
  for (const value of [profileError, probeError, refreshError]) {
    const rule = matchIssue(value)
    if (rule) return { code: rule.code, text: rule.text, since: probedAt || null }
  }
  return null
}
