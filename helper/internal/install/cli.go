package install

import (
	"flag"
	"fmt"
	"io"
	"os"

	"jobanswer/helper/internal/identity"
)

const maxTemplateBytes = 64 << 10

// RunCLI runs the installer subcommands (`dev-install`, `dev-uninstall`) and
// returns the process exit code. The home directory comes from --home or the
// current user's home.
func RunCLI(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: installer dev-install|dev-uninstall [flags]")
		return 2
	}
	switch args[0] {
	case "dev-install":
		return runInstall(args[1:], stdout, stderr)
	case "dev-uninstall":
		return runUninstall(args[1:], stdout, stderr)
	default:
		fmt.Fprintln(stderr, "unknown command; use dev-install or dev-uninstall")
		return 2
	}
}

func homeOrDefault(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	return os.UserHomeDir()
}

func runInstall(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("dev-install", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	home := fs.String("home", "", "home directory (default: the current user's)")
	id := fs.String("extension-id", identity.ExtensionID, "extension ID (default: the pinned ID)")
	allow := fs.Bool("allow-other-extension-id", false, "allow an ID other than the pinned one")
	bin := fs.String("host-binary", "", "path of the built host binary")
	tmpl := fs.String("template", "installer/templates/native-host.json.tmpl", "manifest template path")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		fmt.Fprintln(stderr, "invalid flags")
		return 2
	}
	h, err := homeOrDefault(*home)
	if err != nil {
		fmt.Fprintln(stderr, "cannot determine home directory")
		return 1
	}
	template, err := readSmallFile(*tmpl)
	if err != nil {
		fmt.Fprintln(stderr, "cannot read manifest template")
		return 1
	}
	res, err := DevInstall(Options{Home: h, HostBinary: *bin, Template: template, ExtensionID: *id, AllowOther: *allow})
	if err != nil {
		fmt.Fprintf(stderr, "install failed: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "installed host binary: %s\ninstalled manifest: %s\n", res.Binary, res.Manifest)
	return 0
}

func runUninstall(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("dev-uninstall", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	home := fs.String("home", "", "home directory (default: the current user's)")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 {
		fmt.Fprintln(stderr, "invalid flags")
		return 2
	}
	h, err := homeOrDefault(*home)
	if err != nil {
		fmt.Fprintln(stderr, "cannot determine home directory")
		return 1
	}
	if err := DevUninstall(h); err != nil {
		fmt.Fprintf(stderr, "uninstall failed: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "uninstalled")
	return 0
}

func readSmallFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxTemplateBytes+1))
	if err != nil || len(data) > maxTemplateBytes {
		return nil, ErrInvalidTemplate
	}
	return data, nil
}
