# SOS Booking Checker

**Version:** 3.5 · **Sites:** webmail.sosphonerepairs.com.au · app.sospos.com.au

> **Status: Working — under active development.** Core email monitoring and notification badge are functional. Automated ticket creation and AI email templates are planned.

Monitors your Roundcube webmail for incoming Book-a-Repair emails and displays them as live notifications inside SOS POS. Never miss a repair booking.

---

## How It Works

Keep **both** tabs open at the same time — Roundcube watches the inbox, SOS POS displays the bookings.

### On Roundcube (webmail.sosphonerepairs.com.au)

- Watches the inbox for booking confirmation emails in the background
- Parses booking details from the email content
- Stores the data in shared Tampermonkey storage so SOS POS can read it

### On SOS POS (app.sospos.com.au)

- Listens for new bookings via `GM_addValueChangeListener`
- Shows a notification badge with the number of unread booking emails
- Displays booking details in a panel on the bottom-left of the screen

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome
2. Click **Raw** on the `.user.js` file in this repo
3. Tampermonkey will prompt to install — click **Install**
4. Keep **both** Roundcube webmail and SOS POS open in Chrome tabs

---

## Planned Features

- **Auto ticket creation** — automatically create a SOS POS ticket from the booking email
- **Pre-written email templates** — reply templates based on the situation, with prices pulled from Google Sheets
- **AI assistant** — lightweight AI (server or website-hosted) to suggest the right reply and prompt for confirmation before sending

If you are interested in any of these features, open an Issue and it will be prioritised.

---

## Notes

- Both tabs must be open simultaneously for the bridge to work
- Uses Tampermonkey cross-tab storage (`GM_setValue` / `GM_addValueChangeListener`) — no server required
- Runs at `document-idle` to avoid slowing page load

---

## Using Multiple Scripts

If you are using several of the THVjQ Tampermonkey scripts, check the **Issues** tab — a multi-script addon with live updates across all scripts is in progress.
