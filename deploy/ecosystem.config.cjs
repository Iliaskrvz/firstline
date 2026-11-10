// pm2 on the VPS: the web app (behind Caddy) and the job worker.
//   pm2 startOrReload deploy/ecosystem.config.cjs && pm2 save
const root = __dirname + "/..";
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
