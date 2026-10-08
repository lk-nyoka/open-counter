import { AssistantUnderstanding, Business, Slot } from '../types';

// The booking dialog is shared with the backend's own pages and covered by its tests (src/dialog.test.ts).
// Keep this file a thin typed wrapper: never fork the logic.
// @ts-ignore: plain ES module
export { createDialog, sayTime, sayList, toMin, sayCode } from './dialog-core.js';

export interface DialogOptions {
  info: Business;
  tool: (name: string, args: Record<string, any>) => Promise<any>;
  understand: (text: string, awaiting: string | null) => Promise<AssistantUnderstanding>;
}

export interface DialogResponse {
  say: string;
  confirm?: {
    service: string;
    when: string;
    price: number;
    currency: string;
    name: string;
  };
  booked?: any;
  cancelled?: string;
}

export interface DialogState {
  serviceId: string | null;
  date: string | null;
  time: string | null;
  part: 'morning' | 'afternoon' | 'evening' | null;
  name: string | null;
  awaiting: string | null;
  offered: string[];
  suggestDate: string | null;
  today: string | null;
  lastBooking: { id: string; service: string; when: string; on: string; time: string } | null;
  idemKey: string | null;
}

