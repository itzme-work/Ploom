// SPDX-License-Identifier: Apache-2.0
// Package component retrieves the original Windows amd64 Wintun binary.
package component

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	source      = "https://www.wintun.net/builds/wintun-0.14.1.zip"
	archiveHash = "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51"
	dllHash     = "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce"
	maxBytes    = 4 << 20
)

// Fetch returns the verified DLL in memory. The caller owns the consent flow
// and the protected destination. Neither the URL nor the ZIP path is user input.
func Fetch(ctx context.Context) ([]byte, error) {
	client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Wintun download: HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxBytes {
		return nil, errors.New("Wintun archive exceeds limit")
	}
	return extract(resp.Body)
}

func checked(r io.Reader, digest string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes || fmt.Sprintf("%x", sha256.Sum256(data)) != digest {
		return nil, errors.New("Wintun integrity check failed")
	}
	return data, nil
}

func extract(r io.Reader) ([]byte, error) {
	data, err := checked(r, archiveHash)
	if err != nil {
		return nil, err
	}
	bundle, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	entry, err := bundle.Open("wintun/bin/amd64/wintun.dll")
	if err != nil {
		return nil, err
	}
	defer entry.Close()
	return checked(entry, dllHash)
}
