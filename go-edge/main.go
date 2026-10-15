// Kentro's optional Go network edge: efficient static file delivery, HTTP API
// forwarding, and transparent WebSocket upgrades. Match authority and Nigerian
// Draughts rule validation remain in the existing Node server.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var hashedAsset = regexp.MustCompile(`-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ico)$`)

func newHandler(dir, backend string) (http.Handler, error) {
	target, err := url.Parse(backend)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.Path != "" && target.Path != "/" || target.User != nil || target.RawQuery != "" || target.Fragment != "" {
		return nil, fmt.Errorf("BACKEND_URL must be a plain http(s) origin: %q", backend)
	}
	absoluteDir, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if stat, err := os.Stat(filepath.Join(absoluteDir, "index.html")); err != nil || stat.IsDir() {
		return nil, fmt.Errorf("client build not found: %s/index.html (run npm run build)", absoluteDir)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = nil
	proxy.Rewrite = func(r *httputil.ProxyRequest) {
		r.SetURL(target)
		// SetXForwarded replaces untrusted inbound forwarded headers and adds
		// exactly one socket peer, avoiding duplicate addresses.
		r.SetXForwarded()
	}
	proxy.Transport = &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   64,
		IdleConnTimeout:       60 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second,
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("upstream unavailable: %s: %v", r.URL.Path, err)
		http.Error(w, "Game service temporarily unavailable", http.StatusBadGateway)
	}
	proxy.ModifyResponse = func(r *http.Response) error {
		// Never cache account, wager, room, tournament, or engine data.
		r.Header.Set("Cache-Control", "no-store")
		return nil
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
		if r.URL.Path == "/edge/health" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write([]byte(`{"ok":true,"component":"go-edge"}`))
			return
		}
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") || isWebSocket(r) {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		cleaned := filepath.Clean("/" + r.URL.Path)
		if strings.Contains(r.URL.Path, "/.") || strings.HasSuffix(strings.ToLower(cleaned), ".cjs") || strings.HasSuffix(strings.ToLower(cleaned), ".map") {
			http.NotFound(w, r)
			return
		}
		requested := filepath.Join(absoluteDir, filepath.FromSlash(strings.TrimPrefix(cleaned, "/")))
		if !withinRoot(absoluteDir, requested) {
			http.NotFound(w, r)
			return
		}
		info, err := os.Stat(requested)
		if err == nil && info.IsDir() {
			requested = filepath.Join(requested, "index.html")
			info, err = os.Stat(requested)
		}
		if err != nil || info.IsDir() {
			// Only extensionless routes get the app shell. Missing script and
			// image assets must return 404, not an HTML page with status 200.
			if filepath.Ext(cleaned) != "" {
				http.NotFound(w, r)
				return
			}
			requested = filepath.Join(absoluteDir, "index.html")
		}
		if strings.HasPrefix(cleaned, "/assets/") && hashedAsset.MatchString(filepath.Base(requested)) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		}
		w.Header().Set("Vary", "Accept-Encoding")
		// Pre-compressed at build time; serve Brotli to capable browsers and
		// gzip to older clients. Never compress on a small live game CPU.
		codings := []struct{ name, suffix string }{{"br", ".br"}, {"gzip", ".gz"}}
		if encodingQuality(r.Header.Get("Accept-Encoding"), "gzip") > encodingQuality(r.Header.Get("Accept-Encoding"), "br") {
			codings[0], codings[1] = codings[1], codings[0]
		}
		identityQuality := encodingQuality(r.Header.Get("Accept-Encoding"), "identity")
		for _, coding := range codings {
			quality := encodingQuality(r.Header.Get("Accept-Encoding"), coding.name)
			if quality <= 0 || identityQuality > quality {
				continue
			}
			if packed, err := os.Stat(requested + coding.suffix); err == nil && packed.Mode().IsRegular() && withinRoot(absoluteDir, requested+coding.suffix) {
				w.Header().Set("Content-Encoding", coding.name)
				w.Header().Set("Vary", "Accept-Encoding")
				if typ := mime.TypeByExtension(filepath.Ext(requested)); typ != "" {
					w.Header().Set("Content-Type", typ)
				}
				http.ServeFile(w, r, requested+coding.suffix)
				return
			}
		}
		if identityQuality == 0 {
			http.Error(w, "No acceptable content encoding", http.StatusNotAcceptable)
			return
		}
		http.ServeFile(w, r, requested)
	}), nil
}

// Parses negotiated compression instead of serving an explicitly excluded coding.
func encodingQuality(header, encoding string) float64 {
	wildcard := 0.0
	if encoding == "identity" {
		// Unmentioned identity is always an acceptable fallback, unless *;q=0
		// excludes it. A negative priority lets an offered compressed variant
		// win while still respecting an explicit preference for identity.
		wildcard = -1
	}
	for _, entry := range strings.Split(strings.ToLower(header), ",") {
		parts := strings.Split(strings.TrimSpace(entry), ";")
		name := strings.TrimSpace(parts[0])
		if name != encoding && name != "*" {
			continue
		}
		quality := 1.0
		for _, part := range parts[1:] {
			key, value, found := strings.Cut(part, "=")
			if found && strings.TrimSpace(key) == "q" {
				q, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil || !(q >= 0 && q <= 1) {
					quality = 0
				} else {
					quality = q
				}
			}
		}
		if name == encoding {
			return quality
		}
		wildcard = quality
	}
	return wildcard
}

func withinRoot(root, requested string) bool {
	resolved, err := filepath.EvalSymlinks(requested)
	if os.IsNotExist(err) {
		return true
	}
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(root, resolved)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func isWebSocket(r *http.Request) bool {
	if r.Method != http.MethodGet || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, part := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(part), "upgrade") {
			return true
		}
	}
	return false
}

type trackedConn struct {
	net.Conn
	connections *sync.Map
}

func (c *trackedConn) Close() error {
	c.connections.Delete(c)
	return c.Conn.Close()
}

type trackedListener struct {
	net.Listener
	connections *sync.Map
}

func (l trackedListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	tracked := &trackedConn{Conn: c, connections: l.connections}
	l.connections.Store(tracked, true)
	return tracked, nil
}

func main() {
	addr := flag.String("listen", envOr("EDGE_LISTEN", ":3000"), "public address")
	backend := flag.String("backend", envOr("BACKEND_URL", "http://127.0.0.1:3001"), "Node API and WebSocket upstream")
	root := flag.String("dist", envOr("EDGE_DIST", "dist"), "built frontend directory")
	flag.Parse()
	handler, err := newHandler(*root, *backend)
	if err != nil {
		log.Fatal(err)
	}
	var connections sync.Map
	server := &http.Server{Addr: *addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 70 * time.Second, MaxHeaderBytes: 1 << 20}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		deadline, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(deadline); err != nil {
			log.Printf("edge shutdown: %v", err)
		}
		// net/http Shutdown excludes hijacked WebSockets. Close their tunnels
		// too so neither process leaves sockets behind on restart.
		connections.Range(func(key, value any) bool { _ = key.(net.Conn).Close(); return true })
	}()
	log.Printf("Kentro Go edge listening on %s (node: %s)", *addr, *backend)
	if err := server.Serve(trackedListener{Listener: listener, connections: &connections}); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	<-shutdownDone
}

func envOr(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
