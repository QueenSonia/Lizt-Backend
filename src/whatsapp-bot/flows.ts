/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// this object is generated from Flow Builder under "..." > Endpoint > Snippets > Responses
export const SCREEN_RESPONSES: any = {
  WELCOME_SCREEN: {
    screen: 'WELCOME_SCREEN',
    data: {
      tenant_default_actions: [
        {
          id: 'maintenance_request',
          title: '\ud83d\udee0 Maintenance Request',
        },
        {
          id: 'view_tenancy',
          title: '\ud83d\udcc4 View Tenancy',
        },
        {
          id: 'documents',
          title: '\ud83d\udcc1 Documents',
        },
        {
          id: 'talk_to_support',
          title: '\ud83d\udc69\u200d\ud83d\udcbb Talk to Support',
        },
      ],
      user: {
        name: 'Somto',
      },
    },
  },
  MAINTENANCE_REQUEST: {
    screen: 'MAINTENANCE_REQUEST',
    data: {
      request_actions: [
        {
          id: 'report',
          title: '\u2795 Report an Issue',
        },
        {
          id: 'view',
          title: '\ud83d\udc40 View My Requests',
        },
      ],
    },
  },
  REPORT_ISSUE_INPUT: {
    screen: 'REPORT_ISSUE_INPUT',
    data: {},
  },
  ISSUE_LOGGED_CONFIRMATION: {
    screen: 'ISSUE_LOGGED_CONFIRMATION',
    data: {},
  },
  VIEW_REQUESTS_LIST: {
    screen: 'VIEW_REQUESTS_LIST',
    data: {
      requests: [
        {
          id: 'req_1',
          title: '\ud83d\udeb0 Kitchen tap leaking',
        },
        {
          id: 'req_2',
          title: '\ud83d\udca1 Corridor light not working',
        },
      ],
    },
  },
  REQUEST_DETAIL: {
    screen: 'REQUEST_DETAIL',
    data: {
      status: 'Pending',
      description: 'Tap in kitchen leaking',
    },
  },
  TERMINAL_SCREEN: {
    screen: 'TERMINAL_SCREEN',
    data: {},
  },
  SUCCESS: {
    screen: 'SUCCESS',
    data: {
      extension_message_response: {
        params: {
          flow_token: 'REPLACE_FLOW_TOKEN',
          some_param_name: 'PASS_CUSTOM_VALUE',
        },
      },
    },
  },

  // FM password-setup Flow: blank input form for the FM to type a new
  // password. `error_visible` is a boolean (Flow v7.3 requires the `visible`
  // binding to be boolean-typed); `error_message` carries the user-facing
  // copy when error_visible=true.
  FM_SET_PASSWORD: {
    screen: 'FM_SET_PASSWORD',
    data: {
      error_message: '',
      error_visible: false,
    },
  },

  FM_PASSWORD_SUCCESS: {
    screen: 'FM_PASSWORD_SUCCESS',
    data: {},
  },

  FM_LINK_EXPIRED: {
    screen: 'FM_LINK_EXPIRED',
    data: {},
  },

  // Tenant maintenance-request Flow. The single form screen: an optional
  // property dropdown (shown only for multi-property tenants), a required
  // description, a PhotoPicker for photos, and a low-key opt-in for video.
  // `getNextScreen` overrides `data` per-token on INIT (property list, copy,
  // mode) and per-submit error states.
  REPORT_ISSUE: {
    screen: 'REPORT_ISSUE',
    data: {
      mode: 'create',
      heading: 'Report a maintenance issue',
      description_label: 'Describe the issue',
      has_multiple_properties: false,
      properties: [],
      error_message: '',
      error_visible: false,
    },
  },

  // Terminal screen shown after a successful submit. `request_id` and the
  // copy are filled in by getNextScreen.
  MR_SUCCESS: {
    screen: 'MR_SUCCESS',
    data: {
      request_id: '',
      success_message: '',
    },
  },
};
