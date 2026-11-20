// Command installer is the development installer for the native host. It stays
// thin: behavior lives in internal/install.
package main

import (
	"os"

	"jobanswer/helper/internal/install"
)

func main() {
	os.Exit(install.RunCLI(os.Args[1:], os.Stdout, os.Stderr))
}
