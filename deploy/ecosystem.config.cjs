// pm2 on the VPS: the web app (behind Caddy) and the job worker.
//   pm2 startOrReload deploy/ecosystem.config.cjs && pm2 save
// eslint-disable-next-line @typescript-eslint/no-require-imports -- pm2 loads this file as CommonJS
const fs = require("fs");
const root = __dirname + "/..";
// WORKER_INSTANCES from .env.local (pm2 doesn't read that file itself).
const fromEnvFile = (name) => {
  try {
    const m = fs.readFileSync(root + "/.env.local", "utf8").match(new RegExp("^" + name + "=(.*)$", "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
};
const workerInstances = Math.max(1, Number(process.env.WORKER_INSTANCES || fromEnvFile("WORKER_INSTANCES") || 1));
module.exports = {
  apps: [
    {
      name: "firstline-web",
      script: "node_modules/.bin/next",
      args: "start -H 127.0.0.1 -p 3100", // only Caddy talks to it
      cwd: root,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      out_file: "logs/web-out.log",
      error_file: "logs/web-error.log",
      time: true,
      env: { NODE_ENV: "production" },
    },
    {
      name: "firstline-worker",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      cwd: root,
      // More workers: WORKER_INSTANCES=2 in .env.local. Provider limits and per-workspace limits are
      // shared in Postgres, and periodic tasks run on one worker at a time, so this is safe.
      instances: workerInstances, // pm2 gives each one NODE_APP_INSTANCE 0, 1, … (health port 8787 + n)
      exec_mode: "fork",
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
