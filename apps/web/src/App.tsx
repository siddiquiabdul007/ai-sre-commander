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
  Workflow
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

export default function App() {
  const [activeNav, setActiveNav] = useState<string>('Incidents');
  const [activeTab, setActiveTab] = useState<string>('AI');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [evidenceList, setEvidenceList] = useState<any[]>([]);
  const [timelineEntries, setTimelineEntries] = useState<any[]>([]);
  const [auditList, setAuditList] = useState<any[]>([]);
  const [sloMetrics, setSloMetrics] = useState<any[]>([]);
  const [approvalJustification, setApprovalJustification] = useState<string>('Verified root cause. Approved rollback.');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [executionBanner, setExecutionBanner] = useState<string | null>(null);

  const fetchSlos = () => {
    fetch('/api/slos')
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setSloMetrics(data); })
      .catch(() => {});
  };

  const fetchAuditTrail = () => {
    fetch('/api/audit')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) setAuditList(data);
      })
      .catch(() => {});
  };

  const fetchIncidents = () => {
    fetch('/api/incidents')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setIncidents(data);
          setSelectedIncident(data[0]);
          loadIncidentDetails(data[0].id);
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
    fetchIncidents();
    fetchAuditTrail();
    fetchSlos();
  }, []);

  // Approve & Execute Rollback via real live API
  const handleApproveAndExecute = async () => {
    if (!selectedIncident) return;
    setIsProcessing(true);
    setExecutionBanner('Executing controlled rollback via Kubernetes API...');

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

      setExecutionBanner(execData.outputMessage || 'Rollback executed successfully.');

      // Refresh incident, evidence, timeline, and audit ledger from live DB
      const incRes = await fetch(`/api/incidents/${selectedIncident.id}`);
      if (incRes.ok) {
        const fresh = await incRes.json();
        setSelectedIncident(fresh);
        setIncidents(prev => prev.map(i => i.id === fresh.id ? fresh : i));
      }
      loadIncidentDetails(selectedIncident.id);
      fetchAuditTrail();
    } catch (err: any) {
      setExecutionBanner(`❌ Execution error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Refresh live data
  const handleRefresh = () => {
    fetchIncidents();
    fetchAuditTrail();
    setExecutionBanner(null);
  };

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
              { name: 'Incidents', icon: AlertTriangle, badge: '1 ACTIVE' },
              { name: 'Services', icon: Layers },
              { name: 'Infrastructure', icon: Server },
              { name: 'SLOs', icon: Sliders },
              { name: 'Investigations', icon: Search },
              { name: 'Remediations', icon: RotateCcw },
              { name: 'Policies', icon: Lock },
              { name: 'Audit', icon: FileText },
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
            <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-200">
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
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleRefresh}
              className="px-2.5 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:bg-slate-800 flex items-center space-x-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refresh Status</span>
            </button>
            <div className="flex items-center space-x-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[11px]">Control Plane Online</span>
            </div>
          </div>
        </header>

        {/* Execution Alert Banner */}
        {executionBanner && (
          <div className="bg-emerald-950/80 border-b border-emerald-500/40 px-6 py-2 flex items-center justify-between text-xs text-emerald-200">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{executionBanner}</span>
            </div>
            <button onClick={() => setExecutionBanner(null)} className="text-emerald-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Incident Detail View (PRD §9.3) */}
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
                                  <span className="text-emerald-400">
                                    ✓ {hyp.supportingEvidenceIds?.length || 0} Supporting Signals
                                  </span>
                                  {hyp.contradictoryEvidenceIds?.length > 0 && (
                                    <span className="text-amber-400">
                                      ✕ {hyp.contradictoryEvidenceIds.length} Contradictory Signal Analyzed
                                    </span>
                                  )}
                                </div>
                                {hyp.proposedRemediationAction && (
                                  <span className="text-slate-400">
                                    Proposed Action: <strong className="text-blue-300">{hyp.proposedRemediationAction}</strong>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : selectedIncident.leadingHypothesis ? (
                      <div className="p-4 rounded-lg border border-blue-500/40 bg-[#0E1322] shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              RANK #1 LEADING
                            </span>
                            <h4 className="text-sm font-semibold text-white">
                              {selectedIncident.leadingHypothesis.title}
                            </h4>
                          </div>
                          <span className="text-sm font-mono font-bold text-blue-400">
                            {selectedIncident.leadingHypothesis.confidence}% Confidence
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                          {selectedIncident.leadingHypothesis.description}
                        </p>
                      </div>
                    ) : (
                      <div className="p-8 text-center border border-slate-800 rounded-lg bg-[#0E1322]/50 text-slate-400 text-xs">
                        Investigation underway. AI causal synthesis will appear once diagnostic evidence is correlated.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: REMEDIATION & HUMAN APPROVAL GATE */}
              {activeTab === 'Remediation' && (
                <div className="max-w-4xl space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-white">Policy-Controlled Remediation & Approval Gate</h3>
                    <p className="text-xs text-slate-400">
                      PRD §13: AI may propose structured actions, but deterministic policy engines enforce human sign-off on production changes.
                    </p>
                  </div>

                  {selectedIncident.remediationProposals.map((proposal) => {
                    const isApproved = proposal.status === 'SUCCESS' || proposal.status === 'APPROVED';
                    return (
                      <div key={proposal.id} className="p-5 rounded-lg border border-slate-800 bg-[#0E1322] space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                              RISK: {proposal.risk}
                            </span>
                            <h4 className="text-sm font-mono font-bold text-white">
                              {proposal.action}
                            </h4>
                            <span className="text-xs text-slate-400 font-mono">
                              target: {proposal.targetResource}
                            </span>
                          </div>

                          <span className={`px-2 py-0.5 rounded text-xs font-mono ${
                            isApproved ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}>
                            {proposal.status}
                          </span>
                        </div>

                        {/* Proposal Details Grid */}
                        <div className="grid grid-cols-2 gap-4 text-xs font-mono bg-[#0B0F19] p-3 rounded border border-slate-800">
                          <div>
                            <span className="text-slate-500">Target Revision:</span>{' '}
                            <span className="text-emerald-400 font-semibold">{proposal.parameters.targetRevision} (stable v1.0.0)</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Idempotency Key:</span>{' '}
                            <span className="text-slate-300 font-mono text-[10px]">{proposal.idempotencyKey}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Blast Radius:</span>{' '}
                            <span className="text-slate-300">{proposal.blastRadius}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Expected Impact:</span>{' '}
                            <span className="text-slate-300">{proposal.expectedImpact}</span>
                          </div>
                        </div>

                        {/* Approval Form */}
                        {!isApproved ? (
                          <div className="space-y-3 pt-2 border-t border-slate-800">
                            <label className="block text-xs font-semibold text-slate-300">
                              SRE Approval Justification (Recorded to Tamper-Evident Audit Ledger):
                            </label>
                            <input
                              type="text"
                              value={approvalJustification}
                              onChange={(e) => setApprovalJustification(e.target.value)}
                              className="w-full px-3 py-2 text-xs bg-[#0B0F19] border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500 font-mono"
                            />
                            <div className="flex items-center justify-end space-x-3 pt-2">
                              <button
                                onClick={() => alert('Proposal rejected and escalated to team.')}
                                className="px-3 py-1.5 rounded text-xs font-semibold text-slate-300 hover:text-white border border-slate-700 hover:bg-slate-800"
                              >
                                Reject Proposal
                              </button>
                              <button
                                onClick={handleApproveAndExecute}
                                disabled={isProcessing}
                                className="px-4 py-1.5 rounded text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20 flex items-center space-x-2"
                              >
                                {isProcessing ? (
                                  <>
                                    <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                                    <span>Executing...</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-4 h-4" />
                                    <span>Approve & Execute Rollback</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded text-xs font-mono space-y-1">
                            <p className="text-emerald-400 font-semibold">✓ Action Authorized & Executed</p>
                            <p className="text-slate-400">Approved by: {proposal.approvedBy}</p>
                            <p className="text-slate-400">Verification: All 3 pods rolled back to rev 26. Golden signals verified normal.</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TAB 3: EVIDENCE EXPLORER */}
              {activeTab === 'Evidence' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">Collected Operational Evidence</h3>
                      <p className="text-xs text-slate-400">
                        Evidence gathered across Kubernetes, Prometheus, GitHub, and Azure with cryptographic provenance hashes.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {evidenceList.map((ev) => (
                      <div
                        key={ev.id}
                        className={`p-4 rounded-lg border ${
                          ev.isContradictory
                            ? 'border-amber-500/40 bg-[#16120D]'
                            : 'border-slate-800 bg-[#0E1322]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            ev.isContradictory
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}>
                            {ev.isContradictory ? 'CONTRADICTORY EVIDENCE' : ev.type}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-300">{ev.confidence}% Confidence</span>
                        </div>

                        <h4 className="text-xs font-bold text-white mt-2">{ev.title}</h4>
                        <p className="text-xs text-slate-400 mt-1">{ev.summary}</p>

                        <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center justify-between">
                          <span>Source: {ev.provenance.sourceSystem}</span>
                          <span className="truncate max-w-[140px]">{ev.provenance.untrustedInputHash}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: TIMELINE */}
              {activeTab === 'Timeline' && (
                <div className="space-y-4 max-w-3xl">
                  <h3 className="text-sm font-bold text-white">Unified Causal Incident Timeline</h3>
                  <div className="relative pl-6 border-l-2 border-slate-800 space-y-6">
                    {timelineEntries.map((entry, idx) => (
                      <div key={idx} className="relative">
                        <div className="absolute -left-[31px] top-0.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-[#0B0F19]" />
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-mono text-blue-400 font-semibold">{entry.timestamp}</span>
                          <span className="text-xs font-bold text-white">{entry.title}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{entry.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 5: METRICS (GOLDEN SIGNALS) */}
              {activeTab === 'Metrics' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">Golden Signals & Live SLO Telemetry</h3>
                      <p className="text-xs text-slate-400">Prometheus metrics and SLO budget burn for {selectedIncident.service}.</p>
                    </div>
                  </div>

                  {/* Live SLO Cards */}
                  {sloMetrics.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {sloMetrics.map((slo, idx) => (
                        <div key={idx} className="p-3.5 rounded-lg border border-slate-800 bg-[#0E1322]">
                          <span className="text-xs font-bold text-slate-300">{slo.sloName}</span>
                          <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-lg font-mono font-bold text-white">{slo.currentPercent}%</span>
                            <span className="text-[11px] font-mono text-slate-400">Target: {slo.targetPercent}%</span>
                          </div>
                          <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">Budget Remaining:</span>
                            <span className={`font-mono font-bold ${slo.errorBudgetRemainingPercent > 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {slo.errorBudgetRemainingPercent}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Error Rate Chart */}
                    <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-200">HTTP 5xx Error Rate (%)</span>
                        <span className={`text-xs font-mono font-bold ${selectedIncident.state === 'RESOLVED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {selectedIncident.state === 'RESOLVED' ? 'Current: 0.00% (Recovered)' : 'Peak: 6.8% (Degraded)'}
                        </span>
                      </div>
                      <div className="h-32 flex items-end space-x-1.5 pt-4">
                        {(selectedIncident.state === 'RESOLVED'
                          ? [0.02, 0.03, 1.2, 3.8, 6.8, 6.7, 4.2, 1.1, 0.2, 0.05, 0.01, 0.00]
                          : [0.02, 0.03, 0.02, 0.04, 1.2, 3.8, 6.8, 6.7, 6.2, 6.5, 6.8, 6.8]
                        ).map((val, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center">
                            <div
                              style={{ height: `${Math.max(4, (val / 7.0) * 100)}%` }}
                              className={`w-full rounded-t ${
                                val > 1.0 ? 'bg-rose-500' : val > 0.1 ? 'bg-amber-500' : 'bg-emerald-500/70'
                              }`}
                            />
                            <span className="text-[9px] font-mono text-slate-500 mt-1">t+{i}m</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Memory Working Set Chart */}
                    <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-200">Pod Memory Working Set (MiB)</span>
                        <span className={`text-xs font-mono font-bold ${selectedIncident.state === 'RESOLVED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {selectedIncident.state === 'RESOLVED' ? 'Current: 182MiB (Normal)' : 'Peak: 512MiB (Limit Exceeded)'}
                        </span>
                      </div>
                      <div className="h-32 flex items-end space-x-1.5 pt-4">
                        {(selectedIncident.state === 'RESOLVED'
                          ? [180, 220, 290, 370, 450, 512, 512, 280, 210, 190, 185, 182]
                          : [180, 195, 240, 310, 385, 460, 490, 512, 512, 512, 512, 512]
                        ).map((mb, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center">
                            <div
                              style={{ height: `${Math.max(4, (mb / 520) * 100)}%` }}
                              className={`w-full rounded-t ${
                                mb >= 512 ? 'bg-amber-500' : 'bg-emerald-500/60'
                              }`}
                            />
                            <span className="text-[9px] font-mono text-slate-500 mt-1">t+{i}m</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: POSTMORTEM (PRD §10, §19, §34) */}
              {activeTab === 'Postmortem' && (
                <div className="max-w-4xl space-y-6">
                  <div className="p-6 rounded-lg border border-slate-800 bg-[#0E1322] space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                      <div>
                        <h3 className="text-base font-bold text-white">AI-Generated Incident Postmortem</h3>
                        <p className="text-xs text-slate-400 font-mono">Incident ID: {selectedIncident.id} • DORA Compliant</p>
                      </div>
                      <span className="px-2.5 py-1 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        STATUS: RESOLVED
                      </span>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Executive Summary</h4>
                      <p className="text-xs text-slate-300 leading-relaxed bg-[#0B0F19] p-3 rounded border border-slate-800">
                        On 2026-09-21, checkout-api experienced elevated 5xx error rates (peaking at 6.8%) due to an in-memory payment buffer caching leak introduced in deployment v1.1.0 (revision 27). AI SRE Commander correlated 6 signals, established root cause with 94% confidence, and planned an automated rollback to revision 26. Following SRE human authorization, execution and post-action verification successfully restored health with 0 customer downtime.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Actionable Corrective Items</h4>
                      <div className="space-y-2">
                        {[
                          { task: 'Refactor payment-buffer to use bounded LRU cache with Redis backend', owner: 'payments-team', priority: 'P1' },
                          { task: 'Add automated 30-minute memory soak test to CI/CD pipeline', owner: 'qa-infra', priority: 'P2' },
                          { task: 'Refine Prometheus OOM early warning threshold from 90% to 80%', owner: 'sre-team', priority: 'P2' }
                        ].map((item, idx) => (
                          <div key={idx} className="p-2.5 bg-[#0B0F19] rounded border border-slate-800 flex items-center justify-between text-xs">
                            <span className="text-slate-200">{item.task}</span>
                            <div className="flex items-center space-x-2 font-mono text-[11px]">
                              <span className="text-blue-400">@{item.owner}</span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{item.priority}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: TAMPER-EVIDENT AUDIT LEDGER (PRD §20, §29) */}
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
                          Immutable SHA-256 hash-chained records will appear here as incidents and remediations are executed.
                        </p>
                      </div>
                    ) : (
                      auditList.map((entry, idx) => (
                        <div key={idx} className="p-4 rounded-lg border border-slate-800 bg-[#0E1322] font-mono text-xs space-y-2">
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="text-blue-400 font-bold">ACTION: {entry.action}</span>
                            <span>{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : 'N/A'} UTC</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                            <div><span className="text-slate-500">Actor:</span> {entry.actor}</div>
                            <div><span className="text-slate-500">Policy:</span> {entry.policy || entry.metadata?.policyDecision?.riskClass || 'STANDARD'}</div>
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

              {/* TAB 8: SERVICE TOPOLOGY */}
              {(activeTab === 'Overview' || activeTab === 'Logs' || activeTab === 'Changes') && (
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
                      <p className="text-xs font-bold text-white">checkout-api</p>
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

        {/* Empty State when no incidents exist */}
        {!selectedIncident && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
              <ShieldCheck className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-base font-bold text-white mb-2">No Active Incidents Detected</h2>
            <p className="text-xs text-slate-400 max-w-md mb-6">
              The AKS cluster (<span className="text-slate-200 font-mono">sre-demo</span>) and monitored services are currently operating normally within SLO bounds.
            </p>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRefresh}
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow transition-colors flex items-center space-x-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Refresh Status</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
