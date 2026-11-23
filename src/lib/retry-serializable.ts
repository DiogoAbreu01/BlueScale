/**
 * Bound retries to Prisma P2034 (transaction aborted because of a serialization
 * conflict or deadlock). The callback must be a fully atomic transaction:
 * NEVER wrap emails, external requests or other non-rollbackable side effects.
 *
 * A genuinely stale optimistic revision remains a normal HTTP 409 and is
 * never retried; each attempt must re-read the version within the transaction.
 */
export async function retrySerializable<T>(
  transaction: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction();
    } catch (error) {
      const isPrismaConflict = error instanceof Error
        && 'code' in error
        && error.code === 'P2034';
      if (!isPrismaConflict || attempt >= maxRetries) throw error;

      // Bounded backoff avoids retrying immediately into the same contention.
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(25 * 2 ** attempt, 150)));
    }
  }
}
