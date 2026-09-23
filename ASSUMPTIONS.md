# Assumptions

Decisions made about how the business works, without being able to ask. Each one is easy to change. Tell us which are wrong.

## Stores and people
- **Store names:** the 3 stores are called *Inter-Diesel Ibanda*, *Kadutu* and *Bagira*, with the codes IBA / KAD / BAG used in receipt numbers. The real names, addresses and WhatsApp numbers can be changed in Menu → Magasins.
- **Staff:** each store has 1 manager and several sellers. The owner sees and manages all stores. Only the owner creates users, changes roles and manages stores.
- **Owner on a store phone:** when the owner uses a store's phone, they act as that store's manager. Their full rights (users, stores, all-store reports) are only available on the owner's own all-store device. This is a security rule: PINs can only be checked on the phone.
- **Connecting a device:** each phone or computer is connected once, with internet, by the manager (for their store) or the owner. Sellers only use a 4–6 digit PIN.
- **Auto-lock:** a phone left idle for 20 minutes locks back to the PIN screen.

## Money
- **Base currency:** reference prices are in US dollars. Every sale, repayment and cash close stores the exchange rate it used.
- **Exchange rate:** one rate for all 3 stores, set by a manager or the owner (Menu → Taux du jour). The demo starts at 2,300 FC per $ (the market rate on 23 Sep 2026 was about 2,310).
- **Franc prices:** rounded up to the nearest 50 FC. A product can have a fixed franc price. If a sale paid in cash francs at fixed franc prices comes to slightly less than the dollar price, the difference is recorded as a discount.
- **Mobile Money in dollars:** the quick buttons record M-Pesa, Airtel Money and Orange Money in dollars. Mobile Money in francs goes through "Autre montant / paiement mixte".
- **Change:** change is given in cash, in the currency of the cash payment. Differences smaller than 50 FC are treated as rounding, not change.
- **Refund of a cancelled sale:** paid in cash dollars on the day of the cancellation, and deducted from that day's expected cash.
- **Customer debt** is tracked in dollars.
- **Debts are shared across stores:** a customer can buy on credit in one store and pay in another.
- **Credit limit:** set per customer, by managers only. Going over the limit is shown in red and needs an explicit "Confirmer malgré le plafond" (confirm despite the limit). It never blocks the sale, because it may be offline and the manager may have agreed.
- **Discounts** are allowed for everyone at the counter (sale amount or %, or by editing the unit price). Each one is recorded on the sale and shows in reports. There is no maximum discount per role yet.
- **Supplier debts** (buying on credit from suppliers) are not tracked. Purchases only add stock and update the cost price.

## Stock
- **Stock is kept per store.** Products, prices and fitments are shared by all 3 stores. The minimum stock (low-stock alert level) is set per store.
- **A sale is never refused** because the system shows no stock. Stock can go negative (for example, a sale made offline, or a delivery not entered yet). Negative stock is flagged to the manager (Alertes, Stock → À vérifier).
- **Store devices can see other stores' stock levels,** to know who to ask for a transfer, but not their sales or cash.
- **Transfers:** stock leaves the sending store when the transfer is sent and enters the receiving store when the receiving store confirms what actually arrived. Any difference is flagged to both stores.
- **Inventory count:** the system adjusts stock by the difference between what was counted and what the device knew at that moment.
- **Adjustments** (breakage, loss, returns) need a reason and a written explanation. Managers only.
- **Barcodes:** products without a factory barcode are found by reference or name. The demo references marked `ID-` are internal codes. The OEM-style numbers in the demo are for illustration only and must be checked against the real stock.

## Receipts and printing
- **Receipt numbers:** `STORE-DEVICE-NNNN` (e.g. `IBA-02-0015`). They are unique without internet because each device has its own code.
- **Printing** uses the 58 mm format and the phone's or computer's print function. On Android, Bluetooth thermal printers need a print service app such as RawBT. This could not be tested without a printer.
- **Sharing:** the WhatsApp receipt is an image (384 px wide) or text.

## Data and time
- **Business days** follow Bukavu time (UTC+2), whatever the phone's time zone setting.
- **Reports on a store device** (manager) cover that store only. The owner's device can show one store or all.
- **Sellers** only see their own sales of the day, not store reports or margins.
- **Product photos** are reduced to about 360 px (roughly 20–40 KB) to save mobile data. They are synced to every device.
- **Seed data:** the demo customer and staff names are invented. The demo data is meant for training and evaluation. For real use, start with `npm run init`, which creates an empty catalog.
