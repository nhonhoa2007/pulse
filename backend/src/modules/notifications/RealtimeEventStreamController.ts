import { FastifyRequest, FastifyReply } from 'fastify';
import { ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { prisma } from '../../db/PrismaClientSingleton.js';

const TICKET_TTL_MS = 30_000;

export class RealtimeEventStreamController {
  // Map of userId -> Set of active ServerResponse connections
  private connections: Map<string, Set<ServerResponse>> = new Map();
  // SEC-01: one-time SSE connection tickets — single-use, short-lived
  private tickets: Map<string, { userId: string; expiresAt: number }> = new Map();

  constructor() {
    this.handleStream = this.handleStream.bind(this);
    this.requestTicket = this.requestTicket.bind(this);
  }

  /**
   * Issue a cryptographically random, single-use ticket bound to a userId.
   */
  public issueTicket(userId: string, ttlMs: number = TICKET_TTL_MS): string {
    this.purgeExpiredTickets();
    const ticket = crypto.randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { userId, expiresAt: Date.now() + ttlMs });
    return ticket;
  }

  private purgeExpiredTickets(): void {
    const now = Date.now();
    for (const [ticket, data] of this.tickets) {
      if (data.expiresAt <= now) {
        this.tickets.delete(ticket);
      }
    }
  }

  /**
   * Fastify handler for POST /api/v1/realtime/ticket (SEC-01).
   * Requires JWT authentication via the standard preHandler hook.
   */
  public requestTicket(req: FastifyRequest, reply: FastifyReply): void {
    const userId = req.currentUserId;
    if (!userId) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to open a realtime stream',
        },
      });
      return;
    }
    reply.send({
      success: true,
      data: {
        ticket: this.issueTicket(userId),
        expiresIn: Math.round(TICKET_TTL_MS / 1000),
      },
    });
  }

  /**
   * Fastify handler for GET /api/v1/realtime/stream
   */
  public async handleStream(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const rawRes = reply.raw;
    const rawReq = req.raw;

    // SEC-01: identity comes exclusively from a valid one-time ticket.
    // Headers and plain userId query params are never trusted.
    const query = req.query as Record<string, string | undefined>;
    const ticket = query?.ticket?.trim();
    const ticketData = ticket ? this.tickets.get(ticket) : undefined;
    if (!ticketData || ticketData.expiresAt <= Date.now()) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'A valid one-time realtime ticket is required (?ticket=). Obtain one via POST /api/v1/realtime/ticket.',
        },
      });
      return;
    }
    const activeUser = await prisma.user.findFirst({
      where: { id: ticketData.userId, isDeleted: false, accountStatus: 'ACTIVE' },
      select: { id: true },
    });
    if (!activeUser) {
      this.tickets.delete(ticket!);
      reply.status(401).send({
        success: false,
        error: { code: 'ACCOUNT_INACTIVE', message: 'Account is unavailable' },
      });
      return;
    }

    // Tickets are single-use: consume immediately.
    this.tickets.delete(ticket!);
    const userId = ticketData.userId;

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
    const heartbeatInterval = setInterval(async () => {
      if (rawRes.writableEnded) return;
      const active = await prisma.user.findFirst({
        where: { id: userId, isDeleted: false, accountStatus: 'ACTIVE' },
        select: { id: true },
      }).catch(() => null);
      if (!active) {
        rawRes.end();
        cleanup();
        return;
      }
      rawRes.write(': heartbeat\n\n');
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

  public getConnectedUserIds(): string[] {
    return [...this.connections.keys()];
  }

  public disconnectUser(userId: string): void {
    const userConns = this.connections.get(userId);
    if (!userConns) return;
    for (const res of userConns) res.end();
    this.connections.delete(userId);
  }
}

export const realtimeStreamController = new RealtimeEventStreamController();
