/** A fully received POST can lose its response connection without emitting req.aborted. */
export function createClientAbort(req, res) {
  const abortController = new AbortController()
  const onAborted = () => {
    if (!abortController.signal.aborted) abortController.abort(new Error('client_aborted'))
  }
  const onClosed = () => {
    if (!res.writableEnded) onAborted()
  }
  req.once('aborted', onAborted)
  res.once?.('close', onClosed)
  if (req.aborted || (res.destroyed && !res.writableEnded)) onAborted()
  return {
    abortController,
    detachClientAbort() {
      req.off('aborted', onAborted)
      res.off?.('close', onClosed)
    },
  }
}
