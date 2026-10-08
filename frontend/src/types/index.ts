export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: number;
  bookableByVoice: boolean;
  description?: string;
}

export interface BusinessHour {
  day: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  open: string; // "09:00"
  close: string; // "18:00"
}

export interface BusinessRules {
  minNoticeMin: number; // e.g. 60 min
  maxAdvanceDays: number; // e.g. 30 days
  slotGranularityMin: number; // e.g. 15 min
  bufferMin: number; // e.g. 5 min
}

export interface BusinessLinks {
  assistant: string;
  booking: string;
  mcp: string;
  directory?: string;
}

export interface Business {
  slug: string;
  name: string;
  timezone: string;
  currency: string; // "USD", "EUR", "GBP", "ZAR", etc.
  hours: BusinessHour[];
  services: Service[];
  minNoticeMin: number;
  maxAdvanceDays: number;
  slotGranularityMin: number;
  bufferMin: number;
  acceptingBookings: boolean;
  /** Findable through the shared Open Counter directory (one Alexa+ add-on for every business). */
  listed?: boolean;
  calendar: 'google' | 'internal' | 'shared';
  links: BusinessLinks;
  description?: string;
  address?: string;
  phone?: string;
}

export interface Booking {
  id: string;
  businessSlug: string;
  serviceId: string;
  serviceName: string;
  price: number;
  start: string; // ISO 8601 with offset
  end: string; // ISO 8601 with offset
  startLocal: string; // "Wednesday 7 October at 2:00 pm"
  customerName: string;
  customerPhone?: string;
  channel: 'voice' | 'web' | 'mcp' | 'owner';
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface BusinessStats {
  today: {
    bookings: number;
    revenue: number;
  };
  week: {
    bookings: number;
    revenue: number;
    cancelled: number;
  };
  upcoming: number;
  byChannel: {
    voice: number;
    web: number;
    mcp: number;
    owner: number;
  };
  next: Booking | null;
}

export interface Slot {
  start: string;
  end: string;
  startLocal: string;
}

export interface AvailabilityResponse {
  ok: boolean;
  code?: string;
  message?: string;
  slots: Slot[];
}

export interface Merchant {
  id: string;
  email: string;
  name: string;
  picture?: string;
  demo: boolean;
  hasGoogle: boolean;
}

export interface BusinessDraft {
  name?: string;
  currency?: string;
  timezone?: string;
  services?: Service[];
  hours?: BusinessHour[];
  minNoticeMin?: number;
  maxAdvanceDays?: number;
  slotGranularityMin?: number;
  bufferMin?: number;
  phone?: string;
  address?: string;
  askedVoice?: boolean;
  askedRules?: boolean;
  extra?: number;
}

export interface AssistantUnderstanding {
  intent: 'book' | 'services' | 'price' | 'hours' | 'cancel' | 'thanks' | 'greeting' | 'none';
  serviceId?: string | null;
  serviceOptions?: string[];
  date?: string | null; // YYYY-MM-DD
  time?: string | null; // HH:MM
  partOfDay?: 'morning' | 'afternoon' | 'evening' | null;
  name?: string | null;
  bookingId?: string | null;
  yes?: boolean;
  no?: boolean;
  choice?: number | null; // 1-based, or -1 for last
  today?: string;
}
