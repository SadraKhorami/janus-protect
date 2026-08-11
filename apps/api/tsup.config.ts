import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  clean: true,
  format: ['cjs'],
  platform: 'node',
  sourcemap: true,
  outDir: 'dist',
  external: ['@prisma/client', 'argon2'],
  noExternal: [/^@janus\//, 'jose'],
});
