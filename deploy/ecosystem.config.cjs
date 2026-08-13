const root = process.env.JANUS_ROOT || '/opt/janus-protect';

module.exports = {
  apps: [
    {
      name: 'janus-api',
      cwd: `${root}/apps/api`,
      script: 'dist/main.js',
      env: { NODE_ENV: 'production', ENV_FILE: `${root}/.env` },
      max_memory_restart: '450M',
      kill_timeout: 10_000,
    },
    {
      name: 'janus-worker',
      cwd: `${root}/apps/worker-build`,
      script: 'dist/main.js',
      env: { NODE_ENV: 'production', ENV_FILE: `${root}/.env` },
      max_memory_restart: '500M',
      kill_timeout: 120_000,
    },
    {
      name: 'janus-web',
      cwd: `${root}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: `start -H 127.0.0.1 -p ${process.env.WEB_PORT || '3100'}`,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '450M',
      kill_timeout: 10_000,
    },
  ],
};
