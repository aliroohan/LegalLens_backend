import mongoose from 'mongoose';
import { ENV } from './env.ts';

export const connectDatabase = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(ENV.MONGO_URI);
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`);
  } catch (error) {
    console.error('[MongoDB] Connection error:', error);
    // In local development we don't crash if MongoDB is starting up, but log clearly
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Connection disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Runtime connection error:', err);
});
