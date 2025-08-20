"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRequestSignatureValid = void 0;
const crypto_1 = __importDefault(require("crypto"));
const isRequestSignatureValid = (req, app_secret) => {
    if (!app_secret) {
        console.warn('App Secret is not set up. Please Add your app secret in /.env file to check for request validation');
        return true;
    }
    const signatureHeader = req.get('x-hub-signature-256');
    const signatureBuffer = Buffer.from(signatureHeader?.replace('sha256=', ''), 'utf-8');
    const hmac = crypto_1.default.createHmac('sha256', app_secret);
    const digestString = hmac.update(req?.rawBody).digest('hex');
    const digestBuffer = Buffer.from(digestString, 'utf-8');
    console.log(digestBuffer, signatureBuffer);
    if (!crypto_1.default.timingSafeEqual(digestBuffer, signatureBuffer)) {
        console.error('Error: Request Signature did not match');
        return false;
    }
    return true;
};
exports.isRequestSignatureValid = isRequestSignatureValid;
//# sourceMappingURL=validate-request.js.map