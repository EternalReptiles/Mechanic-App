# Spannr – what's next

## Now (using it at LNC)
- [ ] Use Spannr for real jobs at LNC and note anything slow, missing or annoying
- [ ] Rename the new Stripe account "LNC – Spannr payments" so it's clear which is which
- [ ] Request Apple's **distribution** Tap to Pay entitlement – app changes done; record the 3 videos (new user, existing user, checkout) + fill in Apple's checklist, upload, reply to Apple's email (needed for TestFlight and the App Store); a screen recording of a real payment helps
- [ ] Re-run the iPhone app from Xcode every ~7 days (development builds expire) until TestFlight is set up

## Before selling to other mechanics
- [ ] Company: accountant chat → ASIC registration → company ABN/TFN/GST, bank account
- [ ] **Put the company name and ABN into spannr.au/terms and spannr.au/privacy** (replace "[legal name of the business or company]" and "[ABN]" – send them to Claude once the company is registered)
- [ ] Move Spannr's Stripe account and Apple developer account to the company (convert the Apple account, don't open a new one)
- [ ] Lawyer review of spannr.au/terms and spannr.au/privacy → fill in the legal name/ABN/state → remove the "Draft" notes
- [ ] Proper mailbox for @spannr.au (replace Cloudflare forwarding)
- [x] **"Connect your existing Stripe account"** option on Card payments (OAuth) – needs STRIPE_CONNECT_CLIENT_ID + redirect URI in Stripe
- [x] Automatic deletion of closed business accounts after 90 days (promised in the Terms/Privacy)
- [x] Show the fee breakdown on paid jobs (Stripe fee, Spannr fee, you receive)
- [x] Text allowance counted per 160-character part, real ClickSend cost per business on the admin page, 80%/100% alerts

## Launch
- [ ] App Store Connect app (au.spannr.app), TestFlight for LNC techs and the first workshops
- [ ] Cloud builds (e.g. Codemagic) once the Mac's Xcode is too old for App Store submissions
- [ ] App Store listing: screenshots, description, privacy answers; set iPhone-only
- [ ] Marketing: Instagram, mechanic Facebook groups, Google, word of mouth

## Built recently
- [x] Two-way texts, Messages inbox, reply Y/C to booking texts
- [x] Push notifications (customer texts, failed payments, new online bookings)
- [x] Online booking page (app.spannr.au/book/<slug>)
- [x] Apple Tap to Pay review: requirements built, videos + checklist sent (waiting on Apple)

## Next to build
- [x] Google review requests after paid jobs
- [x] Reports (takings, owing, jobs, average job value, top customers, technicians)
- [ ] Import from MechanicDesk / ServiceM8 exports
- [x] Stock & purchase orders
- [x] Technician timesheets (clock on/off per job)
- [x] AI assistant (voice notes → job notes, inspection → quote, draft text replies) – needs ANTHROPIC_API_KEY in Supabase secrets

## Integrations (need partner/developer accounts first)
- [ ] **Xero** (paid developer tiers – no free tier): when ready, create the app at developer.xero.com (redirect `https://app.spannr.au/settings/accounting/xero`) → Client ID + XERO_CLIENT_SECRET; build connect + sync of invoices, payments and customers
- [ ] **MYOB** (Developer Access $110 is enough; Developer Partner $220 includes a live MYOB Business Pro subscription): register at developer.myob.com (redirect `https://app.spannr.au/settings/accounting/myob`) → API key + MYOB_CLIENT_SECRET; then the same sync
- [ ] Free stopgap: Settings → Accounting → export invoices & payments (CSV) for MYOB/Xero import or the bookkeeper
- [ ] **Parts suppliers**: Burson **EzyParts** and Repco **Navigator Pro** – apply for their workshop-software integration programme; then a "Look up parts" button that brings chosen parts and prices back onto the job

## Later
- [ ] Android app (project is ready in `android/`)
- [ ] Stripe card readers (WisePOS E / S700) sent from the desktop
- [ ] Linkly / Tyro integration so workshops can keep their existing EFTPOS machines
- [ ] Businesses sending email from their own domain (top plan)
