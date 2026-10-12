package controller

import (
	"testing"

	"one-api/model"

	"github.com/stretchr/testify/require"
)

func TestMarkGouoDefaultModel(t *testing.T) {
	catalog := func() []*model.GouoImageModel {
		return []*model.GouoImageModel{{ID: "image-a"}, {ID: "image-b"}}
	}
	defaults := func(models []*model.GouoImageModel) []string {
		var ids []string
		for _, entry := range models {
			if entry.Default {
				ids = append(ids, entry.ID)
			}
		}
		return ids
	}
	// 后台设置的默认模型可用时标出它
	models := catalog()
	markGouoDefaultModel(models, " image-b ")
	require.Equal(t, []string{"image-b"}, defaults(models))
	// 未设置或对当前令牌不可用时，取目录第一个
	for _, preferred := range []string{"", "image-x"} {
		models = catalog()
		markGouoDefaultModel(models, preferred)
		require.Equal(t, []string{"image-a"}, defaults(models))
	}
	markGouoDefaultModel(nil, "image-a")
}
