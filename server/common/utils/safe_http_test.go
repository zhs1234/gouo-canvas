package utils

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestIsPublicIP(t *testing.T) {
	tests := map[string]bool{
		"8.8.8.8":          true,
		"1.1.1.1":          true,
		"2606:4700::1111":  true,
		"127.0.0.1":        false,
		"10.1.2.3":         false,
		"172.16.0.1":       false,
		"192.168.1.1":      false,
		"169.254.169.254":  false,
		"100.64.0.1":       false,
		"0.0.0.0":          false,
		"224.0.0.1":        false,
		"::1":              false,
		"::":               false,
		"fe80::1":          false,
		"fd00::1":          false,
		"::ffff:127.0.0.1": false,
		"::ffff:10.0.0.1":  false,
		"64:ff9b::a00:1":   false,
	}
	for addr, want := range tests {
		if got := IsPublicIP(net.ParseIP(addr)); got != want {
			t.Errorf("IsPublicIP(%s) = %v, want %v", addr, got, want)
		}
	}
}

func TestPublicHTTPClientRejectsLoopbackAndRedirects(t *testing.T) {
	var hits int
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer internal.Close()
	client := NewPublicHTTPClient(5 * time.Second)

	if _, err := client.Get(internal.URL); err == nil {
		t.Fatal("expected loopback request to be rejected")
	}
	// localhost 经 DNS 解析后同样落在回环地址
	if _, err := client.Get("http://localhost:" + internal.URL[len("http://127.0.0.1:"):]); err == nil {
		t.Fatal("expected localhost request to be rejected")
	}
	if hits != 0 {
		t.Fatalf("internal server was reached %d times", hits)
	}

	redirect := &http.Request{URL: mustParseURL(t, "file:///etc/passwd")}
	if err := client.CheckRedirect(redirect, []*http.Request{{}}); err == nil {
		t.Fatal("expected non-http redirect to be rejected")
	}
}

func TestCheckPublicHost(t *testing.T) {
	for _, host := range []string{"localhost", "127.0.0.1", "10.0.0.1", "::1"} {
		if err := CheckPublicHost(context.Background(), host); err == nil {
			t.Errorf("CheckPublicHost(%s) should fail", host)
		}
	}
	if err := CheckPublicHost(context.Background(), "8.8.8.8"); err != nil {
		t.Errorf("CheckPublicHost(8.8.8.8) = %v", err)
	}
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}
