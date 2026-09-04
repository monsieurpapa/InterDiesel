# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace Overview

This is a multi-project workspace for software products targeting the DRC/Great Lakes region market (primarily Goma). All user-facing text is in **French**. Each sub-directory is an independent project with its own `CLAUDE.md` — consult that file first when working inside a project.

## Active Projects

| Project | Stack | Purpose |
|---------|-------|---------|
| `comptable` | Node.js + Express + PostgreSQL (Supabase) + Bootstrap 5 | NGO accounting for AVUDS |
| `boutique` | Next.js 14 + Supabase + Tailwind | Boutique inventory SaaS (multi-tenant) |
| `chantierMobile` | Django + Celery + PostgreSQL + Docker | Construction site management |
| `kivukazi` | Express + React + Drizzle + Supabase | Service marketplace (Uber-style, Goma) |
| `kazi` | pnpm monorepo: Express + Expo (React Native) + Drizzle + Supabase | Job/service platform, mobile-first |
| `marketintai` | Vite + Firebase/Firestore | Market intelligence app |
| `Patrimoine` | Express + React + Drizzle + PostgreSQL | Patrimony/asset management |
| `coopmanager` | Vite + Firebase/Firestore + TypeScript | Cooperative management |
| `heritage-app` | Vite + Firebase/Firestore | Heritage management |
| `cafekivucongo` | — | Café Kivu Congo web presence |
| `AgriSight` | — | Agriculture intelligence |
| `BeanPath` / `beanspath` | — | Coffee supply chain |
| `KivuSafe` | — | Safety app (Kivu region) |

## Common Patterns Across Projects

**Stack conventions**: Most new projects use Express + React (Vite) + Drizzle ORM + PostgreSQL (via Supabase). Firebase/Firestore is used in some standalone web apps. Django is used only in `chantierMobile`.

**Auth**: Supabase Auth (email/password + Google OAuth) is standard. JWT is verified server-side via the service-role key. Workers/restricted users often require additional role checks beyond the JWT.

**Database access**: All DB queries go through a single `storage.ts` or `db.js` abstraction layer — routes never import the ORM directly.

**Deployment**: Railway or Render for server-side apps; Supabase for PostgreSQL; Replit for rapid iteration.

**Skill routing**: When a request matches a gstack skill (bugs → `/investigate`, shipping → `/ship`, QA → `/qa`, design → `/design-review`, architecture → `/plan-eng-review`), invoke the skill first via the Skill tool before doing anything else. For customer acquisition/GTM/growth/launch questions → invoke `/growth-playbook` (workspace-local, not a gstack skill).

## Growth & Customer Acquisition

`.claude/skills/growth-playbook/SKILL.md` is a brute-force customer-acquisition playbook (launch-max, competitor distribution capture, warm outbound, UGC creators, community seeding, trend-jacking), adapted into two tracks:

- **Track A — global/B2B reach** (Product Hunt/HN-style launches, LinkedIn outbound, international niche creators): `jumelleCafe`, `BeanPath`/`beanspath`, `co3data`, `coopmanager`, `AgriSight`, `CongoCSPC` — products whose buyers (EU coffee/cocoa buyers, exporters, NGOs/donors) are reachable in English online.
- **Track B — hyperlocal Goma/Kivu** (WhatsApp/community seeding, local TikTok/Instagram creators, radio, market associations): `kivukazi`, `kazi`, `TicketNavigator`, `aryv logistics`, `eazyconnect`, `cafekivucongo`, `boutique`, `chantierMobile` — products whose customers are in-region and phone/WhatsApp-first.
- Single-client/internal tools (`comptable`, `heritage-app`, `Patrimoine`, `fikiri_id`) are out of scope — there's no open market to acquire from.

Invoke it whenever a project asks about getting customers/users, launch strategy, or growth — it picks the right track rather than applying US-tech-market tactics to a hyperlocal product or vice versa.
