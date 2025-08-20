"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowEndpointException = exports.encryptResponse = exports.decryptRequest = void 0;
const crypto_1 = __importDefault(require("crypto"));
const APP_SECRET = process.env.APP_SECRET;
const decryptRequest = (body, privatePem, passphrase) => {
    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
    const privateKey = crypto_1.default.createPrivateKey({ key: privatePem, passphrase });
    let decryptedAesKey = null;
    try {
        decryptedAesKey = crypto_1.default.privateDecrypt({
            key: privateKey,
            padding: crypto_1.default.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        }, Buffer.from(encrypted_aes_key, 'base64'));
    }
    catch (error) {
        console.error(error);
        throw new exports.FlowEndpointException(421, 'Failed to decrypt the request. Please verify your private key.');
    }
    const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
    const initialVectorBuffer = Buffer.from(initial_vector, 'base64');
    const TAG_LENGTH = 16;
    const encrypted_flow_data_body = flowDataBuffer.subarray(0, -TAG_LENGTH);
    const encrypted_flow_data_tag = flowDataBuffer.subarray(-TAG_LENGTH);
    const decipher = crypto_1.default.createDecipheriv('aes-128-gcm', decryptedAesKey, initialVectorBuffer);
    decipher.setAuthTag(encrypted_flow_data_tag);
    const decryptedJSONString = Buffer.concat([
        decipher.update(encrypted_flow_data_body),
        decipher.final(),
    ]).toString('utf-8');
    return {
        decryptedBody: JSON.parse(decryptedJSONString),
        aesKeyBuffer: decryptedAesKey,
        initialVectorBuffer,
    };
};
exports.decryptRequest = decryptRequest;
const encryptResponse = (response, aesKeyBuffer, initialVectorBuffer) => {
    const flipped_iv = [];
    for (const pair of initialVectorBuffer.entries()) {
        flipped_iv.push(~pair[1]);
    }
    const cipher = crypto_1.default.createCipheriv('aes-128-gcm', aesKeyBuffer, Buffer.from(flipped_iv));
    return Buffer.concat([
        cipher.update(JSON.stringify(response), 'utf-8'),
        cipher.final(),
        cipher.getAuthTag(),
    ]).toString('base64');
};
exports.encryptResponse = encryptResponse;
const FlowEndpointException = class FlowEndpointException extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
    }
};
exports.FlowEndpointException = FlowEndpointException;
//# sourceMappingURL=encryption.js.map