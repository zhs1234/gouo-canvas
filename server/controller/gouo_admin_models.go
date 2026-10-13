package controller

import (
	"net/http"
	"one-api/common/config"
	"one-api/model"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

type gouoAdminChannel struct {
	ID     int      `json:"id"`
	Name   string   `json:"name"`
	Status int      `json:"status"`
	Groups []string `json:"groups"`
}

type gouoAdminModel struct {
	Model      string             `json:"model"`
	Priced     bool               `json:"priced"`
	Enabled    bool               `json:"gouo_enabled"`
	PriceCNY   float64            `json:"gouo_price_cny"`
	Reference  bool               `json:"gouo_reference"`
	Mask       bool               `json:"gouo_mask"`
	MaxOutputs int                `json:"gouo_max_outputs"`
	Error      string             `json:"error,omitempty"`
	Channels   []gouoAdminChannel `json:"channels"`
}

// ListGouoAdminModels 列出已定价或已配置在渠道上的模型，以及各自的光构配置和支持它的渠道，
// 便于在一处看到哪些模型会出现在客户端
func ListGouoAdminModels(c *gin.Context) {
	var channels []*model.Channel
	if err := model.DB.Find(&channels).Error; err != nil {
		gouoFail(c, http.StatusInternalServerError, "channels_unavailable", "读取渠道失败")
		return
	}
	byModel := map[string]*gouoAdminModel{}
	entry := func(id string) *gouoAdminModel {
		if byModel[id] == nil {
			byModel[id] = &gouoAdminModel{Model: id, MaxOutputs: 1, Channels: []gouoAdminChannel{}}
		}
		return byModel[id]
	}
	model.PricingInstance.RLock()
	for id, price := range model.PricingInstance.Prices {
		item := entry(id)
		item.Priced = true
		item.Enabled, item.PriceCNY, item.Reference, item.Mask, item.MaxOutputs = price.GouoEnabled, price.GouoPriceCNY, price.GouoReference, price.GouoMask, price.GouoMaxOutputs
	}
	model.PricingInstance.RUnlock()
	for _, channel := range channels {
		groups := splitTrimmed(channel.Group)
		for _, id := range splitTrimmed(channel.Models) {
			item := entry(id)
			item.Channels = append(item.Channels, gouoAdminChannel{ID: channel.Id, Name: channel.Name, Status: channel.Status, Groups: groups})
		}
	}
	models := make([]*gouoAdminModel, 0, len(byModel))
	for _, item := range byModel {
		if item.Enabled {
			if _, err := model.PricingInstance.GetGouoModel(item.Model); err != nil {
				item.Error = err.Error()
			}
		}
		models = append(models, item)
	}
	// 已启用的排在前面，其余按名称
	sort.Slice(models, func(i, j int) bool {
		if models[i].Enabled != models[j].Enabled {
			return models[i].Enabled
		}
		return models[i].Model < models[j].Model
	})
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"default_model": config.GouoDefaultImageModel, "models": models}})
}

// UpdateGouoAdminModel 修改一个模型的光构配置；模型还没有价格记录时新建一条，只用于光构计费
func UpdateGouoAdminModel(c *gin.Context) {
	var input struct {
		Model      string  `json:"model"`
		Enabled    bool    `json:"gouo_enabled"`
		PriceCNY   float64 `json:"gouo_price_cny"`
		Reference  bool    `json:"gouo_reference"`
		Mask       bool    `json:"gouo_mask"`
		MaxOutputs int     `json:"gouo_max_outputs"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Model) == "" || len(input.Model) > 100 {
		gouoFail(c, http.StatusBadRequest, "invalid_model", "模型名称无效")
		return
	}
	id := strings.TrimSpace(input.Model)
	model.PricingInstance.RLock()
	existing, ok := model.PricingInstance.Prices[id]
	var price model.Price
	if ok {
		price = *existing
	}
	model.PricingInstance.RUnlock()
	if !ok {
		price = model.Price{Model: id, Type: model.TimesPriceType, ChannelType: config.ChannelTypeUnknown}
	}
	price.GouoEnabled, price.GouoPriceCNY, price.GouoReference, price.GouoMask, price.GouoMaxOutputs = input.Enabled, input.PriceCNY, input.Reference, input.Mask, input.MaxOutputs
	if price.GouoMaxOutputs < 1 {
		price.GouoMaxOutputs = 1
	}
	var err error
	if ok {
		err = model.PricingInstance.UpdatePrice(id, &price)
	} else {
		err = model.PricingInstance.AddPrice(&price)
	}
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_gouo_price", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func splitTrimmed(value string) []string {
	var items []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}
