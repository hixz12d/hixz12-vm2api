import { createHash } from 'node:crypto'

/** Desktop specialists can share their parent's session id but have independent histories. */
export function specialistTaskFingerprint(body = {}) {
  const blocks = typeof body.system === 'string' ? [body.system] : Array.isArray(body.system) ? body.system : []
  const role = blocks
    .map((block) => (typeof block === 'string' ? block : block?.text || ''))
    .map(
      (text) =>
        text.match(
          /^\s*You are (a file search specialist|a software architect and planning specialist|an agent) for Claude Code\b/im,
        )?.[1],
    )
    .find(Boolean)
  if (!role) return ''
  const user = (Array.isArray(body.messages) ? body.messages : []).find((message) => message?.role === 'user')
  const content = user?.content
  const first =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.find((block) => typeof block === 'string' || (block?.type === 'text' && block.text))
        : null
  const text = typeof first === 'string' ? first : first?.text || ''
  if (!text.trim()) return ''
  return createHash('sha256')
    .update(JSON.stringify([role, text.replace(/\r\n/g, '\n').trim()]))
    .digest('hex')
    .slice(0, 32)
}
