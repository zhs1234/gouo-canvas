package common

import (
	"fmt"
	"math"
	"one-api/common/config"
	"strconv"
)

// 日志按积分记录（1 元 = 100 积分），与客户端、后台的展示一致；汇率配置无效时退回原始额度
func LogQuota(quota int) string {
	points := float64(quota) / config.QuotaPerUnit * config.PaymentUSDRate * 100
	if config.QuotaPerUnit <= 0 || config.PaymentUSDRate <= 0 || math.IsNaN(points) || math.IsInf(points, 0) {
		return fmt.Sprintf("%d 点额度", quota)
	}
	return strconv.FormatFloat(math.Round(points*100)/100, 'f', -1, 64) + " 积分"
}
