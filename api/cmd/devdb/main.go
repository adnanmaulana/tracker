// devdb runs a local Postgres 17 for development, without Docker.
// Data lives in api/.devdb and survives restarts. Stop with Ctrl-C.
//
//	go run ./cmd/devdb
package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

func main() {
	root, err := filepath.Abs(".devdb")
	if err != nil {
		log.Fatal(err)
	}
	pg := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().
		Version(embeddedpostgres.V17).
		Port(5432).
		Username("tracker").
		Password("tracker").
		Database("tracker").
		DataPath(filepath.Join(root, "data")).
		RuntimePath(filepath.Join(root, "runtime")).
		BinariesPath(filepath.Join(root, "bin")))

	if err := pg.Start(); err != nil {
		log.Fatalf("start postgres: %v (is something else using port 5432?)", err)
	}
	fmt.Println("Postgres running: postgres://tracker:tracker@localhost:5432/tracker?sslmode=disable")
	fmt.Println("Press Ctrl-C to stop.")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	if err := pg.Stop(); err != nil {
		log.Fatal(err)
	}
}
