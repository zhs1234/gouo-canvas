package image_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"one-api/common/config"
	img "one-api/common/image"

	"github.com/stretchr/testify/require"
)

func TestGetImageFromUrlRejectsInternalAddresses(t *testing.T) {
	oldProxy, oldWorker := config.ChatImageRequestProxy, config.CFWorkerImageUrl
	t.Cleanup(func() { config.ChatImageRequestProxy, config.CFWorkerImageUrl = oldProxy, oldWorker })
	config.CFWorkerImageUrl = ""
	var hits int
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer internal.Close()

	for _, proxy := range []string{"", "http://127.0.0.1:9"} {
		config.ChatImageRequestProxy = proxy
		_, _, err := img.GetImageFromUrl(internal.URL + "/image.png")
		require.Error(t, err, proxy)
		_, _, err = img.GetImageSize(internal.URL + "/image.png")
		require.Error(t, err, proxy)
	}
	require.Zero(t, hits)
}
