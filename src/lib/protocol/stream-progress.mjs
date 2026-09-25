/** Bounded stream diagnostics: timings and character counts only, never response content. */
export function createStreamProgress(startedAt, now = Date.now) {
  const stats = {
    first_content_ms: null,
    first_text_ms: null,
    first_thinking_ms: null,
    last_content_ms: null,
    max_content_gap_ms: 0,
    text_chars: 0,
    thinking_chars: 0,
    tool_input_chars: 0,
  }
  return {
    observe(event) {
      const block = event?.type === 'content_block_start' ? event.content_block : event?.delta
      if (!block) return
      const text = typeof block.text === 'string' ? block.text.length : 0
      const thinking = typeof block.thinking === 'string' ? block.thinking.length : 0
      const tool = typeof block.partial_json === 'string' ? block.partial_json.length : 0
      if (!text && !thinking && !tool) return
      const elapsed = now() - startedAt
      if (stats.first_content_ms == null) stats.first_content_ms = elapsed
      if (text && stats.first_text_ms == null) stats.first_text_ms = elapsed
      if (thinking && stats.first_thinking_ms == null) stats.first_thinking_ms = elapsed
      if (stats.last_content_ms != null) {
        stats.max_content_gap_ms = Math.max(stats.max_content_gap_ms, elapsed - stats.last_content_ms)
      }
      stats.last_content_ms = elapsed
      stats.text_chars += text
      stats.thinking_chars += thinking
      stats.tool_input_chars += tool
    },
    snapshot() {
      return { ...stats, ended_ms: now() - startedAt }
    },
  }
}
