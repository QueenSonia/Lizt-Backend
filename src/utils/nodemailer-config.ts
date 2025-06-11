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
  secure: false, // true for 465, false for other ports (587 recommended)
  auth: {
    user: process.env.SENDGRID_API_KEY_ID, // this literal string is required
    pass: process.env.SENDGRID_API_KEY, // your actual API key
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
