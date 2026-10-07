/** 32 lowercase hex chars: valid as a Google Calendar event id and unguessable. */
export const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
