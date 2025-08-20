import crypto from 'crypto';

export const  isRequestSignatureValid = (req: any, app_secret: string) =>{
  if (!app_secret) {
    console.warn(
      'App Secret is not set up. Please Add your app secret in /.env file to check for request validation',
    );
    return true;
  }

  const signatureHeader = req.get('x-hub-signature-256');

  const signatureBuffer = Buffer.from(
    signatureHeader?.replace('sha256=', ''),
    'utf-8',
  );

  const hmac = crypto.createHmac('sha256', app_secret);
  const digestString = hmac.update(req?.rawBody).digest('hex');
  const digestBuffer = Buffer.from(digestString, 'utf-8');

  console.log(digestBuffer, signatureBuffer)

  if (!crypto.timingSafeEqual(digestBuffer, signatureBuffer)) {
    console.error('Error: Request Signature did not match');
    return false;
  }
  return true;
}
