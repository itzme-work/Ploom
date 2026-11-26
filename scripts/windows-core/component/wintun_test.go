package component

import (
	"bytes"
	"os"
	"testing"
)

func TestCorrupt(t *testing.T) {
	for _, data := range [][]byte{nil, []byte("bad"), make([]byte, maxBytes+2)} {
		if _, err := extract(bytes.NewReader(data)); err == nil {
			t.Fatal("accepted invalid archive")
		}
	}
}
func TestOfficialArchive(t *testing.T) {
	path := os.Getenv("PLOOM_WINTUN_TEST_ZIP")
	if path == "" {
		t.Skip("official archive fixture unavailable")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := extract(f); err != nil {
		t.Fatal(err)
	}
}

func TestOfficialDownload(t *testing.T) {
	if os.Getenv("PLOOM_TEST_WINTUN_DOWNLOAD") != "1" {
		t.Skip("network test requires explicit opt-in")
	}
	if _, err := Fetch(t.Context()); err != nil {
		t.Fatal(err)
	}
}
