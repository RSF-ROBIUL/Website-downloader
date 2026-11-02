'use strict';

/**
 * SSRF guard. wget takes any http(s) URL, which used to let a visitor point
 * the server at itself: localhost, the cloud metadata address, anything on
 * the internal network. Every target is resolved and every answer IP is
 * checked before wget is allowed to start.
 *
 * Note on DNS rebinding: wget resolves the hostname again on its own, so a
 * host that flips answers between two lookups can still get through. That
 * needs pinning the resolved IP into wget, which is not portable; treating
 * the *first* answer as the identity is good enough for this threat model.
 */

var dns = require('dns').promises;

// Everything a wget run should never be able to reach.
var PROTECTED_V4_RANGES = [
  ['0.0.0.0', 8],          // "this network"
  ['10.0.0.0', 8],         // private
  ['100.64.0.0', 10],      // carrier-grade NAT
  ['127.0.0.0', 8],        // loopback
  ['169.254.0.0', 16],     // link-local (cloud metadata lives here)
  ['172.16.0.0', 12],      // private
  ['192.0.0.0', 24],       // IETF protocol assignments
  ['192.0.2.0', 24],       // TEST-NET-1
  ['192.168.0.0', 16],     // private
  ['198.18.0.0', 15],      // benchmarking
  ['198.51.100.0', 24],    // TEST-NET-2
  ['203.0.113.0', 24],     // TEST-NET-3
  ['224.0.0.0', 4],        // multicast
  ['240.0.0.0', 4]         // reserved, includes broadcast
];

var PROTECTED_V6_RANGES = [
  ['::', 128],                        // unspecified
  ['::1', 128],                       // loopback
  ['fc00::', 7],                      // unique local
  ['fe80::', 10]                      // link-local
];

function ipv4ToLong(ip) {
  var parts = ip.split('.');
  if (parts.length !== 4) return null;
  var value = 0;
  for (var i = 0; i < 4; i++) {
    var octet = Number(parts[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255 || !/^\d+$/.test(parts[i])) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value;
}

function ipv6ToBigInt(text) {
  var input = String(text);

  // ::ffff:192.168.0.1 style mapped addresses: peel off the IPv4 part.
  var mapped = input.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) {
    var v4 = ipv4ToLong(mapped[1]);
    if (v4 === null) return null;
    // mapped address is "0:0:0:0:0:0 + IPv4", i.e. bits 80..111
    // (0xffff00000000n below covers the IPv4 part position in a 128-bit int)
    return 0xffff00000000n + BigInt(v4);
  }

  var head = [];
  var tail = [];
  var parts = input.split('::');
  if (parts.length > 2) return null;
  if (parts.length === 1) {
    head = input.split(':');
  } else {
    head = parts[0] ? parts[0].split(':') : [];
    tail = parts[1] ? parts[1].split(':') : [];
  }
  if (head.length + tail.length > 8) return null;
  // "::" must leave at least one gap to expand
  if (parts.length === 2 && head.length + tail.length === 8) return null;

  var fill = 8 - head.length - tail.length;
  var words = head.concat(new Array(fill).fill(0), tail);
  var value = 0n;
  for (var i = 0; i < 8; i++) {
    var word = words[i];
    if (word === '' || word === undefined) return null;
    if (!/^[0-9a-f]{1,4}$/i.test(word)) return null;
    value = (value << 16n) + BigInt(parseInt(word, 16));
  }
  return value;
}

function inRange(value, base, prefixBits) {
  var width = widthOf(base); // 32 or 128
  var shift = BigInt(width - prefixBits);
  // compare the leading prefixBits of both addresses
  return (value >> shift) === (base >> shift);
}

function widthOf(base) {
  return base < (1n << 32n) ? 32 : 128;
}

/**
 * True when the address is loopback/private/link-local/reserved/multicast.
 */
function isProtectedIp(ip) {
  var asV4 = ipv4ToLong(ip);
  if (asV4 !== null) {
    for (var i = 0; i < PROTECTED_V4_RANGES.length; i++) {
      var entry = PROTECTED_V4_RANGES[i];
      var base = ipv4ToLong(entry[0]);
      var bits = entry[1];
      if ((asV4 >>> (32 - bits)) === (base >>> (32 - bits))) return true;
    }
    return false;
  }

  var asV6 = ipv6ToBigInt(ip);
  if (asV6 === null) {
    // Not an IP at all — treat as protected, only resolved addresses pass.
    return true;
  }

  // IPv4-mapped IPv6 re-check against the v4 list
  if (asV6 >= 0xffff00000000n && asV6 <= 0xffffffffffffn) {
    var plain = '.' + Number((asV6 >> 16n) & 0xffn) + '.' + Number(asV6 & 0xffn);
    var prefix = String(Number((asV6 >> 24n) & 0xffn)) + plain;
    return isProtectedIp(prefix);
  }

  for (var j = 0; j < PROTECTED_V6_RANGES.length; j++) {
    var entryV6 = PROTECTED_V6_RANGES[j];
    if (inRange(asV6, ipv6ToBigInt(entryV6[0]), entryV6[1])) return true;
  }
  return false;
}

function looksLikeLocalHostname(hostname) {
  var name = String(hostname).toLowerCase();
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name.endsWith('.internal') ||
    name.endsWith('.lan') ||
    name.endsWith('.home') ||
    // hex/octal IPv4 encodings such as 0x7f.0.0.1 or 0177.0.0.1
    /^0[xX]/.test(name)
  );
}

/**
 * Resolves the target and rejects it unless every answer is a public IP.
 * Resolves with { ips } or rejects with a plain message for the user.
 */
function assertPublicTarget(url) {
  return dns.lookup(url.hostname, { all: true, verbatim: true })
    .then(function (answers) {
      if (!answers || answers.length === 0) {
        throw new Error('Could not find any address for that host.');
      }
      var protectedOnes = answers.filter(function (a) { return isProtectedIp(a.address); });
      if (protectedOnes.length > 0) {
        throw new Error(
          'This address is not allowed: ' + url.hostname +
          ' points at a private or loopback network, and only public sites can be downloaded.'
        );
      }
      return { ips: answers.map(function (a) { return a.address; }) };
    })
    .catch(function (err) {
      if (err instanceof Error && err.message.indexOf('not allowed') !== -1) throw err;
      throw new Error('Could not reach ' + url.hostname + '. If it is a new site, check the address: ' + err.message);
    });
}

module.exports = {
  isProtectedIp: isProtectedIp,
  looksLikeLocalHostname: looksLikeLocalHostname,
  assertPublicTarget: assertPublicTarget
};
