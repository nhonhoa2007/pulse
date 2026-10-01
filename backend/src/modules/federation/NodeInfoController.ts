import { FastifyRequest, FastifyReply } from 'fastify';
import { fetchNodeInfoService } from './FetchNodeInfoService.js';

export class NodeInfoController {
  /**
   * GET /.well-known/nodeinfo
   * FEP-0151 discovery links pointing to supported NodeInfo schema versions.
   */
  public async getWellKnown(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const hostHeader = request.headers.host;
    const linksDoc = fetchNodeInfoService.getWellKnown(hostHeader);

    reply
      .status(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Cache-Control', 'public, max-age=86400')
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Accept, Content-Type')
      .send(linksDoc);
  }

  /**
   * GET /nodeinfo/2.1
   * NodeInfo 2.1 protocol document with software profile, protocol support, and usage statistics.
   */
  public async getNodeInfo21(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const hostHeader = request.headers.host;
    const doc = await fetchNodeInfoService.getNodeInfo('2.1', hostHeader);

    reply
      .status(200)
      .header(
        'Content-Type',
        'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"; charset=utf-8'
      )
      .header('Cache-Control', 'public, max-age=1800')
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Accept, Content-Type')
      .send(doc);
  }

  /**
   * GET /nodeinfo/2.0
   * NodeInfo 2.0 backward-compatible document.
   */
  public async getNodeInfo20(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const hostHeader = request.headers.host;
    const doc = await fetchNodeInfoService.getNodeInfo('2.0', hostHeader);

    reply
      .status(200)
      .header(
        'Content-Type',
        'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.0#"; charset=utf-8'
      )
      .header('Cache-Control', 'public, max-age=1800')
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Accept, Content-Type')
      .send(doc);
  }
}

export const nodeInfoController = new NodeInfoController();
