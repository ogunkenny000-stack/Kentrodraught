// Kentro's optional Go network edge: efficient static file delivery, HTTP API
// forwarding, and transparent WebSocket upgrades. Match authority and Nigerian
// Draughts rule validation remain in the existing Node server.
package main

import (
	"flag"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var hashedAsset = regexp.MustCompile(`-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?|ico)$`)

func newHandler(dir, backend string) (http.Handler, error) {
	target, err := url.Parse(backend)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.Path != "" && target.Path != "/" {
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
		if r.URL.Path == "/edge/health" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write([]byte(`{"ok":true,"component":"go-edge"}`))
			return
		}
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") || isWebSocket(r) {
			// Prevent spoofed forwarded addresses when running this edge as the
			// public entry point. Only the incoming socket peer is trusted.
			remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				remoteHost = r.RemoteAddr
			}
			r.Header.Del("X-Forwarded-For")
			r.Header.Del("X-Forwarded-Host")
			r.Header.Del("X-Forwarded-Proto")
			r.Header.Set("X-Forwarded-For", remoteHost)
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		cleaned := filepath.Clean("/" + r.URL.Path)
		if strings.HasPrefix(cleaned, "/.") || strings.Contains(cleaned, "/.") {
			http.NotFound(w, r)
			return
		}
		requested := filepath.Join(absoluteDir, filepath.FromSlash(strings.TrimPrefix(cleaned, "/")))
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
		// Pre-compressed at build time; serve Brotli to capable browsers and
		// gzip to older clients. Never compress on a small live game CPU.
		for _, coding := range []struct{ name, suffix string }{{"br", ".br"}, {"gzip", ".gz"}} {
			if !acceptsEncoding(r.Header.Get("Accept-Encoding"), coding.name) {
				continue
			}
			if packed, err := os.Stat(requested + coding.suffix); err == nil && packed.Mode().IsRegular() {
				w.Header().Set("Content-Encoding", coding.name)
				w.Header().Set("Vary", "Accept-Encoding")
				if typ := mime.TypeByExtension(filepath.Ext(requested)); typ != "" {
					w.Header().Set("Content-Type", typ)
				}
				http.ServeFile(w, r, requested+coding.suffix)
				return
			}
		}
		http.ServeFile(w, r, requested)
	}), nil
}

// Parses negotiated compression instead of accidentally serving gzip when
// a client explicitly sends "gzip;q=0".
func acceptsEncoding(header, encoding string) bool {
	for _, entry := range strings.Split(strings.ToLower(header), ",") {
		parts := strings.Split(strings.TrimSpace(entry), ";")
		if strings.TrimSpace(parts[0]) != encoding {
			continue
		}
		for _, part := range parts[1:] {
			q := strings.TrimSpace(part)
			if strings.HasPrefix(q, "q=") {
				if q == "q=0" || q == "q=0.0" || q == "q=0.00" || q == "q=0.000" {
					return false
				}
			}
		}
		return true
	}
	return false
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

func main() {
	addr := flag.String("listen", envOr("EDGE_LISTEN", ":3000"), "public address")
	backend := flag.String("backend", envOr("BACKEND_URL", "http://127.0.0.1:3001"), "Node API and WebSocket upstream")
	root := flag.String("dist", envOr("EDGE_DIST", "dist"), "built frontend directory")
	flag.Parse()
	handler, err := newHandler(*root, *backend)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 70 * time.Second, MaxHeaderBytes: 1 << 20}
	log.Printf("Kentro Go edge listening on %s (node: %s)", *addr, *backend)
	log.Fatal(server.ListenAndServe())
}

func envOr(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
