"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    DEFAULT_PER_PAGE: 10,
    DEFAULT_PAGE_NO: 1,
    NODE_ENV: process.env.NODE_ENV ?? '',
};
//# sourceMappingURL=index.js.map