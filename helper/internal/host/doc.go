// Package host is the native-messaging dispatcher: it reads frames from stdin,
// validates them with the protocol package, routes by message type, and writes
// exactly one response frame per request to stdout. It may import protocol and
// provider; protocol imports neither. cmd/host stays a thin main around it.
//
// stdout carries protocol frames only. stderr carries event names and error
// codes only: never payloads, paths, or arguments.
package host
