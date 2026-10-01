export interface AuthUserPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  firmId?: string;
}

export interface UserResponse {
  userId: string;
  email: string;
  name: string;
  role: string;
  firmId?: string;
  createdAt: Date;
}

export interface LoginResponse {
  user: UserResponse;
  token: string;
}
