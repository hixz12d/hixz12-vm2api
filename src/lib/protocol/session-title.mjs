/** Recognize the SDK's independent session-title task, not arbitrary short requests. */
export function isSessionTitleRequest(body = {}) {
  if (!/^claude-/i.test(String(body.model || ''))) return false
  if (body.tools != null && (!Array.isArray(body.tools) || body.tools.length)) return false
  if (body.thinking && body.thinking.type !== 'disabled') return false
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user') return false
  const text = (content) => {
    if (typeof content === 'string') return content
    if (!Array.isArray(content) || content.some((part) => part?.type !== 'text')) return ''
    return content.map((part) => (typeof part.text === 'string' ? part.text : '')).join('\n')
  }
  const system = text(body.system)
  const user = text(messages[0].content)
  return /You are naming a coding session\b/i.test(system) && /^\s*<session>[\s\S]*<\/session>\s*\S/.test(user)
}
