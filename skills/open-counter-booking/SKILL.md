---
name: open-counter-booking
description: Book, reschedule or cancel an appointment at an independent local business (barber, salon, groomer, studio) through Open Counter's MCP server. Use when a person asks to book or cancel a visit at a business on Open Counter, or asks what a business offers, costs or when it is free.
---

# Booking through Open Counter

Open Counter is an MCP server (spec 2025-11-25, Streamable HTTP). It understands nothing itself: you understand the person, and the server checks every rule before anything is booked. Follow this flow exactly. It keeps people from being booked into something they did not agree to.

## Connect

- Any listed business: `https://open-counter.opencounter.workers.dev/mcp` (start with `find_business`, then pass its `business` id to every other tool).
- One business: `https://open-counter.opencounter.workers.dev/mcp/<business-id>` (same tools, no `business` argument).

## Flow

1. **Find the business.** Call `find_business` with the name or the service in the person's own words ("Corner Cuts", "haircut"). If several match, ask which one. If none match, say so and read the `message`; never guess a business.
2. **Know what it offers.** Call `get_business_info`. Use only the services, prices and hours it returns. A service with `bookableByVoice: false` must be booked directly with the business; say so and stop.
3. **Find a time.** Call `check_availability` with a `serviceId` and a `date` (YYYY-MM-DD in the business's time zone). Offer two to four times from `slots[].spoken`. Never offer a time that is not in `slots`.
   - No slots? The result explains why in `message` and gives `nextAvailable`. Read the message and offer the next time.
4. **Read back, then wait for yes.** Call `book` with `customerConfirmed: false`. Say the returned `message` (service, day, time, price, name) and wait for a clear yes. "Maybe", silence or a question is not a yes.
5. **Book.** After the yes, call `book` again with the same details, `customerConfirmed: true`, and an `idempotencyKey` (any 8 to 64 character string). If the call times out, retry with the **same** key; it will never double-book.
6. **Confirm.** Say the `summary`. It includes the six-character booking `code` (like "K7P-Q2M") spelled out; the person needs it, with their name, to cancel. Keep the `bookingId` too if you can store it. On a screen, the booking card shows the code with the receipt of checks.

## When the server says no

Every refusal sets `isError`, a `code`, a plain-language `message`, and `failedCheck` naming the rule that failed:

| failedCheck | What to do |
|---|---|
| `confirmed` | You have not got a yes yet. Read back and ask. |
| `free` or `lock` | The time was just taken. Call `check_availability` again and offer new times. |
| `notice`, `open` | The time breaks the business's rules. Offer `nextAvailable` or other slots. |
| `voice` | This service must be booked directly with the business. |
| `accepting` | The business has paused assistant bookings. Suggest contacting them. |

`code: "rate_limited"` means too many bookings in a short time; do not retry in a loop.

## Cancel

Call `cancel` with the `bookingId` if you have it. Otherwise ask for the six-character booking code and the name the booking is under, and call `cancel` with `code` and `customerName`. A wrong code or name returns `not_found`; ask them to read the code again. Say the returned `summary`.

## Never

- Invent a time, price, service or business.
- Call `book` with `customerConfirmed: true` before the person said yes to the read-back.
- Read an ISO timestamp aloud. Use `spoken`, `when` and `summary`.
