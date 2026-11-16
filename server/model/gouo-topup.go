package model

// HasEnabledPayment 在线充值至少需要一个启用的支付网关
func HasEnabledPayment() bool {
	var count int64
	if err := DB.Model(&Payment{}).Where("enable = ?", true).Count(&count).Error; err != nil {
		return false
	}
	return count > 0
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
