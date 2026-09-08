import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? 'http://localhost.invalid/auth',
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET ?? 'local-build-only-secret-32-characters',
  },
});
