import express from 'express';
import cors from 'cors';
import { ENV } from './config/env.ts';
import apiRouter from './routes/index.ts';
import { errorHandler } from './middleware/errorHandler.middleware.ts';
import { notFoundHandler } from './middleware/notFound.middleware.ts';

const app = express();

// Security & Parsing Middlewares
app.use(
  cors({
    origin: ENV.CORS_ORIGIN,
    credentials: true
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Root welcome & status
app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    app: 'LegalLens Forensic Backend Server',
    apiDocs: '/api/health',
    version: '1.0.0'
  });
});

// Mount Main API Routes
app.use('/api', apiRouter);

// Unmatched routes 404 handler
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

export default app;