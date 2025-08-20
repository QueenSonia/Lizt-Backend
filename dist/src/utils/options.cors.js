"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsOptions = void 0;
const config_1 = require("@nestjs/config");
const config = new config_1.ConfigService();
const prodOrigin = [
    'https://server.getpanda.co',
    'http://localhost:8000',
    'http://localhost:3001',
    'http://localhost:3000',
    'https://getpanda.co',
    'https://www.getpanda.co'
];
const devOrigin = [
    `http://localhost:${config.get('PORT', 8000)}`,
    'http://localhost:3000',
    'http://localhost:8000',
    'http://localhost:3001',
    'http://localhost:5173',
    '::1',
    'https://getpanda.co',
    'https://www.getpanda.co'
];
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = isProduction ? prodOrigin : devOrigin;
exports.corsOptions = {
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
        }
        else {
            callback(new Error('NOT ALLOWED BY CORS'));
        }
    },
};
//# sourceMappingURL=options.cors.js.map