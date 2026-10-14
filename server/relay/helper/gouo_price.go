package helper

import (
	"errors"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	hosttypes "github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// gouoPriceData 处理光构图片模型的定价：图片接口的请求由光构账本按次计费，New API 这一侧不再收费；
// 其他入口（任务、Midjourney 等）不经过光构账本，一律拒绝，避免绕过账本免费调用
func gouoPriceData(c *gin.Context, info *relaycommon.RelayInfo) (hosttypes.PriceData, bool, error) {
	if _, ok := c.Get(GouoImageContextKey); ok {
		info.PriceData = hosttypes.PriceData{FreeModel: true, UsePrice: true, GroupRatioInfo: HandleGroupRatio(c, info)}
		return info.PriceData, true, nil
	}
	if model.IsGouoImageModel(info.OriginModelName) {
		return hosttypes.PriceData{}, true, errors.New("此模型只能通过图片生成接口调用")
	}
	return hosttypes.PriceData{}, false, nil
}

// GouoImageContextKey 标记当前请求由光构账本计费，值是 relay 包里的请求状态
const GouoImageContextKey = "gouo_image"
