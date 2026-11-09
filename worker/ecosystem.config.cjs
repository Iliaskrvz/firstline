// pm2 config for the VPS (Phase 2 runs locally with `npm run worker`).
//   pm2 start worker/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "firstline-worker",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      cwd: __dirname + "/..",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      kill_timeout: 35000, // let running jobs finish (graceful stop waits 30s)
      out_file: "logs/worker-out.log",
      error_file: "logs/worker-error.log",
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
