import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/legallens',
  JWT_SECRET: process.env.JWT_SECRET || 'legallens_super_secret_jwt_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  PYTHON_FORENSICS_URL: process.env.PYTHON_FORENSICS_URL || 'http://127.0.0.1:8000',
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
