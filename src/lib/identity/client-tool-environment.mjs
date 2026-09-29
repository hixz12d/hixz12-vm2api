/** Keep account-runtime identity separate from the environment of caller-owned tools. */
export const CLIENT_TOOL_ENVIRONMENT_NOTE = `<client_tool_environment>
Client-provided filesystem and terminal tools operate in the environment selected by the client. The forwarding account runtime's OS, shell, working directory, and memory paths do not establish the environment of those tools.
For tool operations, use the client's explicit workspace instructions and actual tool results. Do not substitute runtime paths, translate client paths, or choose shell syntax merely from the forwarding runtime's metadata. If the tool environment is unclear, inspect it with the available client tools before choosing paths or commands. A remote environment explicitly selected by the user or a tool remains valid.
</client_tool_environment>`

const LOCAL_TOOL_NAME =
  /(?:^|[._])(?:bash|shell|terminal|exec|exec_command|execute_command|run_command|read|read_file|write|write_file|edit|edit_file|multiedit|apply_patch|list_directory)$/i

export function preserveClientToolEnvironment(body) {
  if (!body || !Array.isArray(body.tools)) return body
  if (!body.tools.some((tool) => LOCAL_TOOL_NAME.test(String(tool?.name || tool?.function?.name || '')))) {
    return body
  }
  const system = body.system
  const texts =
    typeof system === 'string'
      ? [system]
      : Array.isArray(system)
        ? system.map((block) => (typeof block === 'string' ? block : block?.text))
        : []
  if (texts.some((text) => String(text || '').includes(CLIENT_TOOL_ENVIRONMENT_NOTE))) return body
  const note = { type: 'text', text: CLIENT_TOOL_ENVIRONMENT_NOTE }
  if (system == null) return { ...body, system: [note] }
  if (typeof system === 'string') return { ...body, system: `${system}\n\n${CLIENT_TOOL_ENVIRONMENT_NOTE}` }
  if (Array.isArray(system)) return { ...body, system: [...system, note] }
  return body
}
