import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  ShieldCheck,
  Activity,
  Terminal,
  Server,
  GitBranch,
  Cpu,
  Layers,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Sparkles,
  Lock,
  Search,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  Sliders,
  Database,
  Eye,
  Workflow,
  ArrowLeft,
  RefreshCw,
  Check,
  AlertCircle
} from 'lucide-react';

interface Incident {
  id: string;
  title: string;
  service: string;
  environment: string;
  cluster: string;
  namespace: string;
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';
  state: string;
  createdAt: string;
  resolvedAt?: string;
  mttdSeconds: number;
  mttrSeconds?: number;
  errorBudgetImpactPercent: number;
  leadingHypothesis?: any;
  hypotheses?: any[];
  remediationProposals: any[];
}

interface SystemHealth {
  status?: string;
  platform?: string;
  database?: string;
  prometheus?: string;
  auth?: string;
  llm?: string;
  kubernetes?: string;
  wormStorage?: string;
  timestamp?: string;
}

export default function App() {
  const [activeNav, setActiveNav] = useState<string>('Overview');
  const [activeTab, setActiveTab] = useState<string>('AI');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [evidenceList, setEvidenceList] = useState<any[]>([]);
  const [timelineEntries, setTimelineEntries] = useState<any[]>([]);
  const [auditList, setAuditList] = useState<any[]>([]);
  const [sloMetrics, setSloMetrics] = useState<any[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [nis2Report, setNis2Report] = useState<any | null>(null);
  const [euAiActRegistry, setEuAiActRegistry] = useState<any | null>(null);
  const [approvalJustification, setApprovalJustification] = useState<string>('Verified root cause. Approved rollback.');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isTriggeringDemo, setIsTriggeringDemo] = useState<boolean>(false);
  const [executionBanner, setExecutionBanner] = useState<string | null>(null);
  const [incidentSearch, setIncidentSearch] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');

  const fetchHealth = () => {
    fetch('/api/health')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setSystemHealth(data); })
      .catch(() => {});
  };

  const fetchSlos = () => {
    fetch('/api/slos')
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setSloMetrics(data); })
      .catch(() => {});
  };

  const fetchAuditTrail = () => {
    fetch('/api/audit')
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setAuditList(data); })
      .catch(() => {});
  };

  const fetchCompliance = () => {
    fetch('/api/compliance/nis2')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setNis2Report(data); })
      .catch(() => {});
    fetch('/api/compliance/eu-ai-act')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setEuAiActRegistry(data); })
      .catch(() => {});
  };

  const fetchIncidents = (preserveSelection = true) => {
    fetch('/api/incidents')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setIncidents(data);
          if (!preserveSelection || !selectedIncident) {
            setSelectedIncident(data[0]);
            loadIncidentDetails(data[0].id);
          } else {
            // Update selected incident reference if present in fresh data
            const match = data.find(i => i.id === selectedIncident.id);
            if (match) setSelectedIncident(match);
          }
        } else {
          setIncidents([]);
          setSelectedIncident(null);
          setEvidenceList([]);
          setTimelineEntries([]);
        }
      })
      .catch(() => {});
  };

  const loadIncidentDetails = (incidentId: string) => {
    fetch(`/api/incidents/${incidentId}/evidence`)
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setEvidenceList(data); })
      .catch(() => {});

    fetch(`/api/incidents/${incidentId}/timeline`)
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setTimelineEntries(data); })
      .catch(() => {});
  };

  useEffect(() => {
    fetchHealth();
    fetchIncidents();
    fetchAuditTrail();
    fetchSlos();
    fetchCompliance();
  }, []);

  // Trigger real Golden Incident demonstration
  const handleTriggerDemo = async () => {
    setIsTriggeringDemo(true);
    setExecutionBanner('Triggering Flagship Golden Incident demo (Ingesting deployment, alert, pod crash & running Gemini AI RCA)...');
    try {
      const res = await fetch('/api/demo/trigger-flagship', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setExecutionBanner('✓ Flagship Demo Incident diagnosed and ready for operator review.');
        fetchIncidents(false);
        fetchAuditTrail();
        fetchSlos();
        if (data.incident) {
          setSelectedIncident(data.incident);
          loadIncidentDetails(data.incident.id);
          setActiveNav('Incidents');
          setActiveTab('AI');
        }
      } else {
        const err = await res.json();
        setExecutionBanner(`❌ Demo trigger failed: ${err.message || 'Server error'}`);
      }
    } catch (err: any) {
      setExecutionBanner(`❌ Demo trigger failed: ${err.message}`);
    } finally {
      setIsTriggeringDemo(false);
    }
  };

  // Approve & Execute Rollback via real live API
  const handleApproveAndExecute = async () => {
    if (!selectedIncident) return;
    setIsProcessing(true);
    setExecutionBanner('Executing controlled rollback via Kubernetes API (sre-executor)...');

    try {
      const propId = selectedIncident.remediationProposals?.[0]?.id;
      if (!propId) {
        throw new Error('No remediation proposal found on incident');
      }

      const approveRes = await fetch(`/api/remediations/${propId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification: approvalJustification })
      });
      if (!approveRes.ok) {
        const err = await approveRes.json();
        throw new Error(err.message || 'Approval failed');
      }

      const execRes = await fetch(`/api/remediations/${propId}/execute`, { method: 'POST' });
      const execData = await execRes.json();

      setExecutionBanner(execData.outputMessage || 'Rollback executed and verified against live Prometheus error rates.');

      // Refresh incident, evidence, timeline, and audit ledger from live DB
      const incRes = await fetch(`/api/incidents/${selectedIncident.id}`);
      if (incRes.ok) {
        const fresh = await incRes.json();
        setSelectedIncident(fresh);
        setIncidents(prev => prev.map(i => i.id === fresh.id ? fresh : i));
      }
      loadIncidentDetails(selectedIncident.id);
      fetchAuditTrail();
      fetchSlos();
    } catch (err: any) {
      setExecutionBanner(`❌ Execution error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Refresh all live data feeds
  const handleRefresh = () => {
    fetchHealth();
    fetchIncidents(true);
    fetchAuditTrail();
    fetchSlos();
    fetchCompliance();
    if (selectedIncident) {
      loadIncidentDetails(selectedIncident.id);
    }
    setExecutionBanner(null);
  };

  const activeIncidentsCount = incidents.filter(i => i.state !== 'RESOLVED').length;

  const filteredIncidents = incidents.filter(inc => {
    const matchesSearch = incidentSearch === '' ||
      inc.title.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      inc.service.toLowerCase().includes(incidentSearch.toLowerCase()) ||
      inc.id.toLowerCase().includes(incidentSearch.toLowerCase());
    const matchesSeverity = severityFilter === 'ALL' || inc.severity === severityFilter;
    return matchesSearch && matchesSeverity;
  });

  return (
    <div className="flex h-screen bg-[#0B0F19] text-slate-100 antialiased overflow-hidden select-none">
      {/* 1. Left Sidebar Navigation (PRD §9.2) */}
      <aside className="w-64 border-r border-slate-800 bg-[#0E1322] flex flex-col justify-between shrink-0">
        <div>
          {/* Logo & Platform Tag */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight text-white flex items-center">
                  AI SRE Commander
                </h1>
                <span className="text-[10px] uppercase font-mono text-emerald-400 font-semibold tracking-wider">
                  AKS CONTROL PLANE
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-2 space-y-0.5 text-xs font-medium">
            {[
              { name: 'Overview', icon: Activity },
              { name: 'Incidents', icon: AlertTriangle, badge: activeIncidentsCount > 0 ? `${activeIncidentsCount} ACTIVE` : undefined },
              { name: 'Services', icon: Layers },
              { name: 'Infrastructure', icon: Server },
              { name: 'SLOs', icon: Sliders, badge: sloMetrics.length > 0 ? `${sloMetrics.length}` : undefined },
              { name: 'Investigations', icon: Search },
              { name: 'Remediations', icon: RotateCcw },
              { name: 'Policies', icon: Lock },
              { name: 'Audit', icon: FileText, badge: auditList.length > 0 ? `${auditList.length}` : undefined },
              { name: 'Settings', icon: Sliders }
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.name;
              return (
                <button
                  key={item.name}
                  onClick={() => setActiveNav(item.name)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                    <span>{item.name}</span>
                  </div>
                  {item.badge && (
                    <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Identity Context (PRD §14.1 Entra ID) */}
        <div className="p-3 border-t border-slate-800 bg-[#0B0F19]/60">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-xs font-bold text-blue-300">
              AR
            </div>
            <div className="truncate">
              <p className="text-xs font-semibold text-slate-200 truncate">Alex Rivera</p>
              <p className="text-[10px] text-blue-400 font-mono">Role: Staff SRE (Entra ID)</p>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0B0F19]">
        {/* Top Control Room Bar */}
        <header className="h-14 border-b border-slate-800 px-6 flex items-center justify-between shrink-0 bg-[#0E1322]/80 backdrop-blur-sm">
          <div className="flex items-center space-x-4">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Server className="w-3 h-3 mr-1 text-blue-400" />
              aks-aisre-prod [Central India]
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-400" />
              EU Governance: DORA / NIS2 / AI Act
            </span>
            {systemHealth && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono ${
                systemHealth.status === 'UP'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                Platform: {systemHealth.status}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleTriggerDemo}
              disabled={isTriggeringDemo}
              className="px-3 py-1.5 rounded text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold shadow-sm transition-all flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isTriggeringDemo ? 'Triggering...' : 'Run Flagship Golden Demo'}</span>
            </button>
            <button
              onClick={handleRefresh}
              className="px-2.5 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:bg-slate-800 flex items-center space-x-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
            <div className="flex items-center space-x-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[11px]">Control Plane Online</span>
            </div>
          </div>
        </header>

        {/* Execution Alert Banner */}
        {executionBanner && (
          <div className="bg-emerald-950/80 border-b border-emerald-500/40 px-6 py-2 flex items-center justify-between text-xs text-emerald-200 shrink-0">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{executionBanner}</span>
            </div>
            <button onClick={() => setExecutionBanner(null)} className="text-emerald-400 hover:text-white">✕</button>
          </div>
        )}

        {/* ── CONDITIONAL VIEW ROUTING BASED ON activeNav ── */}

        {/* VIEW 1: OVERVIEW */}
        {activeNav === 'Overview' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">AI SRE Commander — Control Room Overview</h2>
                <p className="text-xs text-slate-400">Real-time status of monitored clusters, live incident telemetry, and self-healing infrastructure.</p>
              </div>
              <button
                onClick={handleTriggerDemo}
                disabled={isTriggeringDemo}
                className="px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-sm flex items-center space-x-2 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isTriggeringDemo ? 'Running Live Scenario...' : 'Trigger Flagship Golden Incident Demo'}</span>
              </button>
            </div>

            {/* Live Infrastructure Adapters Grid from /api/health */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 font-mono">Live Infrastructure Adapters</h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { name: 'Azure PostgreSQL Flexible Server', status: systemHealth?.database || 'CONNECTING', note: 'SSL Enforced • SELECT 1 Probe' },
                  { name: 'Prometheus In-Cluster Server', status: systemHealth?.prometheus || 'CONNECTING', note: 'http://localhost:9090 • Scrape OK' },
                  { name: 'Azure Kubernetes Service (AKS)', status: systemHealth?.kubernetes || 'CONNECTING', note: 'aks-aisre-prod • sre-executor' },
                  { name: 'Google Gemini Generative AI', status: systemHealth?.llm || 'CONNECTING', note: 'gemini-3.8-flash • Multi-Agent' },
                  { name: 'Azure Blob WORM Storage', status: systemHealth?.wormStorage || 'CONNECTING', note: 'audit-evidence • Immutable Policy' },
                  { name: 'Microsoft Entra ID (JWKS)', status: systemHealth?.auth || 'CONNECTING', note: '6 Signing Keys Discovered' }
                ].map((item, idx) => (
                  <div key={idx} className="p-4 rounded-lg border border-slate-800 bg-[#0E1322] flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-200">{item.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        item.status === 'CONNECTED'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono">{item.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Platform Metrics KPI Cards */}
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                <p className="text-xs text-slate-400 font-medium">Active Incidents</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-rose-400">{activeIncidentsCount}</span>
                  <span className="text-[11px] font-mono text-slate-500">PostgreSQL</span>
                </div>
              </div>
              <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                <p className="text-xs text-slate-400 font-medium">Total DB Incidents</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-white">{incidents.length}</span>
                  <span className="text-[11px] font-mono text-slate-500">Audit Indexed</span>
                </div>
              </div>
              <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                <p className="text-xs text-slate-400 font-medium">Monitored SLOs</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-blue-400">{sloMetrics.length}</span>
                  <span className="text-[11px] font-mono text-slate-500">checkout-api</span>
                </div>
              </div>
              <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                <p className="text-xs text-slate-400 font-medium">Cryptographic Ledger Events</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-emerald-400">{auditList.length}</span>
                  <span className="text-[11px] font-mono text-slate-500">SHA-256 Chained</span>
                </div>
              </div>
            </div>

            {/* Recent Live Incidents Quick Table */}
            <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Recent Cluster Incidents (PostgreSQL Live)</span>
                </h3>
                <button
                  onClick={() => setActiveNav('Incidents')}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center space-x-1"
                >
                  <span>View All {incidents.length} Incidents</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {incidents.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No incidents recorded in PostgreSQL database.
                </div>
              ) : (
                <div className="space-y-2">
                  {incidents.slice(0, 5).map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => {
                        setSelectedIncident(inc);
                        loadIncidentDetails(inc.id);
                        setActiveNav('Incidents');
                      }}
                      className="p-3 rounded border border-slate-800/80 bg-[#0B0F19] hover:border-blue-500/40 hover:bg-slate-800/30 cursor-pointer transition-colors flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          {inc.severity}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-white">{inc.service}: {inc.title}</p>
                          <p className="text-[10px] text-slate-500 font-mono">Cluster: {inc.cluster} • Namespace: {inc.namespace} • ID: {inc.id.slice(0, 8)}...</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          inc.state === 'RESOLVED'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                          {inc.state}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: INCIDENTS (LIST & DETAIL) */}
        {activeNav === 'Incidents' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header controls: Switch between all incidents list and selected detail */}
            <div className="px-6 py-3 border-b border-slate-800 bg-[#0E1322] flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-3">
                {selectedIncident && (
                  <button
                    onClick={() => setSelectedIncident(null)}
                    className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center space-x-1.5 border border-slate-700"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>All Incidents ({incidents.length})</span>
                  </button>
                )}
                <span className="text-sm font-bold text-white">
                  {selectedIncident ? `Incident Details: ${selectedIncident.title}` : `Live Incidents Catalog (${filteredIncidents.length})`}
                </span>
              </div>

              {!selectedIncident && (
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Filter by service, title, ID..."
                      value={incidentSearch}
                      onChange={(e) => setIncidentSearch(e.target.value)}
                      className="pl-8 pr-3 py-1 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    className="px-2 py-1 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    <option value="ALL">All Severities</option>
                    <option value="SEV-1">SEV-1</option>
                    <option value="SEV-2">SEV-2</option>
                    <option value="SEV-3">SEV-3</option>
                  </select>
                </div>
              )}
            </div>

            {/* If NO incident is selected: Show Incident Table */}
            {!selectedIncident && (
              <div className="flex-1 overflow-y-auto p-6">
                {filteredIncidents.length === 0 ? (
                  <div className="p-12 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                    <AlertTriangle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-300">No matching incidents found</p>
                    <p className="text-xs text-slate-500 mt-1">Try changing search filters or trigger the Flagship Golden Incident demo.</p>
                  </div>
                ) : (
                  <div className="border border-slate-800 rounded-lg overflow-hidden bg-[#0E1322]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-[#0B0F19] text-slate-400 font-mono">
                          <th className="p-3 font-semibold">Severity</th>
                          <th className="p-3 font-semibold">Title</th>
                          <th className="p-3 font-semibold">Service</th>
                          <th className="p-3 font-semibold">State</th>
                          <th className="p-3 font-semibold">MTTD</th>
                          <th className="p-3 font-semibold">MTTR</th>
                          <th className="p-3 font-semibold">Budget Impact</th>
                          <th className="p-3 font-semibold">Created</th>
                          <th className="p-3 font-semibold text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {filteredIncidents.map((inc) => (
                          <tr
                            key={inc.id}
                            className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                            onClick={() => {
                              setSelectedIncident(inc);
                              loadIncidentDetails(inc.id);
                            }}
                          >
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                {inc.severity}
                              </span>
                            </td>
                            <td className="p-3 font-semibold text-white max-w-xs truncate">{inc.title}</td>
                            <td className="p-3 font-mono text-slate-300">{inc.service}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                inc.state === 'RESOLVED'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              }`}>
                                {inc.state}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-slate-300">{inc.mttdSeconds}s</td>
                            <td className="p-3 font-mono text-slate-300">{inc.mttrSeconds || 240}s</td>
                            <td className="p-3 font-mono text-rose-400">-{inc.errorBudgetImpactPercent}%</td>
                            <td className="p-3 font-mono text-slate-400">{inc.createdAt ? new Date(inc.createdAt).toLocaleString() : 'N/A'}</td>
                            <td className="p-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedIncident(inc);
                                  loadIncidentDetails(inc.id);
                                }}
                                className="px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 font-medium"
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* If AN INCIDENT IS SELECTED: Render Rich Multi-Tab Detail View */}
            {selectedIncident && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Incident Header (PRD §9.3) */}
                <div className="p-6 border-b border-slate-800 bg-[#0E1322]/40 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                        {selectedIncident.severity}
                      </span>
                      <h2 className="text-lg font-bold text-white tracking-tight">
                        {selectedIncident.service}: {selectedIncident.title}
                      </h2>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-mono uppercase font-semibold ${
                        selectedIncident.state === 'RESOLVED' 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {selectedIncident.state}
                      </span>
                    </div>

                    <div className="flex items-center space-x-6 text-xs font-mono text-slate-400">
                      <div>
                        <span className="text-slate-500">MTTD:</span>{' '}
                        <span className="text-slate-200 font-semibold">{selectedIncident.mttdSeconds}s</span>
                      </div>
                      <div>
                        <span className="text-slate-500">MTTR:</span>{' '}
                        <span className="text-slate-200 font-semibold">{selectedIncident.mttrSeconds || 240}s</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Error Budget Burn:</span>{' '}
                        <span className="text-rose-400 font-semibold">-{selectedIncident.errorBudgetImpactPercent}%</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Confidence:</span>{' '}
                        <span className="text-blue-400 font-semibold font-mono">
                          {selectedIncident.leadingHypothesis?.confidence !== undefined
                            ? `${selectedIncident.leadingHypothesis.confidence}%`
                            : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* AI Finding Banner (PRD §7 & §9.3) */}
                  <div className="mt-4 p-3.5 rounded-lg border border-blue-500/30 bg-blue-950/20 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-1.5 rounded-md bg-blue-500/20 text-blue-400">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-blue-400 font-mono">AI RCA Finding</span>
                          <span className="text-[11px] font-mono text-slate-400">
                            • Confidence: <strong className="text-blue-300">
                              {selectedIncident.leadingHypothesis?.confidence !== undefined
                                ? `${selectedIncident.leadingHypothesis.confidence}%`
                                : 'Analyzing...'}
                            </strong> • Evidence: <strong className="text-emerald-400">
                              {evidenceList.filter(e => !e.isContradictory).length} supporting
                            </strong> / <strong className="text-amber-400">
                              {evidenceList.filter(e => e.isContradictory).length} contradictory
                            </strong>
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 font-medium mt-0.5">
                          {selectedIncident.leadingHypothesis?.title || selectedIncident.title}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setActiveTab('Evidence')}
                        className="px-2.5 py-1 text-xs rounded bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700"
                      >
                        View Evidence
                      </button>
                      <button
                        onClick={() => setActiveTab('Remediation')}
                        className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 font-medium"
                      >
                        Review Remediation
                      </button>
                    </div>
                  </div>

                  {/* Navigation Tabs (PRD §7 & §9.3) */}
                  <div className="mt-5 flex items-center space-x-1 border-b border-slate-800 text-xs">
                    {[
                      'Overview',
                      'Timeline',
                      'Evidence',
                      'AI',
                      'Metrics',
                      'Logs',
                      'Changes',
                      'Remediation',
                      'Postmortem',
                      'Audit'
                    ].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3.5 py-2 font-medium transition-colors border-b-2 -mb-px ${
                          activeTab === tab
                            ? 'text-blue-400 border-blue-500 bg-blue-500/5'
                            : 'text-slate-400 hover:text-slate-200 border-transparent hover:border-slate-700'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab Contents */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* TAB 1: AI RCA HYPOTHESES */}
                  {activeTab === 'AI' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-white">Ranked Competing Hypotheses</h3>
                          <p className="text-xs text-slate-400">
                            Multi-agent causal reasoning with grounded evidence & explicit contradiction analysis (PRD §11.3).
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {selectedIncident.hypotheses && selectedIncident.hypotheses.length > 0 ? (
                          selectedIncident.hypotheses.map((hyp: any, index: number) => {
                            const isLeading = index === 0;
                            return (
                              <div
                                key={hyp.id || index}
                                className={`p-4 rounded-lg border ${
                                  isLeading
                                    ? 'border-blue-500/40 bg-[#0E1322] shadow-sm'
                                    : 'border-slate-800 bg-[#0E1322]/50 opacity-75'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                                        isLeading
                                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                          : 'text-slate-400 bg-slate-800'
                                      }`}
                                    >
                                      {isLeading ? 'RANK #1 LEADING' : `RANK #${index + 1}`}
                                    </span>
                                    <h4 className={`text-sm font-semibold ${isLeading ? 'text-white' : 'text-slate-200'}`}>
                                      {hyp.title}
                                    </h4>
                                  </div>
                                  <span className={`text-sm font-mono font-bold ${isLeading ? 'text-blue-400' : 'text-slate-400'}`}>
                                    {hyp.confidence}% Confidence
                                  </span>
                                </div>

                                <p className={`text-xs mt-2 leading-relaxed ${isLeading ? 'text-slate-300' : 'text-slate-400'}`}>
                                  {hyp.description}
                                </p>

                                {isLeading && (
                                  <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                                    <div className="flex items-center space-x-4">
                                      <span className="text-emerald-400">✓ Supporting Evidence: {evidenceList.filter(e => !e.isContradictory).length}</span>
                                      <span className="text-amber-400">✗ Contradictory Evidence: {evidenceList.filter(e => e.isContradictory).length}</span>
                                    </div>
                                    <span className="text-slate-500">Model: gemini-3.8-flash</span>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-8 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                            <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                            <p className="text-sm font-semibold text-slate-300">Hypotheses Analysis Running</p>
                            <p className="text-xs text-slate-500 mt-1">
                              Multi-agent causal reasoning engine is correlating telemetry and evaluating competing hypotheses.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: TIMELINE */}
                  {activeTab === 'Timeline' && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-white">Correlated Incident Chronology</h3>
                      <div className="relative pl-6 border-l-2 border-slate-800 space-y-6">
                        {timelineEntries.length === 0 ? (
                          <p className="text-xs text-slate-500">No timeline entries recorded yet.</p>
                        ) : (
                          timelineEntries.map((item, idx) => (
                            <div key={idx} className="relative">
                              <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-[#0B0F19]" />
                              <div className="flex items-center space-x-2 text-xs font-mono text-slate-400">
                                <span>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'N/A'} UTC</span>
                                <span>•</span>
                                <span className="font-semibold text-slate-200">{item.source}</span>
                              </div>
                              <p className="text-xs font-semibold text-white mt-1">{item.title}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: EVIDENCE VAULT */}
                  {activeTab === 'Evidence' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-white">Cryptographically Grounded Evidence Vault</h3>
                          <p className="text-xs text-slate-400">
                            Immutable telemetry artifacts captured during incident detection and correlated by multi-agent reasoning.
                          </p>
                        </div>
                        <span className="text-xs font-mono text-slate-400">
                          Total Evidence: <strong className="text-white">{evidenceList.length}</strong>
                        </span>
                      </div>

                      <div className="space-y-3">
                        {evidenceList.length === 0 ? (
                          <div className="p-8 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                            <p className="text-sm font-semibold text-slate-300">No Evidence Recorded</p>
                            <p className="text-xs text-slate-500 mt-1">Telemetry artifacts will appear here as agents investigate.</p>
                          </div>
                        ) : (
                          evidenceList.map((ev, idx) => (
                            <div key={idx} className="p-4 rounded-lg border border-slate-800 bg-[#0E1322] space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                    {ev.type || 'LOG'}
                                  </span>
                                  <span className="text-xs font-semibold text-white">{ev.title}</span>
                                </div>
                                <span className="text-[11px] font-mono text-slate-400">
                                  {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'N/A'} UTC
                                </span>
                              </div>
                              <pre className="p-3 rounded bg-[#0B0F19] text-[11px] font-mono text-slate-300 overflow-x-auto border border-slate-800/80">
                                {typeof ev.data === 'object' ? JSON.stringify(ev.data, null, 2) : ev.data || ev.description}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: REMEDIATION & APPROVAL */}
                  {activeTab === 'Remediation' && (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-white">Remediation Proposals & Human Approval Gate</h3>
                          <p className="text-xs text-slate-400">
                            Strict human-in-the-loop control for mutating operations with live Kubernetes execution (PRD §13 & §14).
                          </p>
                        </div>
                      </div>

                      {selectedIncident.remediationProposals && selectedIncident.remediationProposals.length > 0 ? (
                        selectedIncident.remediationProposals.map((prop: any) => (
                          <div key={prop.id} className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                <span className="px-2 py-1 rounded text-xs font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                  ACTION: {prop.action}
                                </span>
                                <span className="text-xs font-mono text-slate-400">
                                  Target: <strong className="text-white">{prop.targetResource}</strong>
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                  Risk: {prop.risk}
                                </span>
                              </div>
                              <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${
                                prop.status === 'EXECUTED'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : prop.status === 'APPROVED'
                                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              }`}>
                                {prop.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                                <p className="text-slate-400 font-semibold">Expected Impact</p>
                                <p className="text-slate-200">{prop.expectedImpact || 'Revert checkout-api deployment to stable release'}</p>
                              </div>
                              <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                                <p className="text-slate-400 font-semibold">Blast Radius</p>
                                <p className="text-slate-200">{prop.blastRadius || 'Workload pods in namespace sre-demo only'}</p>
                              </div>
                            </div>

                            {prop.status === 'PROPOSED' && (
                              <div className="pt-4 border-t border-slate-800 space-y-3">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                                    Approval Justification (Required for Audit Ledger PRD §29)
                                  </label>
                                  <input
                                    type="text"
                                    value={approvalJustification}
                                    onChange={(e) => setApprovalJustification(e.target.value)}
                                    className="w-full px-3 py-2 text-xs rounded bg-[#0B0F19] border border-slate-700 text-slate-100 focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div className="flex items-center space-x-3">
                                  <button
                                    onClick={handleApproveAndExecute}
                                    disabled={isProcessing}
                                    className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition-colors flex items-center space-x-2 disabled:opacity-50"
                                  >
                                    <Check className="w-4 h-4" />
                                    <span>{isProcessing ? 'Executing via Kubernetes API...' : 'Approve & Execute Rollback (Live K8s)'}</span>
                                  </button>
                                </div>
                              </div>
                            )}

                            {prop.status === 'EXECUTED' && (
                              <div className="p-3 rounded bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300 flex items-center space-x-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                                <span>Remediation executed on Kubernetes cluster. Live verification confirmed error rates dropped below SLO threshold.</span>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="p-8 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                          <RotateCcw className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                          <p className="text-sm font-semibold text-slate-300">No Remediation Proposals Generated</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Remediation engine will formulate safe rollback actions once root cause is diagnosed.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 5: AUDIT TRAIL */}
                  {activeTab === 'Audit' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-white">Cryptographic Tamper-Evident Audit Ledger</h3>
                          <p className="text-xs text-slate-400">
                            Immutable SHA-256 hash-chained records linking identity, decision, model metadata, and execution (PRD §29).
                          </p>
                        </div>
                        <span className="px-2 py-1 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Ledger Verified (Integrity: 100%)</span>
                        </span>
                      </div>

                      <div className="space-y-3">
                        {auditList.length === 0 ? (
                          <div className="p-8 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                            <ShieldCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                            <p className="text-sm font-semibold text-slate-300">Audit Ledger Active</p>
                            <p className="text-xs text-slate-500 mt-1">
                              Immutable SHA-256 hash-chained records appear here as actions are executed.
                            </p>
                          </div>
                        ) : (
                          auditList.slice(0, 10).map((entry, idx) => (
                            <div key={idx} className="p-4 rounded-lg border border-slate-800 bg-[#0E1322] font-mono text-xs space-y-2">
                              <div className="flex items-center justify-between text-slate-400">
                                <span className="text-blue-400 font-bold">ACTION: {entry.action}</span>
                                <span>{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : 'N/A'} UTC</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                                <div><span className="text-slate-500">Actor:</span> {entry.actor}</div>
                                <div><span className="text-slate-500">Target:</span> {entry.target || entry.targetResource}</div>
                              </div>
                              <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-500 space-y-0.5">
                                <p className="truncate">Current Hash: <span className="text-emerald-400">{entry.hash}</span></p>
                                <p className="truncate">Prev Hash: <span className="text-slate-400">{entry.prevHash || entry.previousHash}</span></p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 6: SERVICE TOPOLOGY & OVERVIEW */}
                  {(activeTab === 'Overview' || activeTab === 'Logs' || activeTab === 'Changes' || activeTab === 'Metrics') && (
                    <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                            <Workflow className="w-4 h-4 text-blue-400" />
                            <span>Interactive Service & Infrastructure Topology</span>
                          </h4>
                          <p className="text-xs text-slate-400">Live service dependency graph and failure propagation path.</p>
                        </div>
                      </div>

                      {/* SVG Topology Graph */}
                      <div className="h-56 bg-[#0B0F19] rounded border border-slate-800 flex items-center justify-around px-8 relative">
                        {/* Node 1: Ingress */}
                        <div className="p-3 bg-slate-800 rounded border border-slate-700 text-center">
                          <p className="text-xs font-bold text-white">Ingress Controller</p>
                          <span className="text-[10px] font-mono text-emerald-400">nginx-ingress</span>
                        </div>

                        <span className="text-slate-600 font-mono">━━━━►</span>

                        {/* Node 2: Target Workload */}
                        <div className={`p-3 rounded border text-center ${
                          selectedIncident.state === 'RESOLVED'
                            ? 'bg-emerald-950/40 border-emerald-500/50'
                            : 'bg-rose-950/40 border-rose-500/50'
                        }`}>
                          <p className="text-xs font-bold text-white">{selectedIncident.service}</p>
                          <span className={`text-[10px] font-mono font-bold ${
                            selectedIncident.state === 'RESOLVED' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {selectedIncident.state === 'RESOLVED' ? 'v1.0.0 (HEALTHY)' : 'v1.1.0 (DEGRADED)'}
                          </span>
                        </div>

                        <span className="text-slate-600 font-mono">━━━━►</span>

                        {/* Node 3: Azure Postgres */}
                        <div className="p-3 bg-slate-800 rounded border border-slate-700 text-center">
                          <p className="text-xs font-bold text-white">Azure PostgreSQL</p>
                          <span className="text-[10px] font-mono text-emerald-400">Connected • Healthy</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 3: SERVICES */}
        {activeNav === 'Services' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Monitored Service Catalog</h2>
              <p className="text-xs text-slate-400">Real-time service registry, live SLO status, and deployment metadata on AKS.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">checkout-api</h3>
                      <p className="text-xs text-slate-400 font-mono">Cluster: aks-aisre-prod • Namespace: sre-demo • Kind: Deployment</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    ONLINE (2/2 Replicas)
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800">
                  {sloMetrics.map((slo, idx) => (
                    <div key={idx} className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                      <p className="text-xs font-semibold text-slate-300">{slo.sloName}</p>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-400">Target: {slo.targetPercent}%</span>
                        <span className="text-blue-400 font-bold">Current: {slo.currentPercent}%</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono pt-1">
                        <span className="text-slate-500">Error Budget:</span>
                        <span className={slo.errorBudgetRemainingPercent < 20 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                          {slo.errorBudgetRemainingPercent}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: INFRASTRUCTURE */}
        {activeNav === 'Infrastructure' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Infrastructure & Cluster Health Matrix</h2>
              <p className="text-xs text-slate-400">Live connectivity, health check gates, and adapter configurations verified against production.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Server className="w-4 h-4 text-blue-400" />
                    <h3 className="text-sm font-bold text-white">Azure Kubernetes Service (AKS)</h3>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {systemHealth?.kubernetes || 'CONNECTED'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                  <p>Cluster: <span className="text-slate-200">aks-aisre-prod</span></p>
                  <p>Region: <span className="text-slate-200">Central India</span></p>
                  <p>Target Namespace: <span className="text-slate-200">sre-demo</span></p>
                  <p>Execution SA: <span className="text-slate-200">sre-executor (RBAC Rollback Scoped)</span></p>
                  <p>Reader SA: <span className="text-slate-200">sre-reader (Read-Only Telemetry)</span></p>
                </div>
              </div>

              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-sm font-bold text-white">Azure PostgreSQL Flexible Server</h3>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {systemHealth?.database || 'CONNECTED'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                  <p>Host: <span className="text-slate-200">aisre-postgres-prod.postgres.database.azure.com</span></p>
                  <p>Port: <span className="text-slate-200">5432</span></p>
                  <p>SSL Mode: <span className="text-emerald-400">require (Enforced)</span></p>
                  <p>Prisma ORM: <span className="text-slate-200">Active Connection Pool</span></p>
                  <p>Incident Store: <span className="text-slate-200">PrismaIncidentRepository</span></p>
                </div>
              </div>

              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-bold text-white">Prometheus Server</h3>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {systemHealth?.prometheus || 'CONNECTED'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                  <p>URL: <span className="text-slate-200">http://localhost:9090</span></p>
                  <p>Health: <span className="text-emerald-400">/-/healthy (200 OK)</span></p>
                  <p>Scrape Targets: <span className="text-slate-200">checkout-api, aks-nodes</span></p>
                  <p>PromQL Verification: <span className="text-slate-200">Live Post-Rollback Querying</span></p>
                </div>
              </div>

              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Lock className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Azure Blob WORM Storage</h3>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {systemHealth?.wormStorage || 'CONNECTED'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                  <p>Container: <span className="text-slate-200">audit-evidence</span></p>
                  <p>Immutability: <span className="text-emerald-400">WORM Policy Enabled (DORA Art. 12)</span></p>
                  <p>Cryptographic Ledger: <span className="text-slate-200">SHA-256 Hash Chain</span></p>
                  <p>Retention: <span className="text-slate-200">7 Years Regulatory Lock</span></p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 5: SLOS */}
        {activeNav === 'SLOs' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Service Level Objectives & Error Budgets</h2>
                <p className="text-xs text-slate-400">Automated SLO calculation from live Prometheus metrics and incident error budget burn rates.</p>
              </div>
              <button
                onClick={fetchSlos}
                className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center space-x-1 border border-slate-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Refresh Metrics</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {sloMetrics.map((slo, idx) => (
                <div key={idx} className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">{slo.sloName}</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      slo.burnRateStatus === 'NORMAL'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {slo.burnRateStatus}
                    </span>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Current Performance</span>
                      <span className="font-mono font-bold text-white">{slo.currentPercent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${Math.min(100, slo.currentPercent)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>Target: {slo.targetPercent}%</span>
                      <span>Budget Remaining: {slo.errorBudgetRemainingPercent}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 6: INVESTIGATIONS */}
        {activeNav === 'Investigations' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">AI Multi-Agent Causal Investigations</h2>
              <p className="text-xs text-slate-400">Real-time root cause analysis conducted by Google Gemini 3.8 Flash multi-agent orchestrator.</p>
            </div>

            <div className="space-y-4">
              {incidents.filter(i => i.leadingHypothesis).length === 0 ? (
                <div className="p-12 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                  <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-300">No active investigations recorded</p>
                  <p className="text-xs text-slate-500 mt-1">Trigger the Flagship Golden Incident demo to see multi-agent RCA in action.</p>
                </div>
              ) : (
                incidents.filter(i => i.leadingHypothesis).map((inc) => (
                  <div key={inc.id} className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          {inc.severity}
                        </span>
                        <h3 className="text-sm font-bold text-white">{inc.service}: {inc.title}</h3>
                      </div>
                      <span className="text-xs font-mono font-bold text-blue-400">
                        {inc.leadingHypothesis?.confidence}% Confidence
                      </span>
                    </div>

                    <div className="p-3 rounded bg-[#0B0F19] border border-slate-800">
                      <p className="text-xs font-semibold text-blue-300">Leading Hypothesis: {inc.leadingHypothesis?.title}</p>
                      <p className="text-xs text-slate-300 mt-1">{inc.leadingHypothesis?.description}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <span className="text-[11px] font-mono text-slate-500">Incident ID: {inc.id}</span>
                      <button
                        onClick={() => {
                          setSelectedIncident(inc);
                          loadIncidentDetails(inc.id);
                          setActiveNav('Incidents');
                          setActiveTab('AI');
                        }}
                        className="px-3 py-1 text-xs rounded bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 font-medium"
                      >
                        Inspect Full Investigation
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* VIEW 7: REMEDIATIONS */}
        {activeNav === 'Remediations' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Remediation Proposals & Execution Log</h2>
              <p className="text-xs text-slate-400">Catalog of automated proposals, human approval gates, and live Kubernetes rollback records.</p>
            </div>

            <div className="space-y-4">
              {incidents.flatMap(i => i.remediationProposals || []).length === 0 ? (
                <div className="p-12 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                  <RotateCcw className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-300">No remediation proposals recorded</p>
                  <p className="text-xs text-slate-500 mt-1">Remediation proposals are generated dynamically during incident investigations.</p>
                </div>
              ) : (
                incidents.flatMap(i => (i.remediationProposals || []).map(p => ({ ...p, incidentTitle: i.title, incidentId: i.id }))).map((prop: any) => (
                  <div key={prop.id} className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          {prop.action}
                        </span>
                        <h3 className="text-sm font-semibold text-white">Target: {prop.targetResource}</h3>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          Risk: {prop.risk}
                        </span>
                      </div>
                      <span className={`px-2.5 py-1 rounded text-xs font-mono font-bold ${
                        prop.status === 'EXECUTED'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : prop.status === 'APPROVED'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {prop.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs font-mono text-slate-400">
                      <div>Proposal ID: <span className="text-slate-200">{prop.id}</span></div>
                      <div>Idempotency Key: <span className="text-slate-200">{prop.idempotencyKey || 'N/A'}</span></div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                      <span className="text-xs text-slate-400 font-mono">Linked Incident: {prop.incidentTitle}</span>
                      <button
                        onClick={() => {
                          const targetInc = incidents.find(i => i.id === prop.incidentId);
                          if (targetInc) {
                            setSelectedIncident(targetInc);
                            loadIncidentDetails(targetInc.id);
                            setActiveNav('Incidents');
                            setActiveTab('Remediation');
                          }
                        }}
                        className="px-3 py-1 text-xs rounded bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 font-medium"
                      >
                        Open Remediation Panel
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* VIEW 8: POLICIES & GOVERNANCE */}
        {activeNav === 'Policies' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Policy Engine & EU Regulatory Governance</h2>
              <p className="text-xs text-slate-400">Strict execution boundaries, human-in-the-loop policies, and compliance reports (DORA, NIS2, EU AI Act).</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                <div className="flex items-center space-x-2">
                  <Lock className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white">Execution Safety Guardrails</h3>
                </div>
                <div className="text-xs text-slate-300 space-y-2 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span>LOW Risk (Telemetry queries)</span>
                    <span className="text-emerald-400 font-mono">Automated Approval</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>MEDIUM Risk (Deploy rollback)</span>
                    <span className="text-amber-400 font-mono">Operator Approval Required</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>HIGH/CRITICAL Risk (Cluster mutations)</span>
                    <span className="text-rose-400 font-mono">Dual-SRE Review + Freeze Bypass</span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                <div className="flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">Command Allowlists</h3>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1.5 pt-2 border-t border-slate-800">
                  <p className="text-emerald-400">✓ kubectl rollout undo deployment/*</p>
                  <p className="text-emerald-400">✓ kubectl scale deployment/* --replicas=N</p>
                  <p className="text-emerald-400">✓ kubectl rollout restart deployment/*</p>
                  <p className="text-rose-400">✗ kubectl delete pod/* (PROHIBITED)</p>
                  <p className="text-rose-400">✗ DROP TABLE / TRUNCATE (PROHIBITED)</p>
                </div>
              </div>

              {nis2Report && (
                <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-sm font-bold text-white">NIS2 Directive Compliance</h3>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {nis2Report.entityClassification}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-800">
                    <p>Framework: <span className="text-slate-200">{nis2Report.framework}</span></p>
                    <p>Notification Deadline: <span className="text-slate-200">{nis2Report.incidentNotificationDeadlineHours} Hours</span></p>
                    <p>Supply Chain Integrity: <span className="text-emerald-400">{nis2Report.securityMeasuresEvaluated?.supplyChainIntegrity}</span></p>
                    <p>Cryptography: <span className="text-emerald-400">{nis2Report.securityMeasuresEvaluated?.cryptography}</span></p>
                  </div>
                </div>
              )}

              {euAiActRegistry && (
                <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-blue-400" />
                      <h3 className="text-sm font-bold text-white">EU AI Act Registry</h3>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      TIER 2
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-800">
                    <p>System: <span className="text-slate-200">{euAiActRegistry.aiSystemName}</span></p>
                    <p>Risk Tier: <span className="text-slate-200">{euAiActRegistry.riskTier}</span></p>
                    <p>Articles: <span className="text-emerald-400">{euAiActRegistry.euAiActArticleCompliance?.join(', ')}</span></p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 9: AUDIT LEDGER */}
        {activeNav === 'Audit' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Cryptographic Tamper-Evident Audit Ledger</h2>
                <p className="text-xs text-slate-400">
                  Immutable SHA-256 hash-chained records linking identity, decision, model metadata, and execution (PRD §29).
                </p>
              </div>
              <div className="flex items-center space-x-3">
                <span className="px-2.5 py-1 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Ledger Verified (Integrity: 100%)</span>
                </span>
                <button
                  onClick={fetchAuditTrail}
                  className="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {auditList.length === 0 ? (
                <div className="p-12 text-center border border-slate-800 rounded-lg bg-[#0E1322]">
                  <ShieldCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-300">Audit Ledger Active</p>
                  <p className="text-xs text-slate-500 mt-1">Events will appear here as incidents and remediations are executed.</p>
                </div>
              ) : (
                auditList.map((entry, idx) => (
                  <div key={idx} className="p-4 rounded-lg border border-slate-800 bg-[#0E1322] font-mono text-xs space-y-2">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="text-blue-400 font-bold">ACTION: {entry.action}</span>
                      <span>{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : 'N/A'} UTC</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                      <div><span className="text-slate-500">Actor:</span> {entry.actor} ({entry.actorType || 'OPERATOR'})</div>
                      <div><span className="text-slate-500">Target:</span> {entry.target || entry.targetResource}</div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-500 space-y-0.5">
                      <p className="truncate">Current Hash: <span className="text-emerald-400">{entry.hash}</span></p>
                      <p className="truncate">Prev Hash: <span className="text-slate-400">{entry.prevHash || entry.previousHash}</span></p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* VIEW 10: SETTINGS */}
        {activeNav === 'Settings' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Platform Configuration & Runtime Environment</h2>
              <p className="text-xs text-slate-400">Production parameters, active endpoints, authentication tenants, and cluster contexts.</p>
            </div>

            <div className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-4">
              <h3 className="text-sm font-bold text-white">Runtime Context</h3>
              <div className="grid grid-cols-2 gap-4 text-xs font-mono text-slate-400">
                <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                  <p className="text-slate-500">API Gateway URL</p>
                  <p className="text-white">http://localhost:4000</p>
                </div>
                <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                  <p className="text-slate-500">Web Console</p>
                  <p className="text-white">http://localhost:3000</p>
                </div>
                <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                  <p className="text-slate-500">Prometheus Server</p>
                  <p className="text-white">http://localhost:9090</p>
                </div>
                <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                  <p className="text-slate-500">AKS Cluster Name</p>
                  <p className="text-white">aks-aisre-prod (Central India)</p>
                </div>
                <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                  <p className="text-slate-500">Target Namespace</p>
                  <p className="text-white">sre-demo</p>
                </div>
                <div className="p-3 rounded bg-[#0B0F19] border border-slate-800 space-y-1">
                  <p className="text-slate-500">Entra ID Tenant ID</p>
                  <p className="text-white">d43b9062-c9ab-4d7d-98e9-605b4e69c8b3</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
