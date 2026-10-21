package types

import (
	"encoding/json"
	"testing"

	"one-api/common/config"

	"github.com/stretchr/testify/require"
)

func TestUsageCachedTokensFromOpenAIAndDeepSeek(t *testing.T) {
	var deepseek Usage
	require.NoError(t, json.Unmarshal([]byte(`{"prompt_tokens":6000,"completion_tokens":200,"prompt_cache_hit_tokens":5000,"prompt_cache_miss_tokens":1000}`), &deepseek))
	require.Equal(t, 5000, deepseek.GetExtraTokens()[config.UsageExtraCache])

	// 两种字段都有时以 prompt_tokens_details 为准
	var openai Usage
	require.NoError(t, json.Unmarshal([]byte(`{"prompt_tokens":6000,"prompt_tokens_details":{"cached_tokens":4096},"prompt_cache_hit_tokens":5000}`), &openai))
	require.Equal(t, 4096, openai.GetExtraTokens()[config.UsageExtraCache])
}
