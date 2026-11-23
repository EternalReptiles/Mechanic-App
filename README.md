# Mechanic App

Job management for a mobile mechanics business: customers, vehicles, bookings, quotes, tax invoices and job photos. It runs as an installable web app (PWA) on a phone, tablet or computer, and keeps working offline.

## Features

- **Dashboard**: money owing, overdue invoices, paid this month, a count of jobs at each stage, and today's and tomorrow's bookings.
- **Jobs**: each job moves through Quote → Scheduled → In progress → Completed → Invoiced → Paid, with one tap per step. You can search by name, rego, job number or address.
- **Job card**: customer and vehicle (rego, make, model, VIN, odometer), booking time, job address, problem description, work notes, labour and parts line items with GST, and photos taken with the phone camera.
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

For now, all data is stored on the device in the browser's IndexedDB. Use **Settings → Download backup** regularly, and use the backup to move to a new device. Cloud sync and multiple staff logins are planned for a later version.
