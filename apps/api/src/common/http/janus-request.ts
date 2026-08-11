import type { Request } from 'express';

export type JanusRequest = Request & {
  requestId?: string;
  auth?: {
    userId: string;
    sessionId: string;
    organizationId: string;
    role: string;
  };
};
