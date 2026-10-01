import { prisma } from '../../db/PrismaClientSingleton.js';
import { ssrfProtectionGuardService } from './SsrfProtectionGuardService.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';
import { httpSignatureSignerService } from './HttpSignatureSignerService.js';

export interface EnqueueDeliveryJobOptions {
  activityId: string;
  activityType: string;
  actorUri: string;
  targetInboxUrl: string;
  payload: any;
  maxAttempts?: number;
}

export class ActivityDeliveryWorkerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  /**
   * Starts background worker loop
   */
  public start(intervalMs = 5000): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      await this.processBatchNow().catch((err) => {
        console.error('Error in ActivityDeliveryWorker background sweep:', err);
      });
    }, intervalMs);

    this.timer.unref();
  }

  /**
   * Stops background worker loop
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Enqueues a new Activity delivery job into the database
   */
  public async queueDelivery(options: EnqueueDeliveryJobOptions): Promise<string> {
    const payloadJson =
      typeof options.payload === 'string'
        ? options.payload
        : JSON.stringify(options.payload);

    const job = await prisma.activityDeliveryJob.create({
      data: {
        activityId: options.activityId,
        activityType: options.activityType,
        actorUri: options.actorUri,
        targetInboxUrl: options.targetInboxUrl,
        payloadJson,
        status: 'PENDING',
        maxAttempts: options.maxAttempts ?? 5,
      },
    });

    return job.id;
  }

  /**
   * Processes a single batch of ready jobs immediately
   */
  public async processBatchNow(batchSize = 10): Promise<{ processed: number; completed: number; failed: number }> {
    if (this.isProcessing) {
      return { processed: 0, completed: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let completed = 0;
    let failed = 0;

    try {
      const now = new Date();
      const jobs = await prisma.activityDeliveryJob.findMany({
        where: {
          status: 'PENDING',
          nextRunAt: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });

      for (const job of jobs) {
        processed++;
        const success = await this.deliverJob(job);
        if (success) {
          completed++;
        } else {
          failed++;
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, completed, failed };
  }

  /**
   * Attempts delivery of a single job
   */
  private async deliverJob(job: any): Promise<boolean> {
    // 1. Mark status PROCESSING
    await prisma.activityDeliveryJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' },
    });

    // 2. Validate SSRF on destination inbox URL
    const allowTesting =
      process.env.NODE_ENV === 'test' ||
      process.env.ALLOW_HTTP_FEDERATION === 'true';

    const ssrfCheck = await ssrfProtectionGuardService.isSafeUrl(job.targetInboxUrl, {
      allowPrivateForTesting: allowTesting,
    });
    if (!ssrfCheck.safe) {
      await prisma.activityDeliveryJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          lastError: `SSRF_GUARD_BLOCKED: ${ssrfCheck.error}`,
        },
      });
      return false;
    }

    // 3. Resolve keypair for the signing actor
    let keyId: string;
    let privateKeyPem: string;

    try {
      if (job.actorUri.endsWith('/actor')) {
        const instanceKey = await activityPubKeyManagerService.getOrCreateInstanceKey();
        keyId = instanceKey.keyId;
        privateKeyPem = instanceKey.privateKeyPem;
      } else {
        // Extract username from actorUri (.../users/:username)
        const parsed = new URL(job.actorUri);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const username = pathParts[1] || pathParts[0];

        const user = await prisma.user.findFirst({
          where: { username: { equals: username, mode: 'insensitive' } },
        });

        if (!user) {
          throw new Error(`Author user for actorUri '${job.actorUri}' not found`);
        }

        const userKey = await activityPubKeyManagerService.getOrCreateUserKey(
          user.id,
          user.username
        );
        keyId = userKey.keyId;
        privateKeyPem = userKey.privateKeyPem;
      }
    } catch (err: any) {
      await this.handleJobFailure(job, `SIGNING_KEY_ERROR: ${err?.message}`);
      return false;
    }

    // 4. Sign outbound HTTP request
    const signedHeaders = httpSignatureSignerService.signPostRequest({
      keyId,
      privateKeyPem,
      targetUrl: job.targetInboxUrl,
      payload: job.payloadJson,
    });

    // 5. Perform HTTP POST delivery with SSRF protection, DNS rebinding defense and size bounds
    try {
      const response = await ssrfProtectionGuardService.safeFederatedFetch(job.targetInboxUrl, {
        method: 'POST',
        headers: signedHeaders as any,
        body: job.payloadJson,
        timeoutMs: 5000,
        maxResponseSizeBytes: 512 * 1024,
        allowPrivateForTesting: allowTesting,
      });

      if (response.ok || response.status === 202 || response.status === 200 || response.status === 201) {
        await prisma.activityDeliveryJob.update({
          where: { id: job.id },
          data: {
            status: 'COMPLETED',
            updatedAt: new Date(),
          },
        });
        return true;
      } else {
        const responseText = await response.text().catch(() => '');
        await this.handleJobFailure(
          job,
          `HTTP ${response.status}: ${responseText.slice(0, 500)}`
        );
        return false;
      }
    } catch (err: any) {
      await this.handleJobFailure(job, `NETWORK_ERROR: ${err?.message || 'Connection failed'}`);
      return false;
    }
  }

  /**
   * Exponential backoff and failure tracking
   */
  private async handleJobFailure(job: any, errorMsg: string): Promise<void> {
    const attempts = job.attempts + 1;

    if (attempts >= job.maxAttempts) {
      await prisma.activityDeliveryJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          attempts,
          lastError: errorMsg,
          updatedAt: new Date(),
        },
      });
    } else {
      // Exponential backoff: 2^attempts * 5s (5s, 10s, 20s, 40s...)
      const delayMs = Math.pow(2, attempts) * 5000;
      const nextRunAt = new Date(Date.now() + delayMs);

      await prisma.activityDeliveryJob.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          attempts,
          nextRunAt,
          lastError: errorMsg,
          updatedAt: new Date(),
        },
      });
    }
  }
}

export const activityDeliveryWorkerService = new ActivityDeliveryWorkerService();
