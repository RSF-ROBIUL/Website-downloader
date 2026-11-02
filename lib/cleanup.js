'use strict';

/**
 * TTL-based cleanup for files the app leaves on disk. Without this, every
 * download leaves an up-to-quota zip in public/sites/ and every crash leaves
 * a half-finished job directory in downloads/, until the disk fills up.
 *
 * Zip filename (hostname-jobId) says nothing about age, so file mtime is the
 * source of truth. A guard keeps every deletion inside the two folders the
 * app owns, the same way wget/index.js keeps its removeJobDir inside
 * downloads/.
 */

var fs = require('fs');
var path = require('path');

var SITES_DIR = path.join(__dirname, '..', 'public', 'sites');
var DOWNLOAD_ROOT = path.resolve(path.join(__dirname, '..', 'downloads'));

var SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function ttlMs() {
  var minutes = Number(process.env.ZIP_TTL_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = 60;
  return minutes * 60 * 1000;
}

function removeOldZip(fullPath, mtimeMs, now, log) {
  if (now - mtimeMs <= ttlMs()) return;
  // The zip prefix check keeps the guard meaningful: only names produced by
  // archiver (something.zip) are ever considered.
  fs.rm(fullPath, { force: true }, function (err) {
    if (err && err.code !== 'ENOENT') {
      log('Could not delete old archive ' + fullPath + ': ' + err.message);
    }
  });
}

/**
 * Deletes a job directory that is provably one level under DOWNLOAD_ROOT,
 * protecting against path joins gone wrong anywhere above this function.
 */
function removeStaleJobDir(resolved, now) {
  var root = DOWNLOAD_ROOT;
  if (resolved === root || !resolved.startsWith(root + path.sep)) return;
  var stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return;
  if (now - stat.mtimeMs <= ttlMs()) return;
  fs.rm(resolved, { recursive: true, force: true }, function (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('Could not delete stale job directory ' + resolved + ': ' + err.message);
    }
  });
}

function sweep() {
  var now = Date.now();
  var ttl = ttlMs();

  try {
    fs.mkdirSync(SITES_DIR, { recursive: true });
  } catch (err) {
    console.error('Could not ensure public/sites exists: ' + err.message);
    return;
  }

  var entries;
  try {
    entries = fs.readdirSync(SITES_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('Could not read public/sites: ' + err.message);
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry.isFile() || !entry.name.endsWith('.zip')) continue;
    var full = path.join(SITES_DIR, entry.name);
    try {
      removeOldZip(full, fs.statSync(full).mtimeMs, now, function (msg) {
        console.error(msg);
      });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('Could not stat ' + full + ': ' + err.message);
      }
    }
  }

  // Leftovers of crashed/restarted jobs in downloads/ (same TTL window).
  try {
    var jobEntries = fs.readdirSync(DOWNLOAD_ROOT, { withFileTypes: true });
    for (var j = 0; j < jobEntries.length; j++) {
      var jobEntry = jobEntries[j];
      if (!jobEntry.isDirectory()) continue;
      var resolved = path.resolve(DOWNLOAD_ROOT, jobEntry.name);
      removeStaleJobDir(resolved, now);
    }
  } catch (err) {
    // downloads/ not existing yet is normal on a fresh install.
    if (err.code !== 'ENOENT') {
      console.error('Could not read downloads: ' + err.message);
    }
  }
}

function start() {
  // First sweep runs from the startup path so a restart clears what the
  // crashed server left behind even before the interval fires.
  sweep();
  var timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { start: start, sweep: sweep };
