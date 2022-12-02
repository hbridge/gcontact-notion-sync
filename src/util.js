const fs = require('fs');

function getEnv() {
  return process.argv[2] || 'prod';
}

function log(entry) {
  if (getEnv() === 'dev') {
    console.log(entry);
  } else {
    console.log(entry);
    fs.appendFileSync('/tmp/google-notion-sync.log', `${new Date().toISOString()} - ${entry}\n`);
  }
}

exports.log = log;
exports.getEnv = getEnv;
