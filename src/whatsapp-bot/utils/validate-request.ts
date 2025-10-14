import crypto from 'crypto';

export const isRequestSignatureValid = (req: any, app_secret: string) => {
  if (!app_secret) {
    console.warn(
      'App Secret is not set up. Please Add your app secret in /.env file to check for request validation',
    );
    return true;
  }

  const signatureHeader = req.get('x-hub-signature-256');

  if (!signatureHeader) {
    console.error('Missing x-hub-signature-256 header');
    return false;
  }

  // signatureHeader is in the form "sha256=<hex>". We must compare the raw bytes
  // of the hex digest. Use 'hex' when creating buffers from hex strings.
  const signatureHex = signatureHeader.replace('sha256=', '');
  const signatureBuffer = Buffer.from(signatureHex, 'hex');

  const hmac = crypto.createHmac('sha256', app_secret);
  const digestString = hmac.update(req?.rawBody).digest('hex');
  const digestBuffer = Buffer.from(digestString, 'hex');

  // timingSafeEqual requires buffers of the same length. If lengths differ, fail fast.
  if (digestBuffer.length !== signatureBuffer.length) {
    console.error('Error: Request signature length mismatch');
    return false;
  }

  if (!crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
    console.error('Error: Request Signature did not match');
    return false;
  }

  return true;
};
