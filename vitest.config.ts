import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ resolve: { alias: { 'server-only': path.resolve('tests/server-only.ts'), '@': path.resolve('.') } }, test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
