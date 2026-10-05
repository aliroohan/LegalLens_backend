import mongoose, { Schema, type Document } from 'mongoose';

export interface ReverseSearchMatch {
  title: string;
  sourceUrl: string;
  matchImageUrl?: string;
  similarityScore?: number;
  snippet?: string;
}

export interface IReverseSearchDocument extends Document {
  searchId: string;
  fileId: string;
  caseId: string;
  status: 'completed' | 'no_matches_found' | 'failed';
  matchesCount: number;
  results: ReverseSearchMatch[];
  message?: string;
  searchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReverseSearchMatchSchema = new Schema<ReverseSearchMatch>(
  {
    title: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    matchImageUrl: { type: String },
    similarityScore: { type: Number },
    snippet: { type: String }
  },
  { _id: false }
);

const ReverseSearchSchema = new Schema<IReverseSearchDocument>(
  {
    searchId: { type: String, required: true, unique: true, index: true },
    fileId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['completed', 'no_matches_found', 'failed'],
      default: 'completed',
      index: true
    },
    matchesCount: { type: Number, default: 0 },
    results: { type: [ReverseSearchMatchSchema], default: [] },
    message: { type: String },
    searchedAt: { type: Date, default: Date.now }
  },
  {
    timestamps: true
  }
);

ReverseSearchSchema.index({ fileId: 1, searchedAt: -1 });

export const ReverseSearchModel = mongoose.model<IReverseSearchDocument>(
  'ReverseSearch',
  ReverseSearchSchema
);
