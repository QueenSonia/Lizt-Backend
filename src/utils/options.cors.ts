import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';

const config = new ConfigService();

/** Allowed production origins */
const prodOrigin = [
  'https://server.getpanda.co',
  'http://localhost:8000',
  'http://localhost:3001',
  'http://localhost:3000',
  'https://getpanda.co',
  'https://www.getpanda.co',
  'https://lizt.co',
  'https://www.lizt.co',
  'https://lizt-frontend.vercel.app',
];

/** Allowed development origins */
const devOrigin = [
  `http://localhost:${config.get('PORT', 8000)}`,
  'http://localhost:3000',
  'http://localhost:8000',
  'http://localhost:3001',
  'http://localhost:5173',
  '::1',
  'https://getpanda.co',
  'https://www.getpanda.co',
  'https://lizt.co',
  'https://www.lizt.co',
];

const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = isProduction ? prodOrigin : devOrigin;

/** CORS config options */
export const corsOptions: CorsOptions = {
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Origin',
    'X-Requested-With',
    'Accept',
    'User-Agent',
    'Cookie',
    'Access-Control-Allow-Origin',
  ],

  credentials: true,
  optionsSuccessStatus: 200,
  exposedHeaders: [
    'Content-Range',
    'X-Content-Range',
    'Set-Cookie',
    'Authorization',
  ],

  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('NOT ALLOWED BY CORS'));
    }
  },
};
