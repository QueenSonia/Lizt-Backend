/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import crypto from 'crypto';
const APP_SECRET = process.env.APP_SECRET;

export const decryptRequest = (
  body: any,
  privatePem: string,
  passphrase: string,
) => {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  const privateKey = crypto.createPrivateKey({ key: privatePem, passphrase });
  let decryptedAesKey: Buffer | null = null;
  try {
    // decrypt AES key created by client
    decryptedAesKey = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encrypted_aes_key, 'base64'),
    );
  } catch (error) {
    console.error(error);
    /*
    Failed to decrypt. Please verify your private key.
    If you change your public key. You need to return HTTP status code 421 to refresh the public key on the client
    */
    throw new FlowEndpointException(
      421,
      'Failed to decrypt the request. Please verify your private key.',
    );
  }

  // decrypt flow data
  const flowDataBuffer = Buffer.from(encrypted_flow_data, 'base64');
  const initialVectorBuffer = Buffer.from(initial_vector, 'base64');

  const TAG_LENGTH = 16;
  const encrypted_flow_data_body = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const encrypted_flow_data_tag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv(
    'aes-128-gcm',
    decryptedAesKey,
    initialVectorBuffer,
  );
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

export const encryptResponse = (
  response: any,
  aesKeyBuffer: Buffer,
  initialVectorBuffer: Buffer,
) => {
  // flip initial vector
  const flipped_iv = [];
  for (const pair of initialVectorBuffer.entries()) {
    flipped_iv.push(~pair[1] as never);
  }

  // encrypt response data
  const cipher = crypto.createCipheriv(
    'aes-128-gcm',
    aesKeyBuffer,
    Buffer.from(flipped_iv),
  );
  return Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
};

export const FlowEndpointException = class FlowEndpointException extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
};

// export const isRequestSignatureValid = (req)  =>{

//   if(!APP_SECRET) {
//     console.warn("App Secret is not set up. Please Add your app secret in /.env file to check for request validation");
//     return true;
//   }

//   const signatureHeader = req.get("x-hub-signature-256");
//   const signatureBuffer = Buffer.from(signatureHeader.replace("sha256=", ""), "utf-8");

//   const hmac = crypto.createHmac("sha256", APP_SECRET);
//   const digestString = hmac.update(req.rawBody).digest('hex');
//   const digestBuffer = Buffer.from(digestString, "utf-8");

//   if ( !crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
//     console.error("Error: Request Signature did not match");
//     return false;
//   }
//   return true;
// }
