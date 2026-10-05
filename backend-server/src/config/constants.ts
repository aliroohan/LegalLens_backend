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

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime', // mov
  'video/x-msvideo', // avi
  'video/x-matroska', // mkv
  'video/mpeg',
  'video/3gpp',
  'video/webm'
] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg', // mp3
  'audio/mp3',
  'audio/mp4', // m4a
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'audio/amr'
] as const;

export const ALLOWED_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_DOCUMENT_MIME_TYPES,
  ...ALLOWED_VIDEO_MIME_TYPES,
  ...ALLOWED_AUDIO_MIME_TYPES
] as const;

export const ALLOWED_EXTENSIONS_MAP = {
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  document: ['.pdf', '.docx', '.doc', '.txt'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.mpeg', '.mpg', '.3gp', '.webm'],
  audio: ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.amr']
} as const;

export const ALL_ALLOWED_EXTENSIONS = [
  ...ALLOWED_EXTENSIONS_MAP.image,
  ...ALLOWED_EXTENSIONS_MAP.document,
  ...ALLOWED_EXTENSIONS_MAP.video,
  ...ALLOWED_EXTENSIONS_MAP.audio
];

// Max file sizes (FR-3.3)
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per image
export const MAX_AUDIO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per audio
export const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25MB per document
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB per video

// Default Quotas (FR-2.7, FR-9.2, FR-9.3, FR-9.6, FR-9.7)
export const DEFAULT_ORG_MAX_USERS = 5;
export const DEFAULT_ORG_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const DEFAULT_INDEPENDENT_STORAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const DEFAULT_ORG_MONTHLY_FORENSIC_LIMIT = 50;
export const DEFAULT_INDEPENDENT_MONTHLY_FORENSIC_LIMIT = 15;

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ORG_ADMIN: 'org_admin',
  LAWYER: 'lawyer'
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

export const BAR_ID_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected'
} as const;

export type BarIdStatus = typeof BAR_ID_STATUS[keyof typeof BAR_ID_STATUS];

export const ORG_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated'
} as const;

export type OrgStatus = typeof ORG_STATUS[keyof typeof ORG_STATUS];

export const FILE_PROCESSING_STATUS = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  NOT_APPLICABLE: 'N/A'
} as const;

export type FileProcessingStatus = typeof FILE_PROCESSING_STATUS[keyof typeof FILE_PROCESSING_STATUS];

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
  'REVERSE_IMAGE_SEARCH',
  'REPORT_EXPORT',
  'ORG_CREATE',
  'ORG_UPDATE',
  'ORG_SUSPEND',
  'ORG_DEACTIVATE',
  'ORG_USER_LIMIT_CHANGE',
  'STORAGE_ALLOCATION_CHANGE',
  'FORENSIC_LIMIT_CHANGE',
  'LAWYER_REGISTER',
  'BAR_ID_VERIFY',
  'PASSWORD_RESET_REQUEST',
  'PASSWORD_RESET_COMPLETE',
  'ORG_ADMIN_PASSWORD_RESET'
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export const AUDIT_TARGET_TYPES = ['CASE', 'FILE', 'USER', 'ORGANIZATION', 'REPORT'] as const;
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
