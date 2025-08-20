"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_GROUPS = exports.SIGN_UP_SESSION = exports.PASSWORD_SESSION = exports.PHONE_CHANGE_SESSION = exports.USER_2FA = void 0;
const USER_2FA = (userId) => `session:user:2fa:${userId}`;
exports.USER_2FA = USER_2FA;
const PHONE_CHANGE_SESSION = (phoneNumber) => `session:phone_change:${phoneNumber}`;
exports.PHONE_CHANGE_SESSION = PHONE_CHANGE_SESSION;
const PASSWORD_SESSION = (phoneNumber) => `session:password_change:${phoneNumber}`;
exports.PASSWORD_SESSION = PASSWORD_SESSION;
const SIGN_UP_SESSION = (phoneNumber) => `session:signup:${phoneNumber}`;
exports.SIGN_UP_SESSION = SIGN_UP_SESSION;
const USER_GROUPS = (userId) => `user:groups:${userId}`;
exports.USER_GROUPS = USER_GROUPS;
//# sourceMappingURL=cache-keys.js.map