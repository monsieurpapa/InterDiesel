---
name: growth-playbook
description: Brute-force customer-acquisition playbook (multi-channel launches, warm outbound, UGC creators, community seeding, trend-jacking) for getting a product's first 100 customers. Use when the user asks about getting customers, growth hacking, GTM, launch strategy, marketing, distribution, or "how do I get users" for any project in this workspace.
---

# Growth Playbook — first 100 customers

Source: adapted from a YC-style customer-acquisition thread (X/Twitter). Original tactics assume a global, English-speaking, tech-forward audience (Product Hunt, LinkedIn, TikTok/US creators). Half the products in this workspace sell to that audience; the other half sell to Goma/Kivu residents on WhatsApp and Mobile Money. **Pick the track that matches the product before handing back a plan — don't recite the tweet verbatim.**

## Step 0: classify the product

- **Track A — Global/B2B reach.** Buyers are English-reachable, online, often outside DRC (EU coffee/cocoa buyers, exporters, NGOs/donors, other developer platforms). Fits: `jumelleCafe`, `BeanPath`/`beanspath`, `co3data`, `coopmanager` (Cooppro), `AgriSight`, `CongoCSPC` (hospitals/NGO/donor angle).
- **Track B — Hyperlocal Goma/Kivu.** Buyers are in-region, phone-number-identified, reached via WhatsApp/Mobile Money/local social, not Product Hunt. Fits: `kivukazi`, `kazi`, `TicketNavigator`, `aryv logistics`, `eazyconnect`, `cafekivucongo`, `boutique`, `chantierMobile`.
- If the product is a single-client internal tool (e.g. `comptable` for AVUDS, `heritage-app`, `Patrimoine`, `fikiri_id` as internal IdP), this playbook mostly doesn't apply — there's no open market to acquire from. Say so instead of forcing it.
- If genuinely unsure which track, ask the user rather than guessing — the tactics diverge a lot.

## The 7 tactics

### 1. Launch-max
Launch the same product on multiple discovery surfaces, minimum 3 times over the product's life (initial launch, major feature, milestone/traction).
- **Track A**: Product Hunt, Hacker News (Show HN), DevHunt, BetaList, Peerlist, Indie Hackers. Time launches to real milestones, not just "we exist."
- **Track B**: there is no local Product Hunt. Equivalents: WhatsApp broadcast lists, Goma/Bukavu Facebook community groups, local radio spots, partner storefronts (kiosks/cybercafés for `eazyconnect`), church/market association announcements, moto-taxi stand partnerships. "Launch 3x" still applies — relaunch at real milestones (new zone, new feature, price drop).

### 2. Steal competitors' distribution
Find where competitors get their strongest traffic/listings and get listed there too — supplement or outright replace their content with a better version.
- **Track A**: pull competitor backlinks (ahrefs/similar), find the articles/directories linking to them, pitch a better resource to replace or supplement it.
- **Track B**: there's no SEO ecosystem to mine locally. Instead: find where competitors are *physically* advertised (market boards, radio, moto-taxi stickers, WhatsApp group pins) and out-list them there.

### 3. Warm outbound (the 99% who saw you but didn't come inbound)
Don't just post and wait — systematically follow up with everyone who showed interest.
- **Track A**: scrape people who engage with your posts (LinkedIn likes/comments), filter to ICP, message them directly. Automating this (e.g. with a tool like Origami) is fine, but flag LinkedIn's ToS risk on scraping/auto-DM to the user before wiring it up — don't silently automate something that could get an account banned.
- **Track B**: most of these apps use **phone number as identity** already (see project CLAUDE.md conventions) — warm outbound means WhatsApp/SMS to people who engaged with a Facebook/Instagram post or asked a friend, not LinkedIn scraping. Respect opt-in — DRC has no CAN-SPAM equivalent to hide behind, but unsolicited bulk WhatsApp burns trust fast in a small market.

### 4. UGC creators
Recruit 20–30 creators in-niche, pay a fixed fee ($15–30/video) plus a performance bonus (e.g. $1k per 1M views), ideally posting from fresh/personal accounts rather than a brand account.
- **Track A**: international TikTok/Instagram niche creators (coffee/agtech/traceability audiences).
- **Track B**: this is the tactic that transfers almost unchanged — Goma/Bukavu/Kinshasa TikTok and Instagram creators in the relevant niche (food for `cafekivucongo`, nightlife/hospitality for `aryv logistics`, local services for `kivukazi`/`kazi`). Pay in USD or Mobile Money. Fresh accounts read as more authentic than the brand's own.

### 5. Video > image/text
When building in public, a demo video beats a screenshot or text post, on both X/LinkedIn (Track A) and Facebook/WhatsApp/TikTok (Track B). Always prefer a 20–40s screen-recorded use case over a static post. For a full launch-video plan on X specifically (hook-writing, viral-format research, launch-day network mobilization) — Track A only — see the separate `launch-video` skill.

### 6. Go where customers already are
Identify the specific communities customers spend time in and pay for a shoutout/placement there rather than broadcasting broadly.
- **Track A**: niche Slack/Discord servers, newsletters, podcasts, X accounts your ICP follows.
- **Track B**: WhatsApp groups, church and market associations, university clubs, moto-taxi stands, local radio — sponsor or get introduced, don't cold-blast.

### 7. Ride trends
Fold the product into whatever's trending that week instead of only pushing standalone content — reply, quote, and reuse formats that are already working.
- **Track A**: trending GTM/lead-gen conversations on X in the product's niche.
- **Track B**: trending topics on X/Facebook/TikTok within DRC/Great Lakes region — regional trends move differently from global tech-X trends, don't assume overlap.

## Cadence

This only works run weekly, without stopping: launch/relaunch, post a demo video, contact a fresh batch of leads. Sporadic bursts don't compound. When asked to help with growth, produce a concrete weekly checklist (who to contact, what to post, where to launch) rather than a one-off idea list — and note that once ~100 customers are acquired, the goal shifts from acquisition to retention.

## Caveats to raise, not silently skip

- Scraping/auto-DMing LinkedIn or other platforms can violate their ToS — flag this, don't just wire it up.
- Paying for shoutouts/placements needs the user's sign-off before any outreach or payment goes out — this is a real-world/financial action, not a code change.
- Don't fabricate a target community or creator list — if you don't actually know where a product's DRC customers spend time, say so and ask, rather than inventing plausible-sounding WhatsApp groups.
