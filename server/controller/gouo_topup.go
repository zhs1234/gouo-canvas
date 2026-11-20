package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	"one-api/common/config"
	"one-api/common/logger"
	"one-api/common/utils"
	"one-api/model"
	"one-api/payment"

	"github.com/gin-gonic/gin"
)

type gouoTopupPackage struct {
	Price  float64 `json:"price"`
	Points int     `json:"points"`
	Bonus  int     `json:"bonus"`
}

type gouoTopupOrderRequest struct {
	Gateway string `json:"gateway"`
	Package *int   `json:"package"`
	Amount  *int   `json:"amount"`
	// 客户端看到的积分包价格和到账积分，用来发现后台已改过积分包
	Price  *float64 `json:"price"`
	Points *int     `json:"points"`
}

type gouoTopupOrder struct {
	TradeNo   string             `json:"trade_no"`
	Status    model.OrderStatus  `json:"status"`
	Points    int                `json:"points"`
	PayAmount float64            `json:"pay_amount"`
	Currency  model.CurrencyType `json:"currency"`
	CreatedAt int                `json:"created_at"`
}

// 保存设置时用它拒绝非法配置
func parseGouoTopupPackages(raw string) ([]gouoTopupPackage, error) {
	invalid := errors.New("积分包配置必须是 JSON 数组，每项只包含 price、points、bonus")
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	var packages []gouoTopupPackage
	if err := dec.Decode(&packages); err != nil || packages == nil {
		return nil, invalid
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, invalid
	}
	if len(packages) > 12 {
		return nil, errors.New("积分包最多 12 个")
	}
	for i, p := range packages {
		cents := p.Price * 100
		if math.IsNaN(cents) || p.Price <= 0 || p.Price > 100000 || math.Abs(cents-math.Round(cents)) > 1e-6 {
			return nil, fmt.Errorf("第 %d 个积分包的价格必须大于 0、不超过 100000 元，最多两位小数", i+1)
		}
		if p.Points < 1 || p.Points > 10000000 || p.Bonus < 0 || p.Bonus > 10000000 {
			return nil, fmt.Errorf("第 %d 个积分包的积分必须是 1 到 10000000 的整数，赠送积分必须是 0 到 10000000 的整数", i+1)
		}
	}
	return packages, nil
}

// gouoTopupQuota 把到账积分换算成额度（1 元 = 100 积分，与图片计费和日志一致）；超出订单能记录的范围时返回 0
func gouoTopupQuota(points int) int {
	quota := math.Round(float64(points) / 100 / config.PaymentUSDRate * config.QuotaPerUnit)
	if math.IsNaN(quota) || math.IsInf(quota, 0) || quota < 1 || quota > math.MaxInt32 {
		return 0
	}
	return int(quota)
}

// checkGouoTopupPoints 保存设置时检查单笔到账积分按当前汇率能否下单，免得保存了却永远买不了
func checkGouoTopupPoints(points int, what string) error {
	if gouoTopupQuota(points) > 0 {
		return nil
	}
	return fmt.Errorf("%s按当前汇率超出单笔充值上限，单笔最多约 %d 积分", what, int(float64(math.MaxInt32)*config.PaymentUSDRate*100/config.QuotaPerUnit))
}

// 运行时配置解析失败按无积分包处理
func gouoTopupPackages() []gouoTopupPackage {
	packages, err := parseGouoTopupPackages(config.GouoTopupPackages)
	if err != nil {
		logger.SysError("光构积分包配置无效: " + err.Error())
		return []gouoTopupPackage{}
	}
	return packages
}

// gouoTopupStatus 供 /api/status 使用；在线充值关闭或没有启用的网关时不返回积分包和自定义金额
func gouoTopupStatus() (bool, []gouoTopupPackage, gin.H) {
	if !config.GouoOnlineTopup || !model.HasEnabledPayment() {
		return false, []gouoTopupPackage{}, nil
	}
	if !config.GouoTopupCustom {
		return true, gouoTopupPackages(), nil
	}
	return true, gouoTopupPackages(), gin.H{"min": config.GouoTopupCustomMin, "max": config.GouoTopupCustomMax}
}

