package common

import (
	"one-api/common/config"
	"testing"
)

func TestLogQuotaShowsPoints(t *testing.T) {
	rate, unit := config.PaymentUSDRate, config.QuotaPerUnit
	defer func() { config.PaymentUSDRate, config.QuotaPerUnit = rate, unit }()
	config.PaymentUSDRate, config.QuotaPerUnit = 7.3, 500000
	for quota, want := range map[int]string{684932: "1000 积分", 6850: "10 积分", -500000: "-730 积分", 0: "0 积分"} {
		if got := LogQuota(quota); got != want {
			t.Errorf("LogQuota(%d) = %q, want %q", quota, got, want)
		}
	}
	config.PaymentUSDRate = 0
	if got := LogQuota(5); got != "5 点额度" {
		t.Errorf("invalid rate: got %q", got)
	}
}
