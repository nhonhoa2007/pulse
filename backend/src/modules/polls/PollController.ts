import { FastifyRequest, FastifyReply } from 'fastify';
import { createPollService } from './CreatePollService.js';
import { fetchPollDetailService } from './FetchPollDetailService.js';
import { votePollService } from './VotePollService.js';
import { closePollEarlyService } from './ClosePollEarlyService.js';
import { CreatePollInput, VotePollInput } from '../../contracts/ApiContracts.js';

export class PollController {
  public async createPoll(
    req: FastifyRequest<{ Body: CreatePollInput }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const poll = await createPollService.createPoll(req.body, req.currentUserId);
      reply.status(201).send({
        success: true,
        data: poll,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      const code = err.code || 'BAD_REQUEST';
      reply.status(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to create poll',
        },
      });
    }
  }

  public async getPoll(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const poll = await fetchPollDetailService.getPollDetail(
        req.params.id,
        req.currentUserId
      );
      reply.status(200).send({
        success: true,
        data: poll,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 404;
      const code = err.code || 'NOT_FOUND';
      reply.status(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Poll not found',
        },
      });
    }
  }

  public async votePoll(
    req: FastifyRequest<{ Params: { id: string }; Body: VotePollInput }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const poll = await votePollService.vote(
        req.params.id,
        req.body || {},
        req.currentUserId
      );
      reply.status(200).send({
        success: true,
        data: poll,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 400;
      const code = err.code || 'BAD_REQUEST';
      reply.status(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to submit vote',
        },
      });
    }
  }

  public async deletePoll(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const poll = await closePollEarlyService.closePollEarly(
        req.params.id,
        req.currentUserId
      );
      reply.status(200).send({
        success: true,
        data: poll,
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 404;
      const code = err.code || 'NOT_FOUND';
      reply.status(statusCode).send({
        success: false,
        error: {
          code,
          message: err.message || 'Failed to close poll',
        },
      });
    }
  }
}

export const pollController = new PollController();
