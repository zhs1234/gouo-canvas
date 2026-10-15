package model

import (
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// 光构客户端用到的模型能力写在 New API 模型管理的标签里
const (
	GouoTagEdit   = "edit"   // 图片模型支持参考图编辑
	GouoTagMask   = "mask"   // 图片模型支持遮罩编辑，需同时带 edit
	GouoTagTools  = "tools"  // 文本模型支持工具调用，出现在 Agent 目录
	GouoTagVision = "vision" // Agent 模型能理解上传的图片
)

// GouoBillingMode 区分原生表达式、旧按次价格和 token 倍率，客户端据此展示计费单位。
func GouoBillingMode(id string) string {
	if billing_setting.GetBillingMode(id) == billing_setting.BillingModeTieredExpr {
		return billing_setting.BillingModeTieredExpr
	}
	if _, fixed := ratio_setting.GetModelPrice(id, false); fixed {
		return "per_request"
	}
	return billing_setting.BillingModeRatio
}

// GouoImageModel 是客户端看到的图片模型目录项
type GouoImageModel struct {
	BillingMode  string `json:"billing_mode"`
	ID           string `json:"id"`
	Reference    bool   `json:"reference"`
	Mask         bool   `json:"mask"`
	PriceVersion string `json:"price_version"`
	// 以下字段在价格版本算好后才设置，不参与版本计算：改说明不会让用户重新确认价格
	Default     bool   `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
}

// 各分辨率档位允许的最大像素数，与客户端尺寸选择的档位一致；尺寸按像素数归入能容纳它的最小档位
var GouoSizeTierPixels = map[string]int{"1K": 1024 * 1536, "2K": 2048 * 2048, "4K": 3840 * 2160}
var GouoSizeTiers = []string{"1K", "2K", "4K"}

// GouoSizeTier 返回 WxH 尺寸所属的分辨率档位，超出 4K 时返回空
func GouoSizeTier(width, height int) string {
	for _, tier := range GouoSizeTiers {
		if width*height <= GouoSizeTierPixels[tier] {
			return tier
		}
	}
	return ""
}

// GouoModelTags 解析 New API 模型管理里逗号分隔的标签，统一小写
func GouoModelTags(tags string) []string {
	var list []string
	for tag := range strings.SplitSeq(tags, ",") {
		if tag = strings.ToLower(strings.TrimSpace(tag)); tag != "" {
			list = append(list, tag)
		}
	}
	return list
}

// IsGouoImagePricing 判断 New API 是否把该模型识别为图片生成模型（按名称推断或模型管理里声明的端点）
func IsGouoImagePricing(p Pricing) bool {
	return slices.Contains(p.SupportedEndpointTypes, constant.EndpointTypeImageGeneration)
}

// GouoImageModelEntry 用 New API 原生模型资料生成客户端的图片模型目录项；
// 价格版本包含生效定价和能力标签，任一变化都要求客户端重新确认
func GouoImageModelEntry(p Pricing) (*GouoImageModel, error) {
	tags := GouoModelTags(p.Tags)
	reference := slices.Contains(tags, GouoTagEdit)
	entry := &GouoImageModel{ID: p.ModelName, BillingMode: GouoBillingMode(p.ModelName), Reference: reference, Mask: reference && slices.Contains(tags, GouoTagMask)}
	expression, _ := billing_setting.GetBillingExpr(p.ModelName)
	price, _ := ratio_setting.GetModelPrice(p.ModelName, false)
	ratio, _, _ := ratio_setting.GetModelRatio(p.ModelName)
	data, err := common.Marshal([]any{entry, expression, price, ratio, ratio_setting.GetCompletionRatio(p.ModelName)})
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	entry.PriceVersion = hex.EncodeToString(hash[:])
	entry.Description = p.Description
	return entry, nil
}

// FindGouoImageModel 返回 New API 识别为图片生成且已启用的模型目录项；不是图片模型时返回 nil
func FindGouoImageModel(id string) (*GouoImageModel, error) {
	for _, p := range GetPricing() {
		if p.ModelName == id && IsGouoImagePricing(p) {
			return GouoImageModelEntry(p)
		}
	}
	return nil, nil
}
