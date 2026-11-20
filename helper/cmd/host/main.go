// Command host is the native-messaging host Chrome starts. It stays thin:
// behavior lives in internal/host.
package main

import (
	"context"
	"io"
	"os"

	"jobanswer/helper/internal/host"
	"jobanswer/helper/internal/identity"
	"jobanswer/helper/internal/provider/fake"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, in io.Reader, out, errw io.Writer) int {
	log := host.NewLogger(errw)
	// Chrome passes the caller origin as the first argument. Check it before
	// reading anything from stdin.
	if err := host.CheckCaller(args, identity.Origin()); err != nil {
		log.Event(host.EventCallerRejected)
		return 2
	}
	// Slice 1 uses the deterministic fake provider; real adapters arrive in Slice 3.
	err := host.Run(context.Background(), in, out, host.Config{
		Provider: fake.FakeProvider{},
		Log:      log,
	})
	if err != nil {
		return 1
	}
	return 0
}
