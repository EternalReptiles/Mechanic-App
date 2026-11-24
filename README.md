# Spannr

Job management for mobile mechanics and workshops: customers, vehicles, bookings, quotes, tax invoices and job photos. It runs as an installable web app (PWA) on a phone, tablet or computer, and keeps working offline.

## Features

- **For mobile mechanics, workshops, or both.** Each job is marked "at customer" or "in workshop". Workshop jobs have a check-in (key tag, drop-off, promised-by time, collected), a one-tap "Car's ready" text, and a **workshop board** showing every car by stage: Booked in, In progress, On hold, Ready for pickup.
- **Video walk-around.** Record the car in the app (or choose a video), list the recommended work with priorities and prices (flagged inspection items are filled in automatically), and text or email a link. The customer watches, taps Yes or No for each item, and signs, with no app or login. You get a dashboard alert, a one-tap "add approved work to job", and a printable approval record (time, IP address, device, signature, and a SHA-256 fingerprint of what was shown). The quote is locked once sent, and the response is locked once signed.
- **Remote sign-off.** From the Billing tab, send the quote (before work) or the finished job (after work) to the customer's phone. They see the itemised amount (and the payment due date for a sign-off), tick to agree to your terms & conditions, and sign. The signed record captures exactly what they agreed to.
- **Terms & conditions.** These are editable in Settings and shown on every sign-off and walk-around. The defaults cover payment due date, approved work only, customer-supplied parts, existing faults and declined work, parts warranty, and the Australian Consumer Law statement. Have a lawyer review them.
- **Teams.** Owners invite staff by email as Admin or Technician. Jobs can be assigned to a technician, who can filter to "My jobs". Technicians don't see takings or business settings.
- **Cloud sync that works without signal.** Data is saved on the device first and synced when there's reception, with a status badge. Photos sync through private cloud storage.

- **Dashboard**: money owing, overdue invoices, paid this month, a count of jobs at each stage, and today's and tomorrow's bookings.
- **Jobs**: each job moves through Quote → Scheduled → In progress → Completed → Invoiced → Paid, with one tap per step. You can search by name, rego, job number or address.
- **Job screen with tabs** (Details, Inspection, Billing, Photos & sign) and one big "next step" button. Changes save automatically.
- **Find anything with one search box**: type a name, phone number or rego to pick the customer and the car. New customers and vehicles can be added without leaving the job.
- **Price list and service packages**: save common jobs (for example "Logbook service – 4 cyl" with labour, oil and filter) and add them to a job in one tap.
- **Vehicle inspection**: a checklist with OK / Soon / Urgent / N/A buttons and notes. Flagged items print on the invoice as recommended work, and there's a separate inspection report for the customer.
- **Customer signature**: the customer signs on screen with a finger. The signature appears on the quote and invoice.
- **Service and rego reminders**: track the next service date and km and the rego expiry for each vehicle. The reminders list has a pre-written text message and a one-tap "Book job" button.
- **Payment recording**: mark a job paid by cash, card or bank transfer. The invoice then shows it as paid.
- **On the road**: one tap to call the customer, text them "on my way", or get directions in Google Maps.
- **Quotes and tax invoices**: include your logo, ABN, GST breakdown, due date and bank details. Print them or save them as a PDF, or send them with the share button.
- **Schedule**: a week view of bookings, plus a list of jobs that are not booked yet.
- **Customers**: contact details, their vehicles and full job history.
- **Settings**: business details, logo, labour rate, GST on or off, payment terms, invoice numbering, and backup and restore.

## Running it

```bash
npm install
npm run dev       # development server
npm run build     # production build in dist/
```

**Live site:** https://spannr.netlify.app. To publish a new version, run `NETLIFY_AUTH_TOKEN=… ./scripts/deploy-netlify.sh`. Open the site on your phone and choose **Add to Home Screen** to install it.

## Architecture

- **Front end:** React, TypeScript and Vite, installable as a PWA. Data lives in IndexedDB (Dexie) so the app works offline.
- **Back end:** Supabase (Postgres, Auth and Storage), Sydney region. The schema is in `supabase/migrations/`.
- **Sync** (`src/cloud/sync.ts`): every local write is stamped and marked dirty by Dexie middleware (`src/db.ts`). Pushes are upserts; the server keeps the newest `updated_at` (last write wins). Pulls fetch rows changed since the last cursor by server timestamp, with an overlap window. Deletions sync as tombstones.
- **Security:** row-level security on every table limits users to their own business. Signed-in users get the minimum table permissions; anonymous visitors get none. Job numbers are allocated by the server (`allocate_job_number`) so they stay unique across devices.
- **Config:** `.env` holds the public Supabase URL and publishable key. These are safe to commit because access is enforced by the database. Never commit the secret or service-role key. ## Roadmap

1. ✅ Mechanic workflow: price list, inspections, signatures, reminders, finding customers by rego.
2. ✅ Cloud accounts and sync: sign-up, separate data for each business, staff logins, sync between devices (Supabase).
3. ✅ Workshop mode: check-in, workshop board, technician assignment, "Car's ready" texts, On hold status.
4. ✅ Video walk-around: record a video, send it with a quote, and the customer approves or declines each item and signs online.
5. Customer messages and payments: automatic email and SMS, online quote approval, card payment links (Stripe), Xero export.
6. Selling it: monthly subscriptions (Stripe Billing), a marketing and sign-up site, and onboarding for new shops.
