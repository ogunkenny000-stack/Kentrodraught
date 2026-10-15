package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T) (*httptest.Server, *httptest.Server) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") == "websocket" {
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				t.Error("no hijack")
				return
			}
			c, rw, err := hijacker.Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			defer c.Close()
			accept := sha1.Sum([]byte(r.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
			_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + base64.StdEncoding.EncodeToString(accept[:]) + "\r\n\r\n")
			_ = rw.Flush()
			_, _ = io.Copy(c, rw)
			return
		}
		w.Header().Set("X-Upstream-Path", r.URL.Path)
		w.Header().Set("X-Forwarded-From", r.Header.Get("X-Forwarded-For"))
		_, _ = w.Write([]byte("backend"))
	}))
	dir := t.TempDir()
	_ = os.Mkdir(filepath.Join(dir, "assets"), 0755)
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("app-shell"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app-deadbeef12.js"), []byte("normal-js"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app-deadbeef12.js.gz"), []byte("fake-gzip"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "assets", "app-deadbeef12.js.br"), []byte("fake-brotli"), 0644)
	handler, err := newHandler(dir, upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(handler), upstream
}
func fetch(t *testing.T, url string, headers map[string]string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, string(body)
}
func TestFrontendAndCache(t *testing.T) {
	edge, up := setup(t)
	defer edge.Close()
	defer up.Close()
	res, body := fetch(t, edge.URL+"/room/invite", nil)
	if res.StatusCode != 200 || body != "app-shell" || !strings.Contains(res.Header.Get("Cache-Control"), "no-cache") {
		t.Fatal(res.StatusCode, body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "identity"})
	if body != "normal-js" || !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
		t.Fatal(body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "gzip"})
	if body != "fake-gzip" || res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatal(body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "br, gzip"})
	if body != "fake-brotli" || res.Header.Get("Content-Encoding") != "br" {
		t.Fatal("Brotli preference", body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "gzip;q=0, br;q=0"})
	if body != "normal-js" || res.Header.Get("Content-Encoding") != "" {
		t.Fatal("disabled compression", body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "br;q=0.1, gzip;q=1"})
	if body != "fake-gzip" || res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatal("encoding quality preference", body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "br; q = 0, gzip; q = 0"})
	if body != "normal-js" || res.Header.Get("Content-Encoding") != "" || res.Header.Get("Vary") != "Accept-Encoding" {
		t.Fatal("identity must vary too", body, res.Header)
	}
	res, body = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": "identity;q=1, br;q=0.1, gzip;q=0.1"})
	if body != "normal-js" || res.Header.Get("Content-Encoding") != "" {
		t.Fatal("explicit identity preference", body, res.Header)
	}
	for _, header := range []string{"identity;q=0, br;q=0, gzip;q=0", "*;q=0"} {
		res, _ = fetch(t, edge.URL+"/assets/app-deadbeef12.js", map[string]string{"Accept-Encoding": header})
		if res.StatusCode != http.StatusNotAcceptable {
			t.Fatal("all encodings excluded", header, res.StatusCode)
		}
	}
	res, _ = fetch(t, edge.URL+"/assets/missing.js", nil)
	if res.StatusCode != 404 {
		t.Fatal("missing asset", res.StatusCode)
	}
	res, _ = fetch(t, edge.URL+"/.env", nil)
	if res.StatusCode != 404 {
		t.Fatal("dotfile", res.StatusCode)
	}
}

func TestPrivateBuildFilesAndSymlinks(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	for name, value := range map[string]string{"index.html": "app", "server.cjs": "backend", "server.cjs.map": "source"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("private"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(dir, "leak.txt")); err != nil {
		t.Fatal(err)
	}
	handler, err := newHandler(dir, "http://127.0.0.1:3001")
	if err != nil {
		t.Fatal(err)
	}
	for _, requested := range []string{"/server.cjs", "/server.cjs.map", "/leak.txt", "/.hidden/../room"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requested, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s leaked with status %d: %s", requested, recorder.Code, recorder.Body.String())
		}
	}
}

func TestBackendMustBeOrigin(t *testing.T) {
	for _, backend := range []string{"file:///tmp/private", "http://user:secret@localhost", "http://localhost/api", "http://localhost?secret=1", "http://localhost#fragment"} {
		if _, err := newHandler(t.TempDir(), backend); err == nil {
			t.Fatalf("accepted non-origin backend %q", backend)
		}
	}
}
func TestAPIIsUncachedAndForwarded(t *testing.T) {
	edge, up := setup(t)
	defer edge.Close()
	defer up.Close()
	res, body := fetch(t, edge.URL+"/api/games/recent?limit=3", map[string]string{"X-Forwarded-For": "9.8.7.6"})
	if body != "backend" || res.Header.Get("X-Upstream-Path") != "/api/games/recent" || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal(res.StatusCode, body, res.Header)
	}
	if res.Header.Get("X-Forwarded-From") != "127.0.0.1" {
		t.Fatal("spoofable client address")
	}
}
func TestWebsocketUpgrade(t *testing.T) {
	edge, up := setup(t)
	defer edge.Close()
	defer up.Close()
	conn, err := net.Dial("tcp", strings.TrimPrefix(edge.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = io.WriteString(conn, "GET / HTTP/1.1\r\nHost: example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(line, "101 Switching Protocols") {
		t.Fatalf("not upgraded: %s", line)
	}
	foundAccept := false
	for {
		line, err = reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.EqualFold(strings.TrimSpace(line), "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=") {
			foundAccept = true
		}
		if line == "\r\n" {
			break
		}
	}
	if !foundAccept {
		t.Fatal("missing valid WebSocket accept header")
	}
	// A correctly framed, masked "ok" client text message; it must be
	// forwarded to Node and returned byte-for-byte through the Go edge.
	payload := []byte{0x81, 0x82, 0x01, 0x02, 0x03, 0x04, 'o' ^ 0x01, 'k' ^ 0x02}
	if _, err := conn.Write(payload); err != nil {
		t.Fatal(err)
	}
	echoed := make([]byte, len(payload))
	if _, err := io.ReadFull(reader, echoed); err != nil {
		t.Fatal(err)
	}
	if string(echoed) != string(payload) {
		t.Fatalf("WebSocket traffic changed: %v", echoed)
	}
}
