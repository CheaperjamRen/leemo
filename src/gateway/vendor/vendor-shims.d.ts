// Ambient module shim: `fastify` type-only import in
// vendor/llms/src/api/middleware.ts. We do NOT install fastify (the gateway
// uses native http), so we back the handful of members errorHandler() touches.
// This file is intentionally a SCRIPT (no top-level import/export) so the
// `declare module "fastify"` below is an ambient module declaration, not an
// augmentation of a non-existent base module.

declare module "fastify" {
  export interface FastifyRequest {
    log: {
      error: (...args: any[]) => void;
    };
    [key: string]: any;
  }
  export interface FastifyReply {
    code: (statusCode: number) => {
      send: (payload: any) => any;
    };
    [key: string]: any;
  }
}
