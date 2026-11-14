import axios from 'axios';
import { Readable } from 'node:stream';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { ENV } from '../config/env.ts';
cloudinary.config({
  cloud_name: ENV.CLOUDINARY_CLOUD_NAME,
  api_key: ENV.CLOUDINARY_API_KEY,
  api_secret: ENV.CLOUDINARY_API_SECRET,
  secure: true
});

export type CloudinaryResourceType = 'image' | 'video' | 'raw';

export function assertCloudinaryConfigured(): void {
  if (!ENV.CLOUDINARY_CLOUD_NAME || !ENV.CLOUDINARY_API_KEY || !ENV.CLOUDINARY_API_SECRET) {
    const err = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
    (err as any).status = 500;
    (err as any).code = 'CLOUDINARY_NOT_CONFIGURED';
    throw err;
  }
}

export function isRemoteLocation(location: string): boolean {
  return /^https?:\/\//i.test(location);
}

export async function uploadBuffer(options: {
  buffer: Buffer;
  folder: string;
  publicId: string;
  resourceType: CloudinaryResourceType;
  mimeType?: string;
  format?: string;
}): Promise<UploadApiResponse> {
  assertCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        public_id: options.publicId,
        resource_type: options.resourceType,
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        type: 'upload',
        ...(options.format ? { format: options.format } : {})
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary upload returned no result.'));
          return;
        }
        resolve(result);
      }
    );
    Readable.from(options.buffer).pipe(stream);
  });
}

export async function readStoredBytes(location: string): Promise<Buffer> {
  if (isRemoteLocation(location)) {
    const response = await axios.get<ArrayBuffer>(location, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    return Buffer.from(response.data);
  }

  const fs = await import('node:fs/promises');
  return fs.readFile(location);
}

export async function destroyCloudinaryAsset(options: {
  publicId: string;
  resourceType: CloudinaryResourceType;
}): Promise<'ok' | 'not found'> {
  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.destroy(options.publicId, {
    resource_type: options.resourceType,
    invalidate: true
  });

  if (result.result === 'ok' || result.result === 'not found') {
    return result.result;
  }

  throw new Error(`Cloudinary destroy failed for ${options.publicId}: ${result.result || 'unknown'}`);
}

export async function openStoredStream(location: string): Promise<NodeJS.ReadableStream> {
  if (isRemoteLocation(location)) {
    const response = await axios.get(location, { responseType: 'stream', timeout: 30000 });
    return response.data as NodeJS.ReadableStream;
  }

  const { createReadStream } = await import('node:fs');
  return createReadStream(location);
}
