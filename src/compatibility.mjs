// Runs read-only before injection; absent anchors are not replaced by guesses.
export function probePage() {
  const hosts = Array.from(document.querySelectorAll(
    '[data-response-annotation-conversation][data-response-annotation-target]'
  ));
  const stamps = document.querySelectorAll('[data-assistant-message-sent-time]');
  // A new window or an empty conversation can have no final replies yet.
  // Wait read-only rather than permanently blocking the still-loading renderer.
  if (!stamps.length) return { state: 'idle' };
  if (stamps.length && !hosts.some(host => host.querySelector('[data-assistant-message-sent-time]'))) {
    return { state: 'unsupported-ui' };
  }
  return { state: 'supported' };
}

export class CompatibilityGuard {
  constructor(limit = 3) { this.limit = limit; this.failures = new Map(); }
  blocked(targetId) { return (this.failures.get(targetId) || 0) >= this.limit; }
  failed(targetId) { this.failures.set(targetId, (this.failures.get(targetId) || 0) + 1); }
  block(targetId) { this.failures.set(targetId, this.limit); }
  succeeded(targetId) { this.failures.delete(targetId); }
}
