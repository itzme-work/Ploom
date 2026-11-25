// SPDX-License-Identifier: GPL-3.0-or-later
package libbox
 
import "github.com/sagernet/sing-box/daemon"

type PloomTraffic struct {
	Upload int64
	Download int64
}

func (s *CommandServer) PloomTraffic() *PloomTraffic {
	up, down, ok := daemon.PloomTotals(s.StartedService)
	if !ok { return nil }
	return &PloomTraffic{Upload:up, Download:down}
}
