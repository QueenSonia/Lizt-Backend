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
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});