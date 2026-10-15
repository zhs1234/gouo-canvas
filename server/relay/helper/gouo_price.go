package helper

import (
	"errors"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	hosttypes "github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// gouoPriceData 仅限制入口；图片请求始终使用 New API 的原生预扣和结算。
func gouoPriceData(c *gin.Context, info *relaycommon.RelayInfo) (hosttypes.PriceData, bool, error) {
	if _, ok := c.Get(GouoImageContextKey); ok {
		return hosttypes.PriceData{}, false, nil
	}
	if model.IsGouoImageModel(info.OriginModelName) {
		return hosttypes.PriceData{}, true, errors.New("此模型只能通过图片生成接口调用")
	}
	return hosttypes.PriceData{}, false, nil
}

// GouoImageContextKey 标记需要去重和保存恢复结果的图片请求。
const GouoImageContextKey = "gouo_image"
