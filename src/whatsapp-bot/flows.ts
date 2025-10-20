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
          id: 'service_request',
          title: '\ud83d\udee0 Service Request',
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
  SERVICE_REQUEST: {
    screen: 'SERVICE_REQUEST',
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
};
