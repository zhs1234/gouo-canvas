package relay_util

import (
	"one-api/common/config"
	"testing"
)

func TestGetFixedImageQuota(t *testing.T) {
	originalPrice := config.GouoImagePriceCNY
	originalRate := config.PaymentUSDRate
	originalQuotaPerUnit := config.QuotaPerUnit
	t.Cleanup(func() {
		config.GouoImagePriceCNY = originalPrice
		config.PaymentUSDRate = originalRate
		config.QuotaPerUnit = originalQuotaPerUnit
	})

	config.GouoImagePriceCNY = 0.1
	config.PaymentUSDRate = 7.3
	config.QuotaPerUnit = 500000

	want := 6850
	paths := []string{
		"/v1/images/generations",
		"/v1/images/edits",
		"/v1/images/variations",
	}
	for _, path := range paths {
		if got := getFixedImageQuota(path); got != want {
			t.Fatalf("getFixedImageQuota(%q) = %d, want %d", path, got, want)
		}
	}
	if got := getFixedImageQuota("/v1/chat/completions"); got != 0 {
		t.Fatalf("non-image request quota = %d, want 0", got)
	}
}
