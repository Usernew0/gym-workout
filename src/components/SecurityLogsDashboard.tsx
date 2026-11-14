import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldAlert, ShieldCheck, AlertTriangle, Lock, Unlock, 
  Clock, Search, Filter, RefreshCw, Download, 
  Terminal, Globe, User, CheckCircle2, XCircle, Info, Sparkles,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { UserActivityLog } from '../types';
import { formatMilestoneDateInEgypt } from '../utils';

interface SecurityLogsDashboardProps {
  activityLogs: UserActivityLog[];
  onRefreshLogs?: () => void;
  onSimulateTestAlert?: () => void;
  defaultCollapsed?: boolean;
}

type ThreatSeverity = 'all' | 'critical' | 'warning' | 'unusual_time' | 'tamper' | 'two_factor';

interface ParsedSecurityEvent {
  log: UserActivityLog;
  severity: 'critical' | 'warning' | 'suspicious' | 'info';
  extractedIp: string;
  isUnusualTime: boolean;
  timeHour: number;
  timeStr: string;
  category: 'lockout' | 'failed_login' | 'unusual_time' | 'tamper' | 'auto_logout' | 'auth_change' | 'two_factor';
}

export const SecurityLogsDashboard: React.FC<SecurityLogsDashboardProps> = ({
  activityLogs,
  onRefreshLogs,
  onSimulateTestAlert,
  defaultCollapsed = true
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('admin_security_dashboard_collapsed');
      if (saved !== null) return saved === 'true';
    } catch {}
    return defaultCollapsed;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<ThreatSeverity>('all');
  const [selectedLog, setSelectedLog] = useState<ParsedSecurityEvent | null>(null);

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('admin_security_dashboard_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Helper to extract IP and analyze event
  const parsedEvents: ParsedSecurityEvent[] = useMemo(() => {
    return activityLogs

      .filter(l => {
        const actionLower = (l.action || '').toLowerCase();
        const detailsLower = (l.details || '').toLowerCase();
        return (
          actionLower.startsWith('security_') ||
          actionLower.includes('login') ||
          actionLower.includes('logout') ||
          actionLower.includes('credentials') ||
          actionLower.includes('password') ||
          actionLower.includes('tamper') ||
          actionLower.includes('lockout') ||
          detailsLower.includes('lockout') ||
          detailsLower.includes('failed') ||
          detailsLower.includes('unusual') ||
          detailsLower.includes('bypass')
        );
      })
      .map(log => {
        const actionLower = log.action.toLowerCase();
        const detailsLower = (log.details || '').toLowerCase();

        // Extract IP address from details string if present (e.g. IP: 197.38.12.9)
        const ipMatch = log.details.match(/IP:\s*([a-zA-Z0-9\.\_\:\-]+)/i);
        const extractedIp = ipMatch ? ipMatch[1].trim() : 'Local / Browser';

        // Parse date in Egypt timezone
        let dateObj = new Date(log.timestamp);
        if (isNaN(dateObj.getTime())) {
          dateObj = new Date();
        }
        const hour = dateObj.getHours();
        const isUnusualTime = (hour >= 1 && hour < 5) || detailsLower.includes('unusual');

        let severity: 'critical' | 'warning' | 'suspicious' | 'info' = 'info';
        let category: ParsedSecurityEvent['category'] = 'auth_change';

        if (actionLower.includes('lockout') || detailsLower.includes('locked out')) {
          severity = 'critical';
          category = 'lockout';
        } else if (actionLower.includes('tamper') || detailsLower.includes('bypass') || detailsLower.includes('tamper')) {
          severity = 'critical';
          category = 'tamper';
        } else if (actionLower.includes('backup_code') || detailsLower.includes('backup code') || detailsLower.includes('recovery code')) {
          severity = 'warning';
          category = 'two_factor';
        } else if (actionLower.includes('2fa') || detailsLower.includes('two-factor') || detailsLower.includes('totp') || detailsLower.includes('authenticator')) {
          severity = actionLower.includes('failed') ? 'warning' : 'info';
          category = 'two_factor';
        } else if (actionLower.includes('failed_login') || detailsLower.includes('failed login')) {
          severity = 'warning';
          category = 'failed_login';
        } else if (actionLower.includes('unusual_time') || isUnusualTime) {
          severity = 'suspicious';
          category = 'unusual_time';
        } else if (actionLower.includes('auto_logout')) {
          severity = 'info';
          category = 'auto_logout';
        }

        const timeStr = dateObj.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });

        return {
          log,
          severity,
          extractedIp,
          isUnusualTime,
          timeHour: hour,
          timeStr,
          category
        };
      });
  }, [activityLogs]);

  // Pattern Detection Engine: Group suspicious activity by IP and by Username
  const patternAnalysis = useMemo(() => {
    const ipCounts: { [ip: string]: { count: number; users: Set<string>; lockouts: number } } = {};
    const userFailedCounts: { [username: string]: number } = {};

    parsedEvents.forEach(e => {
      const ip = e.extractedIp;
      if (!ipCounts[ip]) {
        ipCounts[ip] = { count: 0, users: new Set(), lockouts: 0 };
      }
      ipCounts[ip].count++;
      ipCounts[ip].users.add(e.log.username);

      if (e.category === 'lockout') {
        ipCounts[ip].lockouts++;
      }

      if (e.category === 'failed_login' || e.category === 'lockout') {
        const u = e.log.username.toLowerCase().trim();
        userFailedCounts[u] = (userFailedCounts[u] || 0) + 1;
      }
    });

    const suspiciousIps = Object.entries(ipCounts)
      .filter(([ip, data]) => ip !== 'Local / Browser' && (data.count >= 3 || data.lockouts > 0))
      .map(([ip, data]) => ({
        ip,
        incidents: data.count,
        usersTargeted: Array.from(data.users),
        lockouts: data.lockouts
      }));

    const targetedUsers = Object.entries(userFailedCounts)
      .filter(([, count]) => count >= 2)
      .map(([username, count]) => ({ username, failedCount: count }));

    return {
      suspiciousIps,
      targetedUsers
    };
  }, [parsedEvents]);

  // Aggregate Metrics
  const stats = useMemo(() => {
    const total = parsedEvents.length;
    const lockouts = parsedEvents.filter(e => e.category === 'lockout').length;
    const failedLogins = parsedEvents.filter(e => e.category === 'failed_login').length;
    const unusualTimes = parsedEvents.filter(e => e.isUnusualTime).length;
    const tampers = parsedEvents.filter(e => e.category === 'tamper').length;
    const twoFactorEvents = parsedEvents.filter(e => e.category === 'two_factor').length;

    let threatLevel: 'LOW' | 'ELEVATED' | 'HIGH' = 'LOW';
    if (lockouts > 0 || tampers > 0 || failedLogins >= 5) {
      threatLevel = 'HIGH';
    } else if (failedLogins > 1 || unusualTimes > 0) {
      threatLevel = 'ELEVATED';
    }

    return { total, lockouts, failedLogins, unusualTimes, tampers, twoFactorEvents, threatLevel };
  }, [parsedEvents]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return parsedEvents.filter(item => {
      // Filter tab
      if (selectedFilter === 'critical' && item.severity !== 'critical') return false;
      if (selectedFilter === 'warning' && item.category !== 'failed_login') return false;
      if (selectedFilter === 'unusual_time' && !item.isUnusualTime) return false;
      if (selectedFilter === 'tamper' && item.category !== 'tamper') return false;
      if (selectedFilter === 'two_factor' && item.category !== 'two_factor') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchUser = item.log.username.toLowerCase().includes(q);
        const matchAction = item.log.action.toLowerCase().includes(q);
        const matchDetails = item.log.details.toLowerCase().includes(q);
        const matchIp = item.extractedIp.toLowerCase().includes(q);
        return matchUser || matchAction || matchDetails || matchIp;
      }
      return true;
    });
  }, [parsedEvents, selectedFilter, searchQuery]);

  // Export logs as forensic JSON
  const handleExportJson = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      threatLevel: stats.threatLevel,
      summary: stats,
      suspiciousPatterns: patternAnalysis,
      incidents: parsedEvents.map(e => ({
        id: e.log.id,
        timestamp: e.log.timestamp,
        username: e.log.username,
        action: e.log.action,
        severity: e.severity,
        ipAddress: e.extractedIp,
        details: e.log.details
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security_audit_report_${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* HEADER TITLE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-400 shadow-inner">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-serif font-bold text-white tracking-wide">Security Logs & Threat Dashboard</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${
                stats.threatLevel === 'HIGH' 
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' 
                  : stats.threatLevel === 'ELEVATED'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}>
                Threat Level: {stats.threatLevel}
              </span>

              {isCollapsed && (
                <span className="px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400 border border-white/10 text-[10px] font-mono">
                  Collapsed
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-400 font-mono mt-0.5">
              Automated pattern detection for brute-force logins, off-hour access, and storage tamper attempts
            </p>
          </div>
        </div>

        {/* TOP ACTIONS */}
        <div className="flex items-center gap-2 flex-wrap">
          {isCollapsed && stats.total > 0 && (
            <div className="hidden md:flex items-center gap-1.5 mr-1 font-mono text-[11px]">
              <span className="px-2 py-1 rounded-xl bg-neutral-950 border border-white/10 text-neutral-300">
                <strong className="text-white">{stats.total}</strong> Events
              </span>
              {stats.failedLogins > 0 && (
                <span className="px-2 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
                  <strong>{stats.failedLogins}</strong> Failed
                </span>
              )}
              {stats.lockouts > 0 && (
                <span className="px-2 py-1 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  <strong>{stats.lockouts}</strong> Lockouts
                </span>
              )}
            </div>
          )}

          {onSimulateTestAlert && !isCollapsed && (
            <button
              onClick={onSimulateTestAlert}
              className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 hover:text-white transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Generate a sample failed login attempt to preview threat alerts"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>Simulate Threat Alert</span>
            </button>
          )}

          {!isCollapsed && (
            <button
              onClick={handleExportJson}
              className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Download full security forensics as JSON"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Export Report</span>
            </button>
          )}

          {onRefreshLogs && (
            <button
              onClick={onRefreshLogs}
              className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-all cursor-pointer"
              title="Refresh security logs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* COLLAPSE / EXPAND TOGGLE BUTTON */}
          <button
            type="button"
            onClick={toggleCollapse}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all ${
              isCollapsed
                ? 'border-rose-500/30 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 hover:text-white'
                : 'border-white/10 bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white'
            }`}
            title={isCollapsed ? "Expand security dashboard" : "Collapse dashboard to save screen space and data"}
          >
            {isCollapsed ? (
              <>
                <span>Expand Dashboard</span>
                <ChevronDown className="w-3.5 h-3.5 text-rose-400" />
              </>
            ) : (
              <>
                <span>Collapse Dashboard</span>
                <ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* COLLAPSED BANNER OR EXPANDED CONTENT */}
      {isCollapsed ? (
        <div 
          onClick={toggleCollapse}
          className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 hover:border-rose-500/30 transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 group-hover:bg-rose-500/20 transition-all">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-wide">
                  Section Collapsed (Saving Space & Data)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-neutral-800 text-neutral-300 border border-white/10">
                  {stats.total} Events Analyzed
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
                Monitoring {stats.failedLogins} failed password(s), {stats.lockouts} lockout cooldown(s), and {stats.tampers} storage tamper attempt(s)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            <span className="text-xs text-rose-300 group-hover:text-rose-200 font-semibold font-mono flex items-center gap-1.5 bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20">
              <span>Click to Expand</span>
              <ChevronDown className="w-3.5 h-3.5 text-rose-400 transition-transform group-hover:translate-y-0.5" />
            </span>
          </div>
        </div>
      ) : (
        <>


      {/* KPI METRIC TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Total Incidents</span>
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white">{stats.total}</div>
          <p className="text-[10px] text-neutral-500 font-mono mt-1">Logged security events</p>
        </div>

        <div className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Failed Logins</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400">{stats.failedLogins}</div>
          <p className="text-[10px] text-neutral-500 font-mono mt-1">Bad passwords rejected</p>
        </div>

        <div className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Active Lockouts</span>
            <Lock className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">{stats.lockouts}</div>
          <p className="text-[10px] text-neutral-500 font-mono mt-1">Cooldowns triggered</p>
        </div>

        <div className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">Unusual Times</span>
            <Clock className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-purple-400">{stats.unusualTimes}</div>
          <p className="text-[10px] text-neutral-500 font-mono mt-1">1:00 AM – 5:00 AM off-hours</p>
        </div>

        <div className="p-4 rounded-2xl bg-neutral-950/70 border border-white/10 shadow-sm relative overflow-hidden col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-neutral-400 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider">DevTools Tamper</span>
            <Terminal className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-cyan-400">{stats.tampers}</div>
          <p className="text-[10px] text-neutral-500 font-mono mt-1">Storage bypass attempts</p>
        </div>
      </div>

      {/* PATTERN INTELLIGENCE ALERTS (AUTOMATIC DETECTION) */}
      {(patternAnalysis.suspiciousIps.length > 0 || patternAnalysis.targetedUsers.length > 0) && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/40 via-amber-950/30 to-purple-950/40 border border-rose-500/30 space-y-3 shadow-lg">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />
            <span>Automated Pattern Analysis: Suspicious Activity Detected</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {patternAnalysis.suspiciousIps.map((item, idx) => (
              <div key={`suspicious-ip-${item.ip}-${idx}`} className="p-3 bg-black/40 border border-rose-500/20 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-rose-300 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-rose-400" />
                    IP: {item.ip}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-mono font-bold">
                    {item.incidents} Incidents
                  </span>
                </div>
                <p className="text-neutral-400 text-[11px]">
                  Targeted usernames: <strong className="text-white font-mono">{item.usersTargeted.join(', ')}</strong>
                </p>
                {item.lockouts > 0 && (
                  <p className="text-rose-400 text-[10px] font-mono flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Triggered {item.lockouts} account cooldown lockout(s)
                  </p>
                )}
              </div>
            ))}

            {patternAnalysis.targetedUsers.map((u, idx) => (
              <div key={`targeted-user-${u.username}-${idx}`} className="p-3 bg-black/40 border border-amber-500/20 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-amber-300 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-amber-400" />
                    Targeted User: "{u.username}"
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold">
                    {u.failedCount} Failed Logins
                  </span>
                </div>
                <p className="text-neutral-400 text-[11px]">
                  Multiple password rejection events recorded for this username.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FILTER BUTTONS & SEARCH BAR */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            onClick={() => setSelectedFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFilter === 'all' 
                ? 'bg-white text-black shadow-sm' 
                : 'bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
          >
            All Incidents ({parsedEvents.length})
          </button>

          <button
            onClick={() => setSelectedFilter('critical')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFilter === 'critical' 
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30' 
                : 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
            }`}
          >
            🚨 Lockouts ({stats.lockouts})
          </button>

          <button
            onClick={() => setSelectedFilter('warning')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFilter === 'warning' 
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30' 
                : 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
            }`}
          >
            ⚠️ Failed Logins ({stats.failedLogins})
          </button>

          <button
            onClick={() => setSelectedFilter('unusual_time')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFilter === 'unusual_time' 
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30' 
                : 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
            }`}
          >
            🌙 Unusual Hours ({stats.unusualTimes})
          </button>

          <button
            onClick={() => setSelectedFilter('tamper')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFilter === 'tamper' 
                ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/30' 
                : 'bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
            }`}
          >
            ⚡ Tamper Attempts ({stats.tampers})
          </button>

          <button
            onClick={() => setSelectedFilter('two_factor')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFilter === 'two_factor' 
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30' 
                : 'bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            }`}
          >
            🔐 2FA / TOTP ({stats.twoFactorEvents})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search IP, username, or details..."
            className="w-full bg-neutral-950/80 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 transition-all font-mono placeholder:text-neutral-500"
          />
        </div>
      </div>

      {/* INCIDENTS TABLE / LIST */}
      <div className="bg-neutral-950/70 border border-white/10 rounded-2xl overflow-hidden shadow-lg">
        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
            <h4 className="text-sm font-semibold text-white">No Suspicious Security Incidents Found</h4>
            <p className="text-xs text-neutral-400 font-mono max-w-md mx-auto">
              {searchQuery ? 'No security events matched your search query.' : 'All system logins, session verifications, and user activities are operating normally.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredEvents.map((event, idx) => {
              const isSelected = selectedLog?.log.id === event.log.id;

              return (
                <div
                  key={`sec-event-${event.log.id || 'log'}-${idx}`}
                  onClick={() => setSelectedLog(isSelected ? null : event)}
                  className={`p-4 transition-all cursor-pointer hover:bg-white/[0.03] ${
                    isSelected ? 'bg-indigo-950/20 border-l-4 border-indigo-500' : ''
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    {/* Left info */}
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                        event.severity === 'critical'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : event.severity === 'warning'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : event.severity === 'suspicious'
                          ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                          : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                      }`}>
                        {event.severity === 'critical' ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : event.category === 'unusual_time' ? (
                          <Clock className="w-4 h-4" />
                        ) : event.category === 'tamper' ? (
                          <Terminal className="w-4 h-4" />
                        ) : (
                          <ShieldAlert className="w-4 h-4" />
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                            event.severity === 'critical'
                              ? 'bg-rose-500/20 text-rose-300'
                              : event.severity === 'warning'
                              ? 'bg-amber-500/20 text-amber-300'
                              : event.severity === 'suspicious'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-indigo-500/20 text-indigo-300'
                          }`}>
                            {event.severity}
                          </span>

                          <span className="text-white text-xs font-semibold font-mono">
                            User: <strong className="text-indigo-300">{event.log.username}</strong>
                          </span>

                          <span className="text-neutral-400 text-xs font-mono flex items-center gap-1">
                            <Globe className="w-3 h-3 text-neutral-500" />
                            {event.extractedIp}
                          </span>

                          {event.isUnusualTime && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                              🌙 Off-Hours ({event.timeStr})
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-neutral-300 font-mono leading-relaxed">
                          {event.log.details}
                        </p>
                      </div>
                    </div>

                    {/* Right timestamp */}
                    <div className="sm:text-right shrink-0">
                      <div className="text-[11px] text-neutral-400 font-mono">
                        {event.timeStr}
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono">
                        {formatMilestoneDateInEgypt(event.log.timestamp.substring(0, 10))}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Forensic Detail Box */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-white/5 space-y-2 text-xs font-mono"
                      >
                        <div className="p-3 bg-black/60 rounded-xl border border-white/10 space-y-1.5 text-neutral-300">
                          <div className="text-indigo-300 font-bold flex items-center gap-1.5">
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Forensic Incident Breakdown</span>
                          </div>
                          <div><strong>Event ID:</strong> {event.log.id}</div>
                          <div><strong>Action Code:</strong> {event.log.action}</div>
                          <div><strong>Timestamp ISO:</strong> {event.log.timestamp}</div>
                          <div><strong>Reported IP Address:</strong> {event.extractedIp}</div>
                          <div><strong>Cairo Egypt Access Time:</strong> {event.timeStr} (Hour: {event.timeHour}:00)</div>
                          <div><strong>Incident Severity:</strong> {event.severity.toUpperCase()}</div>
                          <div className="pt-1 text-[11px] text-neutral-400">
                            <strong>Threat Remediation:</strong> {
                              event.category === 'lockout'
                                ? 'Account cooldown was automatically applied. Ensure the user has not had credentials compromised.'
                                : event.category === 'tamper'
                                ? 'Browser storage tampering was blocked by cryptographic signature verification. No session was granted.'
                                : event.category === 'failed_login'
                                ? 'Single password rejection. Monitored for subsequent attempts.'
                                : 'Access was verified and logged for audit purposes.'
                            }
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  )}
</div>

  );
};
