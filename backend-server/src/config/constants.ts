export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/plain' // txt
] as const;

export const ALLOWED_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_DOCUMENT_MIME_TYPES
] as const;

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

export const MATTER_TYPES = [
  'Litigation',
  'Insurance Claim',
  'Criminal Defense',
  'IP Dispute',
  'Other'
] as const;

export type MatterType = typeof MATTER_TYPES[number];

export const CASE_STATUS = ['Open', 'Closed'] as const;
export type CaseStatus = typeof CASE_STATUS[number];

export const AUDIT_ACTIONS = [
  'AUTH_LOGIN',
  'AUTH_LOGOUT',
  'CASE_CREATE',
  'CASE_UPDATE',
  'CASE_CLOSE',
  'CASE_DELETE',
  'FILE_UPLOAD',
  'FILE_DELETE',
  'FORENSIC_ANALYSIS_RUN',
  'FORENSIC_ANALYSIS_RETRIGGER',
  'REPORT_EXPORT'
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export const AUDIT_TARGET_TYPES = ['CASE', 'FILE', 'USER', 'REPORT'] as const;
export type AuditTargetType = typeof AUDIT_TARGET_TYPES[number];

export const AUTHENTICITY_LABELS = {
  AUTHENTIC: 'Authentic',
  SUSPICIOUS: 'Suspicious',
  HIGHLY_MANIPULATED: 'Highly Manipulated'
} as const;

export type AuthenticityLabel = typeof AUTHENTICITY_LABELS[keyof typeof AUTHENTICITY_LABELS];

// Default fusion weights as per FR-4.7 (configurable)
export const DEFAULT_FORENSIC_WEIGHTS = {
  exif: 0.15,
  ela: 0.20,
  copyMove: 0.20,
  noise: 0.15,
  lighting: 0.10,
  deepfake: 0.20
};

export const AUTHENTICITY_THRESHOLDS = {
  AUTHENTIC_MAX: 0.30,
  SUSPICIOUS_MAX: 0.65
};
