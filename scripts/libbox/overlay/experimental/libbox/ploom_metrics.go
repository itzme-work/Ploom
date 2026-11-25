// SPDX-License-Identifier: GPL-3.0-or-later
package libbox

type PloomTraffic struct {
	Upload int64
	Download int64
}

func (s *CommandServer) PloomTraffic() *PloomTraffic {
	up, down, ok := s.StartedService.PloomTotals()
	if !ok { return nil }
	return &PloomTraffic{Upload:up, Download:down}
}
