import type { RealtimeEvent } from '../../types/PulseTypes';

interface RealtimeSubscriber {
  onEvent: (event: RealtimeEvent) => void;
  onError?: (error: Event) => void;
}

interface RealtimeClientOptions {
  baseUrl: () => string;
  hasSession: () => boolean;
  getTicket: () => Promise<{ ticket: string; expiresIn: number }>;
}

const EVENT_TYPES = [
  'NEW_TIMELINE_POST',
  'NEW_NOTIFICATION',
  'FOLLOW_REQUEST',
  'FOLLOW_ACCEPT',
  'POLL_UPDATED',
  'POLL_VOTED',
  'POLL_EXPIRED',
  'dm.typing',
  'dm.reaction.updated',
  'dm.group.reaction.updated',
  'dm.message.new',
  'dm.message.deleted',
  'dm.read_receipt.updated',
  'dm.group.message.new',
  'dm.group.message.deleted',
  'dm.group.member.joined',
  'dm.group.member.left',
  'dm.group.read_receipt.updated',
  'dm.group.updated',
];

export class RealtimeClient {
  private readonly options: RealtimeClientOptions;
  private subscribers = new Set<RealtimeSubscriber>();
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connecting = false;
  private userId = '';
  private attempt = 0;
  private generation = 0;
  private onlineHandler: (() => void) | null = null;

  constructor(options: RealtimeClientOptions) {
    this.options = options;
  }

  subscribe(
    userId: string,
    onEvent: RealtimeSubscriber['onEvent'],
    onError?: RealtimeSubscriber['onError']
  ): () => void {
    const subscriber = { onEvent, onError };
    if (this.userId && this.userId !== userId) this.stopTransport();
    this.userId = userId;
    this.subscribers.add(subscriber);

    if (typeof window !== 'undefined' && !this.onlineHandler) {
      this.onlineHandler = () => {
        this.attempt = 0;
        this.scheduleReconnect(0);
      };
      window.addEventListener('online', this.onlineHandler);
    }
    void this.ensureConnection();

    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.disconnect();
    };
  }

  disconnect(): void {
    this.subscribers.clear();
    this.stopTransport();
    this.userId = '';
    if (typeof window !== 'undefined' && this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }

  private async ensureConnection(): Promise<void> {
    if (
      this.connecting ||
      this.source ||
      this.subscribers.size === 0 ||
      !this.userId ||
      !this.options.hasSession() ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) return;

    const generation = this.generation;
    this.connecting = true;
    try {
      const ticketData = await this.options.getTicket();
      if (generation !== this.generation || this.subscribers.size === 0) return;

      const url = `${this.options.baseUrl()}/realtime/stream?ticket=${encodeURIComponent(ticketData.ticket)}`;
      const source = new EventSource(url);
      this.source = source;

      for (const eventType of EVENT_TYPES) {
        source.addEventListener(eventType, (event: MessageEvent) => {
          this.emitNamedEvent(eventType, event.data);
        });
      }

      source.onopen = () => {
        this.attempt = 0;
      };
      source.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type || payload.event) {
            this.broadcast({
              type: payload.type || payload.event,
              data: payload.data,
              timestamp: payload.timestamp || new Date().toISOString(),
            });
          }
        } catch {
          // Heartbeats and extension messages do not represent app events.
        }
      };
      source.onerror = (error) => {
        if (this.source !== source) return;
        source.close();
        this.source = null;
        for (const subscriber of this.subscribers) subscriber.onError?.(error);
        this.scheduleReconnect();
      };
    } catch {
      const error = new Event('sse-ticket-error');
      for (const subscriber of this.subscribers) subscriber.onError?.(error);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private emitNamedEvent(type: string, rawData: string): void {
    let data: unknown = rawData;
    try {
      data = rawData ? JSON.parse(rawData) : null;
    } catch {
      // Keep raw text for compatible server extensions.
    }
    this.broadcast({ type, data, timestamp: new Date().toISOString() });
  }

  private broadcast(event: RealtimeEvent): void {
    for (const subscriber of this.subscribers) subscriber.onEvent(event);
  }

  private scheduleReconnect(delay?: number): void {
    if (this.subscribers.size === 0 || this.reconnectTimer) return;
    const backoff = delay ?? Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnection();
    }, backoff);
  }

  private stopTransport(): void {
    this.generation += 1;
    this.connecting = false;
    this.attempt = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close();
    this.source = null;
  }
}
