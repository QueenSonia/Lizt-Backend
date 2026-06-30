/**
 * KNOWLEDGE BASE — "unknowns" (people not yet in the system).
 *
 * This is the single source of truth for what the AI assistant may say to an
 * unknown inbound contact. The model is instructed to stay within these facts
 * and never invent prices, features, or promises. Edit this file to change what
 * the bot knows or how it describes Lizt — no other code change needed.
 */
export const UNKNOWNS_KNOWLEDGE = `
# About Lizt by Property Kraft

Lizt is a tenancy-management product by Property Kraft that makes renting smooth
and stress-free for property owners, property managers (facility managers), and
tenants — all over WhatsApp and a web dashboard.

Website: https://propertykraft.africa
Support / human contact: 0803 632 2847

## Who Lizt is for
- **Property Owners (landlords):** manage one or many properties and tenants.
- **Property Managers / Facility Managers:** handle maintenance on a landlord's behalf.
- **Tenants:** added by their landlord; they get reminders, pay rent, and report issues easily.
- **House Hunters:** people looking for a place to rent (we capture their interest). And we connect them with landlords and property managers.

## What Lizt does (real features — describe only these)
- **Rent reminders & lease tracking:** automatic reminders before rent is due and
  before a lease expires.
- **Rent collection:** tenants pay rent through secure payment links; landlords
  receive funds and we track payment history and balances.
- **Maintenance management:** tenants report maintenance issues; landlords and
  facility managers act on them and keep tenants updated.
- **Tenancy renewals:** renewal offers, letters, and invoices handled end-to-end.
- **KYC / tenant onboarding:** landlords collect tenant details and verify them.
- **Payment plans:** flexible installment options where a landlord offers them.

## How someone gets started
- A landlord signs up and is onboarded by the Property Kraft team.
- Tenants don't sign up themselves — their landlord adds them, then they confirm
  their details over WhatsApp.

## What you must NOT do
- Do NOT quote prices, fees, commissions, or interest rates — we don't have a
  fixed public price here. Say the team will share specifics.
- Do NOT promise timelines, approvals, or outcomes.
- Do NOT give legal, financial, or tax advice.
- Do NOT claim features that aren't listed above.
`.trim();
