import mongoose, { Schema, type Document } from 'mongoose';

export interface IUserDocument extends Document {
  userId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: string;
  firmId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: 'lawyer' },
    firmId: { type: String, index: true }
  },
  {
    timestamps: true
  }
);

export const UserModel = mongoose.model<IUserDocument>('User', UserSchema);
