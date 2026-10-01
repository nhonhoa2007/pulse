import { FastifyRequest, FastifyReply } from 'fastify';
import { ServerResponse } from 'node:http';

export class RealtimeEventStreamController {
  // Map of userId -> Set of active ServerResponse connections
  private connections: Map<string, Set<ServerResponse>> = new Map();

  constructor() {
    this.handleStream = this.handleStream.bind(this);
  }

  /**
   * Fastify handler for GET /api/v1/realtime/stream
   */
  public handleStream(req: FastifyRequest, reply: FastifyReply): void {
    const rawRes = reply.raw;
    const rawReq = req.raw;

    // Identify user from header x-user-id or query param ?userId=
    const userId =
      ((req.headers['x-user-id'] as string | undefined) ||
        (req.query as Record<string, string | undefined>)?.userId ||
        'anonymous').trim();

    reply.hijack();

    rawRes.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    // Send initial handshake event
    rawRes.write(`event: CONNECTED\ndata: ${JSON.stringify({ userId, connectedAt: new Date().toISOString() })}\n\n`);

    // Register active connection
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(rawRes);

    // Heartbeat ping interval to keep connection alive across proxies/NAT
    const heartbeatInterval = setInterval(() => {
      if (!rawRes.writableEnded) {
        rawRes.write(': heartbeat\n\n');
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
      const userConns = this.connections.get(userId);
      if (userConns) {
        userConns.delete(rawRes);
        if (userConns.size === 0) {
          this.connections.delete(userId);
        }
      }
    };

    rawReq.on('close', cleanup);
    rawRes.on('close', cleanup);
    rawRes.on('error', cleanup);
  }

  /**
   * Push an event to a specific user if connected
   */
  public sendToUser(userId: string, event: string, data: unknown): void {
    const userConns = this.connections.get(userId);
    if (!userConns || userConns.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of userConns) {
      if (!res.writableEnded) {
        res.write(payload);
      }
    }
  }

  /**
   * Broadcast an event to all connected users
   */
  public broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, conns] of this.connections) {
      for (const res of conns) {
        if (!res.writableEnded) {
          res.write(payload);
        }
      }
    }
  }

  public getConnectedUserCount(): number {
    return this.connections.size;
  }
}

export const realtimeStreamController = new RealtimeEventStreamController();
