# Spannr iPhone app – running it on your iPhone

The iPhone app is the same Spannr app you use on the web, packaged as a real app so it can use **Tap to Pay on iPhone** (the customer taps their card, phone or watch on your phone, with no card reader).

Everything is already set up in the project (`ios/` folder). You only need a Mac with Xcode to build it.

## One-time setup on your Mac

1. **Install Xcode** from the Mac App Store (free, about 15 GB, so it takes a while). Open it once and let it install its extra parts.
2. **Install Node.js** from nodejs.org, using the **LTS** button.
3. **Get the project.** The easiest way is **GitHub Desktop** (desktop.github.com):
   sign in → **File → Clone repository** → `EternalReptiles/Mechanic-App` → Clone.
4. Open **Terminal** (press Cmd+Space and type "Terminal"), then run these, one line at a time:

   ```sh
   cd ~/Documents/GitHub/Mechanic-App
   npm install
   npm run build
   npx cap sync ios
   npx cap open ios
   ```

   The first line goes to wherever GitHub Desktop saved the project, which is usually `Documents/GitHub/Mechanic-App`. The last line opens the project in Xcode.

## Run it on your iPhone

1. Plug your iPhone into the Mac with a cable. On the iPhone, tap **Trust**.
2. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode** and restart when asked.
3. In Xcode, in the left panel, click **App** (the blue icon at the top), then the **Signing & Capabilities** tab:
   - Tick **Automatically manage signing**.
   - **Team:** choose your Apple Developer account. Add it under Xcode → Settings → Accounts if it isn't listed.
   - The **Bundle Identifier** is already `au.spannr.app`.
4. At the top of Xcode, pick **your iPhone** as the device, then press the **▶ Run** button.
5. The first time, the iPhone may say the developer isn't trusted. Go to **Settings → General → VPN & Device Management → your Apple ID → Trust**, then press ▶ again.

Spannr opens on your phone. Sign in with your normal Spannr login, and all your jobs and customers are there.

## Turning on Tap to Pay

Apple has to approve Tap to Pay for your developer account first.

1. **Request it:** developer.apple.com → Account → **Tap to Pay on iPhone** entitlement request. Describe Spannr as job management software for mechanics that takes in-person card payments through Stripe.
2. **When Apple approves it:** in Xcode → **Signing & Capabilities** → **+ Capability** → **Tap to Pay on iPhone**. Then press ▶ Run again.
3. In Spannr, open a job with labour or parts on it → **Billing** → **📲 Tap to Pay**.
   - The first time, Apple shows its Tap to Pay terms. Accept them with your Apple ID.
   - The customer taps their card, phone or watch on the top of your iPhone.
   - The job is marked **Paid** and the customer gets the receipt by text and email.

**Test mode:** while Spannr uses Stripe's test keys, payments are simulated, so no real money moves. Stripe's simulated reader may let you try the whole flow before Apple's approval comes through.

## After changing the app

Whenever the app has been updated (GitHub Desktop → **Fetch origin → Pull**), run:

```sh
npm install
npm run build
npx cap sync ios
```

Then press ▶ Run in Xcode again.

## Good to know

- **Subscriptions:** Apple doesn't allow buying a subscription through Stripe from inside an iPhone app, so the iPhone app only *shows* the plan. Businesses choose or change their plan on the web at app.spannr.au.
- **Putting it on the App Store** comes later: App Store Connect → new app with bundle ID `au.spannr.app`, then in Xcode **Product → Archive → Distribute**. For that you'll need Apple's *distribution* Tap to Pay approval and, ideally, the Apple account moved to your company.
- **Android:** the `android/` folder is ready too. It opens in Android Studio (`npx cap open android`) once you have an Android phone to test on.
