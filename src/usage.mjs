export const fields = ['input', 'cached', 'output', 'reasoning', 'total'];
export const zero = () => Object.fromEntries(fields.map(key => [key, 0]));

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function counters(raw = {}) {
  return {
    input: integer(raw.input_tokens),
    cached: integer(raw.cached_input_tokens),
    output: integer(raw.output_tokens),
    reasoning: integer(raw.reasoning_output_tokens),
    total: integer(raw.total_tokens)
  };
}

function add(a, b) { return Object.fromEntries(fields.map(key => [key, a[key] + b[key]])); }
function difference(a, b) { return Object.fromEntries(fields.map(key => [key, Math.max(0, a[key] - b[key])])); }

export class UsageSession {
  constructor() {
    this.id = null;
    this.provider = null;
    this.model = null;
    this.previous = null;
    this.offset = zero();
    this.total = zero();
    this.context = null;
    this.window = null;
    this.turns = [];
    this.current = null;
    this.updatedAt = null;
    this.usageAt = null;
  }

  begin(id, timestamp, partial = false) {
    if (this.current?.id === id) return this.current;
    const existing = this.turns.find(turn => turn.id === id);
    this.current = existing || {
      id, startedAt: timestamp, endedAt: null, model: this.model,
      usage: zero(), messages: [], complete: false, partial, calls: 0
    };
    if (!existing) this.turns.push(this.current);
    return this.current;
  }

  consume(record) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') return;
    const timestamp = record.timestamp || null;
    if (record.type === 'session_meta') {
      this.id = payload.id || this.id;
      this.provider = payload.model_provider || this.provider;
      return;
    }
    if (record.type === 'turn_context') {
      this.model = payload.model || this.model;
      if (this.current) this.current.model = this.model;
      return;
    }
    if (record.type === 'response_item') {
      if (payload.role === 'assistant' && payload.type === 'message'
        && ['final', 'final_answer'].includes(payload.phase) && typeof payload.id === 'string' && this.current) {
        if (!this.current.messages.includes(payload.id)) this.current.messages.push(payload.id);
      }
      return;
    }
    if (record.type !== 'event_msg') return;
    if (payload.type === 'task_started') {
      this.begin(payload.turn_id || `turn:${timestamp}`, timestamp);
      if (Number.isSafeInteger(payload.model_context_window)) this.window = payload.model_context_window;
    } else if (payload.type === 'token_count' && payload.info?.total_token_usage) {
      if (!Number.isSafeInteger(payload.info.total_token_usage.total_tokens)
        || payload.info.total_token_usage.total_tokens < 0) return;
      const next = counters(payload.info.total_token_usage);
      const last = counters(payload.info.last_token_usage);
      let delta;
      if (!this.previous) {
        // A resumed rollout may start with historical cumulative counters.
        delta = payload.info.last_token_usage ? last : zero();
        if (this.current && next.total !== last.total) this.current.partial = true;
      } else if (next.total < this.previous.total) {
        this.offset = this.total;
        delta = payload.info.last_token_usage ? last : next;
      } else {
        delta = difference(next, this.previous);
      }
      this.previous = next;
      this.total = add(this.offset, next);
      this.usageAt = timestamp;
      this.context = payload.info.last_token_usage ? last.input : null;
      if (Number.isSafeInteger(payload.info.model_context_window)) this.window = payload.info.model_context_window;
      if (this.current && delta.total > 0) {
        this.current.usage = add(this.current.usage, delta);
        this.current.calls++;
      }
      this.updatedAt = timestamp;
    } else if (['task_complete', 'turn_aborted'].includes(payload.type)) {
      if (this.current && (!payload.turn_id || this.current.id === payload.turn_id)) {
        this.current.complete = payload.type === 'task_complete';
        this.current.endedAt = timestamp;
      }
    }
  }

  snapshot() {
    return {
      id: this.id, model: this.model, provider: this.provider, total: this.total,
      context: this.context, window: this.window, updatedAt: this.updatedAt,
      usageAt: this.usageAt, turns: this.turns
    };
  }
}

export function mergeSnapshots(snapshots) {
  const ordered = snapshots.filter(item => item.id)
    .sort((a, b) => String(a.usageAt || '').localeCompare(String(b.usageAt || '')));
  if (!ordered.length) return null;
  const latest = ordered.at(-1);
  const byTurn = new Map();
  for (const item of ordered) {
    for (const turn of item.turns) {
      const prior = byTurn.get(turn.id);
      if (!prior || (!turn.partial && prior.partial)
        || (turn.partial === prior.partial && turn.usage.total >= prior.usage.total)) {
        byTurn.set(turn.id, turn);
      }
    }
  }
  return { ...latest, turns: Array.from(byTurn.values()).sort((a, b) =>
    String(a.startedAt || '').localeCompare(String(b.startedAt || ''))) };
}
