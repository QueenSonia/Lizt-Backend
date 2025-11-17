import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// const { GMAIL_USER, GMAIL_PASSWORD } = process.env;

// export const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: GMAIL_USER!,
//     pass: GMAIL_PASSWORD,
//   },
//   tls: {
//     rejectUnauthorized: false,
//   },
// });

export const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false, // use true for port 465 if needed
  auth: {
    user: 'apikey', // ❗ This must be the literal string 'apikey'
    pass: process.env.SENDGRID_API_KEY,
  },
});

// export const transporter = nodemailer.createTransport({
//   host: 'wghp11.wghservers.com',
//   port: 465,
//   secure: true,
//   auth: {
//     user: process.env.SMTP_USER,
//     pass: process.env.SMTP_PASSWORD,
//   },
//   tls: {
//     rejectUnauthorized: false,
//   },
// });
