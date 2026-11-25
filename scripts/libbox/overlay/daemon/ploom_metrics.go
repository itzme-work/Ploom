// SPDX-License-Identifier: GPL-3.0-or-later
// Ploom addition. Expose aggregate counters without a network control listener.
package daemon

func (s *StartedService) PloomTotals() (int64, int64, bool) {
	s.serviceAccess.RLock()
	defer s.serviceAccess.RUnlock()
	if s.instance == nil || s.instance.trafficManager == nil {
		return 0, 0, false
	}
	up, down := s.instance.trafficManager.Total()
	return up, down, true
}
