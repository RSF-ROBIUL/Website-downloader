'use strict';

var wget = require('../wget');

/**
 * Per-IP request rate limit for the socket channel. HTTP endpoints already
 * have express-rate-limit, but the downloads themselves arrive over the
 * websocket, where a client can reconnect as often as it likes — each new
 * connection used to mean one more live wget process.
 */
var RATE_WINDOW_MS = 15 * 60 * 1000;
var RATE_MAX_REQUESTS = Number(process.env.DOWNLOAD_RATE_LIMIT) || 10;

var ipTimestamps = new Map();

function rejectRateLimited(ip) {
  var now = Date.now();
  var recent = (ipTimestamps.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  var rejected = recent.length >= RATE_MAX_REQUESTS;
  recent.push(now);
  ipTimestamps.set(ip, recent);
  // Keep the map from growing forever: prune entries that have no live
  // timestamps left.
  if (recent.length === 0) ipTimestamps.delete(ip);
  return rejected;
}

module.exports = (io) => {
  io.on('connection', function (socket) {
    var ip = (socket.handshake && socket.handshake.address) || 'unknown';

    socket.on('request', function (data) {
      if (!data || typeof data.token !== 'string' || !data.token) return;

      if (rejectRateLimited(ip)) {
        socket.emit(data.token, {
          error: 'Too many download requests from your connection. Please wait 15 minutes and try again.'
        });
        return;
      }

      // The handle returned by wget() is now stored on the socket. It never was
      // before, so the cleanup below could never find a process to stop.
      if (socket.job) {
        socket.emit(data.token, { error: 'A download is already running on this connection.' });
        return;
      }

      console.log('Request connection received %s', data.token);
      socket.job = wget(socket, data, function () {
        socket.job = null;
      });
    });

    socket.on('disconnect', function () {
      console.log('User disconnected');
      // Stop the wget process and remove partially downloaded files
      if (socket.job) {
        socket.job.cancel();
        socket.job = null;
      }
    });
  });
};
