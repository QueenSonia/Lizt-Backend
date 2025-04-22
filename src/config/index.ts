import dotenv from 'dotenv';

dotenv.config();

export const config = {
  DEFAULT_PER_PAGE: 30,
  DEFAULT_PAGE_NO: 1,
  NODE_ENV: process.env.NODE_ENV ?? '',
};
