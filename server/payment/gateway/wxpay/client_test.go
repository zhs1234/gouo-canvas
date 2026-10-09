package wxpay

import "testing"

func TestMoneyToFenRoundsDecimalAmounts(t *testing.T) {
	tests := []struct {
		money float64
		fen   int64
	}{
		{0.01, 1},
		{0.29, 29},
		{1.15, 115},
		{1.29, 129},
		{8.7, 870},
		{19.99, 1999},
		{100, 10000},
		{4.35, 435},
		{2.01, 201},
	}
	for _, tt := range tests {
		// 旧实现 int64(money*100) 会把其中多项截断少一分
		if got := moneyToFen(tt.money); got != tt.fen {
			t.Errorf("moneyToFen(%v) = %d, want %d", tt.money, got, tt.fen)
		}
	}
}
