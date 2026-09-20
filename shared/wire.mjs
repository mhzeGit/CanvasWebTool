/**
 * Newline-delimited JSON framing for the control socket.
 *
 * Requests are `{ id, cmd, args }`; replies are `{ id, ok: true, result }` or
 * `{ id, ok: false, error: { code, message } }`. Unsolicited pushes (used by
 * `canvas watch`) carry `{ event, payload }` and no id.
 */

/** Guards against a runaway peer filling memory with one unterminated line. */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export function encode(message) {
  return JSON.stringify(message) + '\n';
}

/**
 * Feed socket chunks in, get parsed messages out. Kept as a closure rather than
 * a stream transform so both the server and the CLI can use it unchanged.
 */
export function createDecoder(onMessage, onError) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_MESSAGE_BYTES) {
      buffer = '';
      onError?.(new Error('Message exceeded the maximum size'));
      return;
    }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (err) {
        onError?.(err);
      }
    }
  };
}
