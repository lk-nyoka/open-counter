import { z } from "zod";

/** Business spec: the single artifact the AI interviewer must produce. */
export const ServiceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  durationMin: z.number().int().positive().max(600),
  price: z.number().nonnegative(),
  bookableByVoice: z.boolean().default(true), // false => never bookable by assistant
});

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const BusinessSpecSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  timezone: z.string().min(1), // IANA, e.g. Africa/Johannesburg
  currency: z.string().length(3),
  calendarId: z.string().min(1), // owner's calendar shared with the service account
  hours: z.array(
    z.object({ day: z.number().int().min(0).max(6), open: HHMM, close: HHMM }), // 0 = Sunday
  ),
  minNoticeMin: z.number().int().nonnegative().default(60),
  maxAdvanceDays: z.number().int().positive().max(365).default(60),
  /** Slot grid. Locks are held per grid unit, so this is also the lock resolution. */
  slotGranularityMin: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(15),
  /** Gap kept free after each appointment. */
  bufferMin: z.number().int().nonnegative().max(120).default(0),
  services: z.array(ServiceSchema).min(1),
});

export type BusinessSpec = z.infer<typeof BusinessSpecSchema>;
export type Service = z.infer<typeof ServiceSchema>;
