export enum PrimaryIntent {
  MAINTENANCE = 'MAINTENANCE',
  TENANCY = 'TENANCY',
  PAYMENT = 'PAYMENT',
  ACCOUNT_INFO = 'ACCOUNT_INFO',
  MESSAGE_TO_HUMAN = 'MESSAGE_TO_HUMAN',
  META_SOCIAL = 'META_SOCIAL',
}

export enum SubIntent {
  // MAINTENANCE
  MR_REPORT_NEW = 'report_new',
  MR_CHECK_STATUS = 'check_status',
  MR_CONFIRM_RESOLVED = 'confirm_resolved',
  MR_DISPUTE_RESOLVED = 'dispute_resolved',
  MR_CONFIRM_FILED_REQUEST = 'confirm_filed_request',
  MR_DENY_FILED_REQUEST = 'deny_filed_request',
  MR_POSTPONE_CONFIRMATION = 'postpone_confirmation',
  MR_ADD_DETAIL = 'add_detail',

  // TENANCY
  TENANCY_VIEW = 'tenancy_view',
  TENANCY_DISPUTE = 'tenancy_dispute',
  TENANCY_LEASE_QUESTION = 'lease_question',
  TENANCY_RENEWAL_INTENT = 'renewal_intent',
  TENANCY_MOVE_OUT = 'move_out',

  // PAYMENT
  PAY_RENT = 'pay_rent',
  PAY_OUTSTANDING = 'pay_outstanding',
  PAY_BALANCE_QUESTION = 'balance_question',
  PAY_DUE_DATE_QUESTION = 'due_date_question',
  PAY_REQUEST_PLAN = 'request_payment_plan',
  PAY_REQUEST_RECEIPT = 'request_receipt',
  PAY_CANCEL = 'cancel_payment',
  PAY_QUESTION = 'payment_question',

  // ACCOUNT_INFO
  INFO_LANDLORD_CONTACT = 'landlord_contact',
  INFO_FM_CONTACT = 'fm_contact',
  INFO_PROPERTY = 'property_info',
  INFO_ACCOUNT_SUMMARY = 'account_summary',

  // MESSAGE_TO_HUMAN
  HUMAN_TO_LANDLORD = 'to_landlord',
  HUMAN_TO_FM = 'to_fm',
  HUMAN_COMPLAINT = 'complaint_about_service',
  HUMAN_REQUEST = 'request_human',

  // META_SOCIAL
  META_SWITCH_ROLE = 'switch_role',
  META_SHOW_MENU = 'show_menu',
  META_END_SESSION = 'end_session',
  META_GREETING = 'greeting',
  META_ACKNOWLEDGEMENT = 'acknowledgement',
  META_UNCLEAR = 'unclear',
  META_OFF_TOPIC = 'off_topic',
  META_ABUSE = 'abuse_or_threat',
}

export interface IntentMeta {
  primary: PrimaryIntent;
  isWrite: boolean;
  // If set, the existing tenant button id this intent simulates after confirmation.
  // Notice-bound intents (no existing flow) leave this undefined and route to
  // MESSAGE_TO_HUMAN side-effects instead.
  mapsToButtonId?: string;
  // Human-readable verb used inside the confirmation card body, e.g.
  // "report 'my roof is leaking'". Should fit the sentence
  // "Sounds like you want to <displayVerb>."
  displayVerb: string;
}

