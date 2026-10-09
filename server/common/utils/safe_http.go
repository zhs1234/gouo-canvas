package utils

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"
)

// 标准库 IsPrivate/IsLoopback 等未覆盖、但同样不应由服务端主动访问的地址段
var nonPublicNets = func() []*net.IPNet {
	var nets []*net.IPNet
	for _, cidr := range []string{
		"0.0.0.0/8",
		"100.64.0.0/10", // CGNAT
		"192.0.0.0/24",
		"198.18.0.0/15",
		"240.0.0.0/4",
		"64:ff9b::/96", // NAT64 可映射到任意 IPv4
	} {
		_, block, _ := net.ParseCIDR(cidr)
		nets = append(nets, block)
	}
	return nets
}()

// IsPublicIP 判断地址能否作为服务端按外部 URL 发起请求的目标
func IsPublicIP(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsMulticast() {
		return false
	}
	for _, block := range nonPublicNets {
		if block.Contains(ip) {
			return false
		}
	}
	return true
}

// CheckPublicHost 解析主机名并要求所有地址都是公网地址。
// 用于经代理访问、无法在建立连接时检查目标的场景；代理会自行解析，不能防住 DNS 重绑定。
func CheckPublicHost(ctx context.Context, host string) error {
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return err
	}
	for _, addr := range addrs {
		if !IsPublicIP(addr.IP) {
			return fmt.Errorf("禁止访问非公网地址 %s", host)
		}
	}
	return nil
}

// NewPublicHTTPClient 返回只能连接公网地址的 client，用于下载供应商等外部返回的 URL。
// 检查放在建立连接时，DNS 重绑定和每一跳重定向都会经过同一检查；不走环境代理，否则只能检查到代理地址。
func NewPublicHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip == nil || !IsPublicIP(ip) {
				return fmt.Errorf("禁止访问非公网地址 %s", host)
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext:         dialer.DialContext,
			ForceAttemptHTTP2:   true,
			MaxIdleConns:        10,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("重定向次数过多")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("不支持的重定向协议 %s", req.URL.Scheme)
			}
			return nil
		},
	}
}
