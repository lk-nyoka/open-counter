import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { LockPort } from "../ports.js";

/**
 * Slot locks. One item per grid unit: { businessId, slotStart, bookingId, ttl }.
 * No customer data here. ttl = appointment end + 24h (set by the caller), so a lock can never
 * expire while its appointment is still in the future.
 */
export class DynamoLocks implements LockPort {
  private doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  constructor(private table = process.env.LOCKS_TABLE ?? "open-counter-locks") {}

  async acquire(businessId: string, units: string[], bookingId: string, ttl: number): Promise<boolean> {
    // A transaction holds at most 100 items; 600 min / 15 min = 40, so one call is enough.
    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: units.map((slotStart) => ({
            Put: {
              TableName: this.table,
              Item: { businessId, slotStart, bookingId, ttl },
              // Free, or already ours (lets a retry resume after a crash).
              ConditionExpression: "attribute_not_exists(businessId) OR bookingId = :b",
              ExpressionAttributeValues: { ":b": bookingId },
            },
          })),
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const reasons = err.CancellationReasons ?? [];
        // Only treat a conditional failure as "taken". Throttling etc. must surface as errors.
        if (reasons.some((r) => r.Code === "ConditionalCheckFailed") && reasons.every((r) => r.Code === "ConditionalCheckFailed" || r.Code === "None")) return false;
      }
      throw err;
    }
  }

  async release(businessId: string, units: string[], bookingId: string): Promise<void> {
    await Promise.all(
      units.map((slotStart) =>
        this.doc
          .send(
            new DeleteCommand({
              TableName: this.table,
              Key: { businessId, slotStart },
              ConditionExpression: "bookingId = :b", // never delete someone else's lock
              ExpressionAttributeValues: { ":b": bookingId },
            }),
          )
          .catch((e) => { if (!(e instanceof ConditionalCheckFailedException)) throw e; }),
      ),
    );
  }
}
