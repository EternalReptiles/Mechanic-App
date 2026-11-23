# Mechanic App

Job management for a mobile mechanics business: customers, vehicles, bookings, quotes, tax invoices and job photos. It runs as an installable web app (PWA) on a phone, tablet or computer, and keeps working offline.

## Features

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

You can host `dist/` on any static web host (Netlify, Vercel, Cloudflare Pages). Open the site on your phone and choose **Add to Home Screen** to install it.

## Where data is stored

For now, all data is stored on the device in the browser's IndexedDB. Use **Settings → Download backup** regularly, and use the backup to move to a new device. ## Roadmap

1. ✅ Mechanic workflow: price list, inspections, signatures, reminders, finding customers by rego.
2. Cloud accounts and sync: sign-up, separate data for each business, staff logins, sync between devices (Supabase).
3. Customer messages and payments: automatic email and SMS, online quote approval, card payment links (Stripe), Xero export.
4. Selling it: monthly subscriptions (Stripe Billing), a marketing and sign-up site, and onboarding for new shops.
