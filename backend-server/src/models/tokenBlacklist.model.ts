import mongoose, { Schema, type Document } from 'mongoose';

export interface ITokenBlacklistDocument extends Document {
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

const TokenBlacklistSchema = new Schema<ITokenBlacklistDocument>(
  {
    token: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: '1s' } } // MongoDB TTL index auto-deletes expired tokens
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

export const TokenBlacklistModel = mongoose.model<ITokenBlacklistDocument>(
  'TokenBlacklist',
  TokenBlacklistSchema
);