export const INTENT_META: Record<SubIntent, IntentMeta> = {
  // MAINTENANCE -----------------------------------------------------------
  [SubIntent.MR_REPORT_NEW]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    mapsToButtonId: 'new_maintenance_request',
    displayVerb: 'report',
  },
  [SubIntent.MR_CHECK_STATUS]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: false,
    mapsToButtonId: 'view_maintenance_request',
    displayVerb: 'check the status of your requests',
  },
  [SubIntent.MR_CONFIRM_RESOLVED]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    mapsToButtonId: 'confirm_resolution_yes',
    displayVerb: 'confirm the issue is fixed',
  },
  [SubIntent.MR_DISPUTE_RESOLVED]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    mapsToButtonId: 'confirm_resolution_no',
    displayVerb: 'reopen the request',
  },
  [SubIntent.MR_CONFIRM_FILED_REQUEST]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    mapsToButtonId: 'tenant_confirm_mr',
    displayVerb: 'confirm this request',
  },
  [SubIntent.MR_DENY_FILED_REQUEST]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    mapsToButtonId: 'tenant_deny_mr',
    displayVerb: 'deny this request',
  },
  [SubIntent.MR_POSTPONE_CONFIRMATION]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    displayVerb: 'ask for more time before confirming',
  },
  [SubIntent.MR_ADD_DETAIL]: {
    primary: PrimaryIntent.MAINTENANCE,
    isWrite: true,
    displayVerb: 'add more detail to your existing request',
  },

  // TENANCY ---------------------------------------------------------------
  [SubIntent.TENANCY_VIEW]: {
    primary: PrimaryIntent.TENANCY,
    isWrite: false,
    mapsToButtonId: 'view_tenancy',
    displayVerb: 'see your tenancy details',
  },
  [SubIntent.TENANCY_DISPUTE]: {
    primary: PrimaryIntent.TENANCY,
    isWrite: true,
    mapsToButtonId: 'tenancy_details_incorrect',
    displayVerb: 'flag your tenancy details as incorrect',
  },
  [SubIntent.TENANCY_LEASE_QUESTION]: {
    primary: PrimaryIntent.TENANCY,
    isWrite: false,
    displayVerb: 'ask about your lease',
  },
  [SubIntent.TENANCY_RENEWAL_INTENT]: {
    primary: PrimaryIntent.TENANCY,
    isWrite: true,
    mapsToButtonId: 'pay_rent',
    displayVerb: 'renew your tenancy',
  },
  [SubIntent.TENANCY_MOVE_OUT]: {
    primary: PrimaryIntent.TENANCY,
    isWrite: true,
    displayVerb: 'let your landlord know you want to move out',
  },

  // PAYMENT ---------------------------------------------------------------
  [SubIntent.PAY_RENT]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: true,
    mapsToButtonId: 'pay_rent',
    displayVerb: 'pay your rent',
  },
  [SubIntent.PAY_OUTSTANDING]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: true,
    mapsToButtonId: 'pay_outstanding_balance',
    displayVerb: 'pay your outstanding balance',
  },
  [SubIntent.PAY_BALANCE_QUESTION]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: false,
    displayVerb: 'check your balance',
  },
  [SubIntent.PAY_DUE_DATE_QUESTION]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: false,
    displayVerb: 'check when your rent is due',
  },
  [SubIntent.PAY_REQUEST_PLAN]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: true,
    displayVerb: 'request a payment plan',
  },
  [SubIntent.PAY_REQUEST_RECEIPT]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: false,
    displayVerb: 'get a payment receipt',
  },
  [SubIntent.PAY_CANCEL]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: true,
    mapsToButtonId: 'cancel_payment',
    displayVerb: 'cancel the payment',
  },
  [SubIntent.PAY_QUESTION]: {
    primary: PrimaryIntent.PAYMENT,
    isWrite: false,
    displayVerb: 'ask about your payment',
  },

  // ACCOUNT_INFO ----------------------------------------------------------
  [SubIntent.INFO_LANDLORD_CONTACT]: {
    primary: PrimaryIntent.ACCOUNT_INFO,
    isWrite: false,
    displayVerb: "see your landlord's contact",
  },
  [SubIntent.INFO_FM_CONTACT]: {
    primary: PrimaryIntent.ACCOUNT_INFO,
    isWrite: false,
    displayVerb: "see your facility manager's contact",
  },
  [SubIntent.INFO_PROPERTY]: {
    primary: PrimaryIntent.ACCOUNT_INFO,
    isWrite: false,
    displayVerb: 'see your property info',
  },
  [SubIntent.INFO_ACCOUNT_SUMMARY]: {
    primary: PrimaryIntent.ACCOUNT_INFO,
    isWrite: false,
    displayVerb: 'see a summary of your account',
  },

  // MESSAGE_TO_HUMAN ------------------------------------------------------
  [SubIntent.HUMAN_TO_LANDLORD]: {
    primary: PrimaryIntent.MESSAGE_TO_HUMAN,
    isWrite: true,
    displayVerb: 'pass this message to your landlord',
  },
  [SubIntent.HUMAN_TO_FM]: {
    primary: PrimaryIntent.MESSAGE_TO_HUMAN,
    isWrite: true,
    displayVerb: 'pass this message to your facility manager',
  },
  [SubIntent.HUMAN_COMPLAINT]: {
    primary: PrimaryIntent.MESSAGE_TO_HUMAN,
    isWrite: true,
    displayVerb: 'log this complaint with your landlord',
  },
  [SubIntent.HUMAN_REQUEST]: {
    primary: PrimaryIntent.MESSAGE_TO_HUMAN,
    isWrite: true,
    displayVerb: 'request to speak to someone',
  },

  // META_SOCIAL -----------------------------------------------------------
  [SubIntent.META_SWITCH_ROLE]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'switch role',
  },
  [SubIntent.META_SHOW_MENU]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'see the menu',
  },
  [SubIntent.META_END_SESSION]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'end the session',
  },
  [SubIntent.META_GREETING]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'say hello',
  },
  [SubIntent.META_ACKNOWLEDGEMENT]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'acknowledge',
  },
  [SubIntent.META_UNCLEAR]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'do something I cannot parse',
  },
  [SubIntent.META_OFF_TOPIC]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'chat about something off-topic',
  },
  [SubIntent.META_ABUSE]: {
    primary: PrimaryIntent.META_SOCIAL,
    isWrite: false,
    displayVerb: 'send abusive content',
  },
};

export const CONFIDENCE_THRESHOLDS = {
  ROUTE: 0.7,
  AUTO_EXECUTE_READ: 0.9,
} as const;
