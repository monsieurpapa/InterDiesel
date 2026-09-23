# WhatsApp

## What works today (no setup, no cost)

Every WhatsApp action uses the phone's own WhatsApp, so it works with the numbers the stores already use and costs nothing:

| Where | What is sent |
|---|---|
| Receipt screen | Receipt as an image (share sheet → pick the chat), or the text straight to the customer's chat if their number is known |
| Rapports → "Envoyer le résumé" | Daily summary per store: sales, margin, cash per payment method, credit, repayments, per seller |
| Clôture de caisse | Cash-drawer close with expected / counted / gaps |
| Stock → Stock bas | Low-stock list for the store (to order or to ask another store) |
| Transferts | Request sent to the other store's WhatsApp number; delivery note for a transfer |
| Client | Debt reminder with the balance in $ and FC |

It also works offline: WhatsApp keeps the message and sends it when the phone reconnects.

All the text is in `shared/messages.ts` and `shared/locales/fr.json`, and goes through one interface (`shared/notify.ts`: `NotificationService` + `NotificationChannel`). The app currently uses two channels: `ShareSheetChannel` and `WaMeChannel` (`src/share.ts`).

## What's ready for automation

`server/notify/whatsapp-cloud.ts` implements the same interface with the **WhatsApp Business Cloud API** (Meta), and `server/notify/jobs.ts` schedules, in Bukavu time:

- 19:30 every day: daily summary of each store → owner's phone (`rapport_journalier`)
- 19:30 every day: low-stock list → each store manager (`stock_bas`)
- Monday 09:00: reminder to customers who owe money for more than 14 days (`rappel_dette`)

They stay off until two settings are filled in `.env`:

```
WHATSAPP_TOKEN=...            # permanent System User token
WHATSAPP_PHONE_NUMBER_ID=...  # id of the business number in Meta
```

The phone numbers used are the ones in the app: owner/managers under Menu → Utilisateurs, customers on their card.

## What Meta requires to turn it on

Checked on 23 September 2026. Meta changes these rules often, so check again before you start.

1. **A Meta Business portfolio** (business.facebook.com) for Inter-Diesel, then a **WhatsApp Business Account** and an app in Meta for Developers with the WhatsApp product.
2. **A phone number** for the API. It can be a new number, or the existing WhatsApp Business app number using Meta's *coexistence* feature (same number on the phone app and the API), which some providers support. Coexistence is not available in every country, so check whether DR Congo numbers qualify.
3. **Business verification** (legal documents: RCCM, national ID number, proof of address). Without it you start at 250 business-initiated conversations per 24 h. Verification raises this to 1,000, and higher tiers follow with good quality ratings. Since October 2025 the limits apply to the whole business portfolio, not to each number.
4. **Display name approval** for the number (e.g. "Inter-Diesel").
5. **Message templates approved by Meta**, in French, before any message the business starts itself. Suggested templates (category *Utility*):
   - `rapport_journalier`: "Ventes du jour — {{1}} — {{2}} : {{3}} ventes, total {{4}}."
   - `stock_bas`: "Stock bas à {{1}} : {{2}} articles sous le minimum. Ouvrez l'application pour la liste."
   - `rappel_dette` (Meta may classify this as Utility or Marketing): "Bonjour {{1}}, votre solde chez Inter-Diesel est de {{2}}. Merci de passer régler dans l'un de nos magasins."
6. **A payment method** in the Meta Business portfolio.

### Cost (per-message pricing since 1 July 2025)

- Charges apply only to **template** messages that are delivered. The rate depends on the category and the recipient's country.
- **Utility** templates are **free** inside an open 24-hour customer service window, i.e. within 24 h after that person last wrote to the business number.
- Replies to customers who wrote first (service messages) are free.
- **Marketing** templates are always charged.
- DR Congo is billed at the "Rest of Africa" / "Other" rate. Look it up in Meta's rate card; utility messages there cost a few US cents each.
- For 3 daily summaries + a few low-stock alerts + ~30 weekly reminders, expect **a few US dollars a month**.

Sources: Meta pricing documentation (developers.facebook.com/documentation/business-messaging/whatsapp/pricing) and public guides on messaging limits (2026). **Not verified:** whether coexistence is available for +243 numbers, and the exact per-message rate for DR Congo.

## Adding another channel later

Implement `NotificationChannel` (`canSend`, `send`) and add it to the `NotificationService` list, in `src/share.ts` for the app or `server/notify/jobs.ts` for the server. For example, SMS via Africa's Talking or a WhatsApp provider such as 360dialog.
