package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGouoBalanceRemindSetting(t *testing.T) {
	for _, value := range []string{"0", "100", "1000000"} {
		got, err := normalizeGouoSetting("GouoBalanceRemindPoints", value)
		require.NoError(t, err, value)
		require.Equal(t, value, got)
	}
	for _, value := range []string{"-1", "1000001", "abc", "1.5", ""} {
		_, err := normalizeGouoSetting("GouoBalanceRemindPoints", value)
		require.Error(t, err, value)
	}
	require.Contains(t, gouoSettingKeys, "GouoBalanceRemindPoints")
}
