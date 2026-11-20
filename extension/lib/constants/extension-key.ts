// Public manifest key that pins the unpacked extension's ID so the native-host
// allowed origin stays the same across reloads and machines. The matching
// private key was discarded; unpacked loading needs only the public key.
export const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr1oXzmx2bQjxxMXeKSL+k/i4UIsgT4g9SDOrymIOr7wPLNpfK1SLGKpcEhuaZSQ80FdG4rj89uUYOb1lWEDSBzhLZnn0/HLCIonYq4sHHxVrbA/KAfKc6vjo0cooxrwXT9gTG+75MjwiSXln6XoFYqjuqBSmYJJtRs8GXwvrvI8OGG2n0RjcFtuIrNqPsC+eXvQZRCrf6wUyfxoHb7nqZU1+B1uQKc2wrVwTBnKoSdu/c5Ev8lFQN00c3SVfhkRZZ2iaWEqpwmOkJnNYynvARQUvVGPFUNl62cpQbZy8GYnBKSgiGtMXMlvTbUTYsAbQjpq4/szHdAGr+eD+kUf6hQIDAQAB';

// Chrome derives the ID from the first 16 bytes of SHA-256 of the DER public key,
// mapping each hex digit 0-f to the letters a-p.
export const EXTENSION_ID = 'fofmklpoecdileojcljpmemhcefmhbfc';

export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
