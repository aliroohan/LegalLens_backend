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
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL || 'http://localhost:5173',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'LegalLens <no-reply@legallens.local>',
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || ''

  // NODE_ENV: process.env.NODE_ENV,
  // PORT: parseInt(process.env.PORT || '5000' , 10),
  // MONGO_URI: process.env.MONGO_URI ,
  // JWT_SECRET: process.env.JWT_SECRET ,
  // JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ,
  // PYTHON_FORENSICS_URL: process.env.PYTHON_FORENSICS_URL ,
  // UPLOAD_DIR: process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads'),
  // CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