// CreateGouoTopupOrder 按人民币积分包或自定义金额下单，价格和到账积分只按服务端当前配置计算
func CreateGouoTopupOrder(c *gin.Context) {
	if !config.GouoOnlineTopup {
		gouoFail(c, http.StatusForbidden, "topup_disabled", "在线充值暂未开放，请使用兑换码充值")
		return
	}
	var req gouoTopupOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || (req.Package == nil) == (req.Amount == nil) {
		gouoFail(c, http.StatusBadRequest, "invalid_request", "请选择一个积分包或填写充值金额")
		return
	}
	var price float64
	var points int
	if req.Package != nil {
		packages := gouoTopupPackages()
		if *req.Package < 0 || *req.Package >= len(packages) {
			gouoFail(c, http.StatusBadRequest, "invalid_package", "积分包不存在，请刷新后重试")
			return
		}
		pkg := packages[*req.Package]
		price, points = pkg.Price, pkg.Points+pkg.Bonus
		// 积分包按序号下单，后台增删或调整过积分包时同一序号可能已是另一个包，不能按新包收款
		if (req.Price != nil && math.Abs(*req.Price-price) > 1e-9) || (req.Points != nil && *req.Points != points) {
			gouoFail(c, http.StatusConflict, "package_changed", "积分包已更新，请重新选择后再支付")
			return
		}
	} else {
		if !config.GouoTopupCustom {
			gouoFail(c, http.StatusBadRequest, "custom_disabled", "暂不支持自定义金额，请选择积分包")
			return
		}
		if *req.Amount < config.GouoTopupCustomMin || *req.Amount > config.GouoTopupCustomMax {
			gouoFail(c, http.StatusBadRequest, "invalid_amount", fmt.Sprintf("充值金额必须是 %d 到 %d 元的整数", config.GouoTopupCustomMin, config.GouoTopupCustomMax))
			return
		}
		price, points = float64(*req.Amount), *req.Amount*100
	}
	rate := config.PaymentUSDRate
	quota := gouoTopupQuota(points)
	if quota == 0 {
		gouoFail(c, http.StatusBadRequest, "invalid_quota", "充值额度超出范围")
		return
	}

	paymentService, err := payment.NewPaymentService(req.Gateway)
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "invalid_gateway", "支付方式不存在或已停用")
		return
	}
	gateway := paymentService.Payment
	if (gateway.Currency != model.CurrencyTypeCNY && gateway.Currency != model.CurrencyTypeUSD) || (gateway.Type != "stripe" && gateway.Currency != model.CurrencyTypeCNY) {
		gouoFail(c, http.StatusBadRequest, "invalid_gateway", "支付网关币种配置无效")
		return
	}
	// 手续费语义同 calculateOrderAmount：比例费按价格计，固定费以「单位」计，人民币网关按汇率换成元；积分包不再叠加充值折扣
	base := price
	if gateway.Currency == model.CurrencyTypeUSD {
		base = utils.Decimal(price/rate, 2)
	}
	fee := 0.0
	if gateway.PercentFee > 0 {
		fee = utils.Decimal(base*gateway.PercentFee, 2)
	} else if gateway.FixedFee > 0 {
		fee = gateway.FixedFee
		if gateway.Currency == model.CurrencyTypeCNY {
			fee = utils.Decimal(gateway.FixedFee*rate, 2)
		}
	}
	payMoney := utils.Decimal(base+fee, 2)
	if math.IsNaN(payMoney) || math.IsInf(payMoney, 0) || payMoney <= 0 || payMoney > 99999999.99 {
		gouoFail(c, http.StatusBadRequest, "invalid_pay_amount", "支付金额无效")
		return
	}
	// 订单表的手续费与旧订单一致按「单位」记录（后台显示为 $）
	orderFee := fee
	if gateway.Currency == model.CurrencyTypeCNY {
		orderFee = utils.Decimal(fee/rate, 2)
	}

	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		gouoFail(c, http.StatusBadRequest, "user_not_found", "用户不存在")
		return
	}
	// 同 CreateOrder 关闭超时未付的订单；同步执行，失败不影响下单
	if err := model.CloseUnfinishedOrder(); err != nil {
		logger.LogError(c.Request.Context(), "关闭超时订单失败: "+err.Error())
	}

	tradeNo := utils.GenerateTradeNo()
	order := &model.Order{
		UserId:    userId,
		GatewayId: gateway.ID,
		TradeNo:   tradeNo,
		// Amount 沿用旧语义「充值单位数」，后台订单列表显示为 $；到账、分组升级和统计只用 Quota 与 OrderAmount
		Amount:        int(math.Round(float64(quota) / config.QuotaPerUnit)),
		OrderAmount:   payMoney,
		OrderCurrency: gateway.Currency,
		Fee:           orderFee,
		Status:        model.OrderStatusPending,
		Quota:         quota,
		Points:        points,
	}
	if err := order.Insert(); err != nil {
		logger.LogError(c.Request.Context(), "创建充值订单失败: "+err.Error())
		gouoFail(c, http.StatusInternalServerError, "order_create_failed", "创建订单失败，请稍后再试")
		return
	}
	// 先保存订单，避免快速回调找不到订单；上游超时也保留对账依据
	payRequest, err := paymentService.PayGouoTopup(tradeNo, payMoney, user)
	if err != nil {
		logger.LogError(c.Request.Context(), "创建支付失败: "+err.Error())
		gouoFail(c, http.StatusBadGateway, "payment_create_failed", "创建支付失败，请稍后再试")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"trade_no":   tradeNo,
		"type":       payRequest.Type,
		"data":       payRequest.Data,
		"pay_amount": payMoney,
		"currency":   gateway.Currency,
		"points":     points,
	}})
}

// ListGouoTopupOrders 返回本人最近 20 条订单，积分按订单额度换算
func ListGouoTopupOrders(c *gin.Context) {
	orders, err := model.GetGouoUserOrders(c.GetInt("id"), c.Query("trade_no"), 20)
	if err != nil {
		logger.LogError(c.Request.Context(), "读取充值订单失败: "+err.Error())
		gouoFail(c, http.StatusInternalServerError, "order_read_failed", "读取订单失败，请稍后重试")
		return
	}
	items := make([]gouoTopupOrder, 0, len(orders))
	for _, order := range orders {
		// 记录到账积分之前的旧订单按当前汇率折算
		if order.Points == 0 {
			order.Points = int(math.Round(float64(order.Quota) / config.QuotaPerUnit * config.PaymentUSDRate * 100))
		}
		items = append(items, gouoTopupOrder{
			TradeNo:   order.TradeNo,
			Status:    order.Status,
			Points:    order.Points,
			PayAmount: order.OrderAmount,
			Currency:  order.OrderCurrency,
			CreatedAt: order.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": items})
}
