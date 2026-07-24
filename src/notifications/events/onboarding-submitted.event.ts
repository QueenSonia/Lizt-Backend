export interface OnboardingSubmittedEvent {
  // The managing admin's account id — the live-feed row is addressed to the
  // admin directly (they own the onboarding link), so it surfaces on their
  // scoped feed and pushes to them.
  admin_id: string;
  submission_id: string;
  landlord_name: string;
  // true when an already-submitted application was edited and re-submitted.
  is_update: boolean;
  date: string;
}
