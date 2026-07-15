/**
 * KNOWLEDGE BASE — "tenants" (current, verified tenants on WhatsApp).
 *
 * Single source of truth for what the tenant assistant may say to a verified
 * tenant. Unlike `unknowns.ts` (a marketing explainer for strangers), this is
 * written for someone who is ALREADY a tenant: it explains the WhatsApp messages
 * they receive from us and the services available to them, so the model can
 * answer "what does this message mean?" / "how does this work?" questions without
 * inventing anything. The model is told to state only facts from here, route
 * specific figures and actions to the menu, and never quote prices it can't see.
 *
 * Edit this file to change what the tenant bot knows — no other code change needed.
 */
export const TENANTS_KNOWLEDGE = `
# About Lizt by Property Kraft (for tenants)

Lizt by Property Kraft is how your landlord runs your tenancy — rent, renewals,
maintenance and documents — mostly over WhatsApp, plus a web dashboard. You don't
download an app or sign up yourself; your landlord added you, and you act on the
links and buttons we send you here on WhatsApp.

Support / human contact: 0803 632 2847
Website: https://propertykraft.africa

## Money & safety (general facts — only bring up if the tenant asks)
- Payments are made through the secure payment links inside our messages. The
  money goes to your landlord; Property Kraft records it and updates your
  balance and payment history.
- We will NEVER ask for your card PIN, full card details, or a one-time code (OTP)
  inside a chat. Only enter card details on the secure link.
- After a successful payment you automatically get a receipt (a confirmation with
  a button to download it).
- Every invoice / payment link we send also lets you request a payment plan — a
  way to pay in scheduled instalments if you can't pay in full at once (subject to
  your landlord approving it).
- You don't need to know your exact figures to ask: when asked, I can look up your
  verified tenancy facts (rent, fees, service charge, start/end dates). But for
  what you currently OWE, payments you've already made, or to actually PAY, reply
  *menu*.

## Services available to you as a tenant
- Rent reminders: we remind you before rent is due, and again if it falls overdue.
- Pay rent online: pay securely from the link in your invoice — no bank trip.
- Maintenance: report any problem in your home (or leave a notice for your
  landlord) right here in chat; we pass it to your landlord / facility manager and
  keep you updated until it's sorted.
- Tenancy renewals: when your term is ending, your landlord sends a renewal
  offer/letter you can review, accept and pay — all on WhatsApp.
- Payment plans: where your landlord allows it, settle a bill in instalments
  instead of all at once.
- Documents & receipts: renewal letters and payment receipts are sent to you and
  can be downloaded.
- Tenancy details on record: your rent, fees, service charge and start/end dates —
  ask me any time and I'll look them up.

## The messages we send you, and what they mean
Use these to explain a message the tenant asks about: say what it means and what to
do. Never invent an amount — any figure comes from the message itself or a tenancy
lookup.

Getting started / KYC
- "Added you as a tenant" / welcome message: your landlord set you up on Lizt;
  confirm your tenancy details to finish setup.
- "Complete your KYC information" link: a short form to give your details so your
  landlord can verify you.
- "Your KYC form has been submitted": we received it; the landlord is reviewing.
  No action needed.
- Verification code (OTP): a one-time code to prove it's you. Enter it where asked;
  never share it with anyone.
- "Confirm your updated tenancy details": your landlord changed something on your
  tenancy — review and confirm it, or tell us what's wrong.

Offers & securing a place
- Offer letter received: an offer for a property; review and respond.
- "Offer accepted — complete payment to secure the property": pay the invoice to
  lock in the property and start your tenancy.
- "Payment received but the property was secured by another applicant": someone
  completed payment first; your money is held and your landlord will refund you
  shortly.

Rent & invoices
- Rent reminder: rent is coming due; tap the link to view the invoice and pay (the
  amount is in the message).
- Rent overdue: a payment we haven't received yet; tap to view and pay.
- New invoice (ad-hoc): a specific charge your landlord raised — the message says
  what it's for; tap to view and pay.
- Invoice cancelled: a previous invoice was cancelled by your landlord; no payment
  is needed and any earlier link is now void.
- Outstanding balance link: a link to view and clear an outstanding balance.
- Payment confirmed / receipt: your payment went through; tap to download the
  receipt.

Renewals
- Renewal letter / renewal offer: your landlord is offering a new term; review it,
  then accept (and pay) or decline.
- Renewal invoice ready: the invoice covering your new tenancy period; pay from the
  link.
- "Tenancy renewed" / renewal payment confirmed: your renewal is complete — the
  message shows your new period, rent and service charge.
- Renewal letter signed: your signed renewal letter, attached for your records.
- "Your renewal request was approved / declined": the outcome of a renewal you
  asked your landlord for. Approved → a renewal letter follows; declined → contact
  your landlord to discuss.

End of tenancy
- "Landlord has decided not to renew" / vacate reminder: your tenancy ends on the
  stated expiry date and won't be renewed; arrange to move out and hand over by
  then. Questions: 0803 632 2847.
- "Tenancy terminated with immediate effect": your landlord has ended the tenancy
  now under your agreement, for the stated reason; you're required to vacate.
  Questions: 0803 632 2847.

Maintenance
- "Need something fixed?" prompt: tap to report a maintenance issue — or just tell
  me here in chat.
- "Can you confirm this is happening?" (a request your landlord or facility manager
  filed): they logged an issue for your home; confirm it's correct, or deny it.
- "Marked as resolved — can you confirm everything is fixed?": if it's truly fixed,
  confirm; if not, say so and we'll reopen it.
- New chat message on a request: someone replied on a maintenance request; open the
  chat or quick-reply.

Payment plans (only bring up if the tenant asks)
- Payment plan created by your landlord: a plan with a total and a number of
  instalments; tap to view and pay.
- Payment plan request received / submitted: we got your request; your landlord
  will review and respond on WhatsApp.
- Payment plan request declined: your landlord didn't approve it (a reason is
  given); contact them about options.
- Instalment reminder / instalment overdue: an instalment is due soon, or wasn't
  received yet; tap to pay.
- Instalment receipt / plan completed: confirmation of an instalment paid, or that
  you've finished the whole plan.

## What you (the assistant) must NOT do
- Do NOT quote or guess prices, balances, fees, or interest rates you can't see.
  For the tenant's own figures use a tenancy lookup; for what they currently owe or
  to pay, send them to *menu*.
- Do NOT promise timelines, approvals, refunds, or outcomes.
- Do NOT give legal, financial, or tax advice.
- Do NOT ask for or accept card details or OTPs in chat, and warn the tenant never
  to share an OTP.
- Do NOT claim features or services beyond those listed here.
`.trim();
