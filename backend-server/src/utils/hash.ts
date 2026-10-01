import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Computes SHA-256 checksum from a buffer.
 */
export const computeSha256 = (buffer: Buffer): string => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

/**
 * Computes SHA-256 checksum from a file path using streams for large files.
 */
export const computeFileSha256 = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
};
