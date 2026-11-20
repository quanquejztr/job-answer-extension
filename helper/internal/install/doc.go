// Package install holds the development installer: it copies the host binary
// into the app's user-owned Application Support directory and writes the Chrome
// native-host manifest, with path-safety checks. Every path derives from an
// injected home directory so tests never touch the real one. It never reads
// profile data or provider credentials.
package install
