package model

import (
	"sync"
	"time"
)

var enabledPayment struct {
	sync.Mutex
	at    time.Time
	value bool
}

// HasEnabledPayment 在线充值至少需要一个启用的支付网关。公开的 /api/status 每次都会调用，结果缓存 30 秒；
// 本实例保存网关时立即失效，其他实例最多 30 秒后看到变化
func HasEnabledPayment() bool {
	enabledPayment.Lock()
	defer enabledPayment.Unlock()
	if time.Since(enabledPayment.at) < 30*time.Second {
		return enabledPayment.value
	}
	var count int64
	if err := DB.Model(&Payment{}).Where("enable = ?", true).Count(&count).Error; err != nil {
		return false
	}
	enabledPayment.at, enabledPayment.value = time.Now(), count > 0
	return enabledPayment.value
}

// ResetEnabledPaymentCache 网关增删改后让下一次判断重新查库；直接写表的测试也需要调用
func ResetEnabledPaymentCache() {
	enabledPayment.Lock()
	enabledPayment.at = time.Time{}
	enabledPayment.Unlock()
}

// GetGouoUserOrders 返回用户最近的订单，tradeNo 非空时只查这一条
func GetGouoUserOrders(userId int, tradeNo string, limit int) ([]*Order, error) {
	var orders []*Order
	db := DB.Where("user_id = ?", userId)
	if tradeNo != "" {
		db = db.Where("trade_no = ?", tradeNo)
	}
	err := db.Order("id desc").Limit(limit).Find(&orders).Error
	return orders, err
}
