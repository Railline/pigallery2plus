#!/usr/bin/env node
const fs = require('fs');
const net = require('net');
const {spawn} = require('child_process');

const cliArgs = process.argv.slice(2);
const waitTimeoutMs = Math.max(0, Number(process.env.PIGALLERY_DB_WAIT_TIMEOUT || 300)) * 1000;
const retryMs = Math.max(500, Number(process.env.PIGALLERY_DB_WAIT_RETRY_MS || 2000));

function cliValue(name) {
  const prefix = `--${name}=`;
  const argument = cliArgs.find(value => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

const configPath = process.env.PIGALLERY_CONFIG_PATH || cliValue('config-path') || '/app/data/config/config.json';
let appProcess = null;

function readDatabaseConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const database = config.Database || config.database || {};
    const databaseType = database.type || cliValue('Database-type') || process.env.DATABASE_TYPE;
    if (String(databaseType || '').toLowerCase() !== 'mysql') {
      return null;
    }
    const mysql = database.mysql || {};
    const host = mysql.host || cliValue('Database-mysql-host') || process.env.MYSQL_HOST;
    const port = Number(mysql.port || cliValue('Database-mysql-port') || process.env.MYSQL_PORT || 3306);
    if (!host || !port) {
      return null;
    }
    return {host, port};
  } catch (e) {
    const databaseType = cliValue('Database-type') || process.env.DATABASE_TYPE;
    const host = cliValue('Database-mysql-host') || process.env.MYSQL_HOST;
    const port = Number(cliValue('Database-mysql-port') || process.env.MYSQL_PORT || 3306);
    return String(databaseType || '').toLowerCase() === 'mysql' && host && port ? {host, port} : null;
  }
}

function canConnect(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({host, port});
    const done = ok => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForDatabase() {
  const db = readDatabaseConfig();
  if (!db || waitTimeoutMs === 0) {
    return;
  }
  const deadline = Date.now() + waitTimeoutMs;
  process.stdout.write(`[PiGallery2Plus] waiting for mysql ${db.host}:${db.port}\n`);
  while (Date.now() <= deadline) {
    if (await canConnect(db.host, db.port)) {
      process.stdout.write('[PiGallery2Plus] mysql is reachable\n');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, retryMs));
  }
  process.stdout.write('[PiGallery2Plus] mysql wait timed out, starting app anyway\n');
}

function startApp() {
  const args = [
    '--expose-gc',
    './src/backend/index',
  ];
  if (!cliArgs.some(argument => argument.startsWith('--config-path='))) {
    args.push('--config-path=/app/data/config/config.json');
  }
  args.push(...cliArgs);
  appProcess = spawn(process.execPath, args, {stdio: 'inherit'});
  appProcess.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (appProcess) {
      appProcess.kill(signal);
    } else {
      process.exit(0);
    }
  });
}

waitForDatabase().then(startApp).catch(err => {
  process.stderr.write(`[PiGallery2Plus] entrypoint error: ${err && err.message ? err.message : err}\n`);
  startApp();
});
