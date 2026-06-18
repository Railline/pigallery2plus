#!/usr/bin/env node
const fs = require('fs');
const net = require('net');
const {spawn} = require('child_process');

const configPath = process.env.PIGALLERY_CONFIG_PATH || '/app/data/config/config.json';
const waitTimeoutMs = Math.max(0, Number(process.env.PIGALLERY_DB_WAIT_TIMEOUT || 300)) * 1000;
const retryMs = Math.max(500, Number(process.env.PIGALLERY_DB_WAIT_RETRY_MS || 2000));

function readDatabaseConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const database = config.Database || config.database || {};
    if (String(database.type || '').toLowerCase() !== 'mysql') {
      return null;
    }
    const mysql = database.mysql || {};
    const host = mysql.host || process.env.default_Database_mysql_host;
    const port = Number(mysql.port || process.env.default_Database_mysql_port || 3306);
    if (!host || !port) {
      return null;
    }
    return {host, port};
  } catch (e) {
    return null;
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
    '--config-path=/app/data/config/config.json',
  ];
  const child = spawn(process.execPath, args, {stdio: 'inherit'});
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

waitForDatabase().then(startApp).catch(err => {
  process.stderr.write(`[PiGallery2Plus] entrypoint error: ${err && err.message ? err.message : err}\n`);
  startApp();
});
