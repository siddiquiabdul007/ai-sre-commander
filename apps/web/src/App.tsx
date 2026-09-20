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
  const [approvalJustification, setApprovalJustification] = useState<string>('Verified memory leak in PR #142 caching layer. Approved rollback to revision 26.');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [executionBanner, setExecutionBanner] = useState<string | null>(null);

  // Initial mock incident corresponding to Flagship Demonstration Scenario (PRD §38)
  const initialDemoIncident: Incident = {
    id: 'inc_flagship_001',
    title: 'Elevated 5xx Error Rate and Pod CrashLoop on Checkout API',
    service: 'checkout-api',
    environment: 'production',
    cluster: 'aks-primary-eu [West Europe]',
    namespace: 'payments',
    severity: 'SEV-1',
    state: 'AWAITING_APPROVAL',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    mttdSeconds: 120,
    errorBudgetImpactPercent: 1.4,
    leadingHypothesis: {
      id: 'hyp_01',
      rank: 1,
      title: 'Deployment v1.1.0 Memory Leak leading to OOMKilled Pods',
      rootCause: 'Code revision in deployment introduces unbounded memory retention in checkout-api, causing pods to reach their 512Mi limit, terminate via OOMKilled (exit 137), and drop requests.',
      confidence: 94,
      supportingEvidenceCount: 7,
      contradictoryEvidenceCount: 1,
      supportingEvidenceIds: ['ev_1', 'ev_2', 'ev_3'],
      contradictoryEvidenceIds: ['ev_4'],
      explanation: 'Deployment v1.1.0 directly preceded memory growth. Kubernetes logged 4 OOMKilled events. Downstream database metrics confirm normal performance.',
      proposedAction: 'rollback_deployment',
      targetRevision: 26
    },
    remediationProposals: [
      {
        id: 'rem_proposal_001',
        incidentId: 'inc_flagship_001',
        action: 'rollback_deployment',
        risk: 'HIGH',
        environment: 'production',
        namespace: 'payments',
        targetResource: 'deployment/checkout-api',
        parameters: { deployment: 'checkout-api', targetRevision: 26, strategy: 'RollingUpdate' },
        expectedImpact: 'Replaces current leaking image pods with stable previous release (revision 26). In-flight requests gracefully handled with 0 downtime.',
        blastRadius: 'Targeted exclusively to payments/checkout-api workload across 3 replica pods.',
        status: 'PENDING_APPROVAL',
        proposedBy: 'ai-agent-remediation',
        reason: 'Leading causal hypothesis indicates memory leak in v1.1.0 with 94% confidence. Rollback restores proven stable release.',
        idempotencyKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
      }
    ]
  };

  const initialEvidence = [
    {
      id: 'ev_1',
      type: 'DEPLOYMENT_DIFF',
      source: 'github',
      title: 'Deployment Promoted: checkout-api@v1.1.0 (Revision 27)',
      summary: 'Revision 27 deployed version v1.1.0 containing payment buffer caching logic 12 minutes prior to first error spike.',
      confidence: 96,
      isContradictory: false,
      provenance: { sourceSystem: 'github-actions/deploy-prod', extractedAt: '14:20:12 UTC', untrustedInputHash: 'sha256:4f8e...7b21' },
      data: { version: 'v1.1.0', revision: 27, commit: 'feat(payments): add in-memory order buffer caching layer' }
    },
    {
      id: 'ev_2',
      type: 'BASELINE_DEVIATION',
      source: 'prometheus',
      title: 'Monotonic Memory Growth Anomaly (Leak Signature)',
      summary: 'Pod memory usage showed steep linear growth from 180Mi to 512Mi limit within 7 minutes of deployment rollout.',
      confidence: 94,
      isContradictory: false,
      provenance: { sourceSystem: 'prometheus-k8s', extractedAt: '14:25:40 UTC', untrustedInputHash: 'sha256:9c1a...3e88' },
      data: { slope: '+47.4 MB/min', startingMb: 180, peakMb: 512, leakSignatureDetected: true }
    },
    {
      id: 'ev_3',
      type: 'K8S_EVENT',
      source: 'kubernetes',
      title: 'Pod OOMKilled and CrashLoopBackOff (Exit 137)',
      summary: 'checkout-api-7b9d9c-f12 exceeded memory limit (512Mi) with exit code 137. 4 restarts in last 10 minutes.',
      confidence: 98,
      isContradictory: false,
      provenance: { sourceSystem: 'aks-primary-eu/payments', extractedAt: '14:29:15 UTC', untrustedInputHash: 'sha256:bb72...01aa' },
      data: { restarts: 4, exitCode: 137, limit: '512Mi' }
    },
    {
      id: 'ev_4',
      type: 'METRIC_ANOMALY',
      source: 'prometheus',
      title: 'HTTP 5xx Error Rate Spike (6.8%)',
      summary: 'HTTP 5xx responses spiked to 6.8% (normal baseline < 0.05%). Alert HighErrorRate5xx firing.',
      confidence: 99,
      isContradictory: false,
      provenance: { sourceSystem: 'prometheus-k8s', extractedAt: '14:32:00 UTC', untrustedInputHash: 'sha256:d821...54fe' },
      data: { currentValue: 6.8, baseline: 0.04, threshold: 1.0 }
    },
    {
      id: 'ev_5',
      type: 'BASELINE_DEVIATION',
      source: 'azure',
      title: 'Downstream Database Latency Unchanged (12ms) [CONTRADICTORY]',
      summary: 'Azure Database for PostgreSQL Flexible Server response time remains healthy at 12ms with 0 errors, disproving database starvation.',
      confidence: 99,
      isContradictory: true,
      provenance: { sourceSystem: 'azure-monitor-postgresql', extractedAt: '14:33:10 UTC', untrustedInputHash: 'sha256:11bb...ef49' },
      data: { latencyMs: 12, connections: 18, status: 'HEALTHY' }
    }
  ];

  const initialTimeline = [
    { timestamp: '14:20:00', title: 'Deployment Promoted', description: 'checkout-api v1.1.0 (rev 27) deployed to production', type: 'CHANGE' },
    { timestamp: '14:25:12', title: 'Memory Anomaly Detected', description: 'Prometheus metric exceeds baseline (+47 MB/min)', type: 'TELEMETRY' },
    { timestamp: '14:27:30', title: 'Latency Degradation', description: 'p99 latency increased from 45ms to 2400ms', type: 'TELEMETRY' },
    { timestamp: '14:29:45', title: 'Kubernetes Pod OOMKilled', description: 'checkout-api-7b9d9c-f12 terminated with exit code 137', type: 'K8S' },
    { timestamp: '14:30:10', title: 'HTTP 500 Error Spike', description: 'Inbound requests failing, 5xx rate climbs to 6.8%', type: 'TELEMETRY' },
    { timestamp: '14:32:00', title: 'Prometheus Alert Fired', description: 'Alertmanager trigger: HighErrorRate5xx (SEV-1)', type: 'ALERT' },
    { timestamp: '14:32:05', title: 'AI Commander Incident Created', description: 'Correlation engine aggregated 6 disconnected signals into single incident context', type: 'COMMANDER' },
    { timestamp: '14:32:45', title: 'AI Multi-Agent Investigation', description: 'RCA Agent identified v1.1.0 with 94% confidence (7 supporting, 1 contradictory)', type: 'AI' },
    { timestamp: '14:33:00', title: 'Remediation Proposed', description: 'Policy engine classified rollback as HIGH risk, requesting SRE human sign-off', type: 'POLICY' }
  ];

  const initialAudit = [
    {
      hash: '9f83a0421e90e4fbc87291a92e84128f73b64f89d34212a4b879c93a02bb84c1',
      prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
      timestamp: '14:32:05 UTC',
      actor: 'system',
      action: 'incident:create',
      target: 'checkout-api',
      policy: 'AUTOMATED_INGESTION'
    },
    {
      hash: '3a18e2098dbca21147fa0b9432098ab12e09ffbc891745aa0921bb34a91942de',
      prevHash: '9f83a0421e90e4fbc87291a92e84128f73b64f89d34212a4b879c93a02bb84c1',
      timestamp: '14:32:45 UTC',
      actor: 'ai-rca-agent',
      action: 'hypothesis:rank',
      target: 'hyp_01 (v1.1.0 leak)',
      policy: 'STRUCTURED_SCHEMA_VALIDATED'
    },
    {
      hash: '7c42b0129feaa9823145ff012389ba2147890aebcf12903847aa10293489fe21',
      prevHash: '3a18e2098dbca21147fa0b9432098ab12e09ffbc891745aa0921bb34a91942de',
      timestamp: '14:33:00 UTC',
      actor: 'ai-remediation-agent',
      action: 'remediation:propose',
      target: 'rollback_deployment (rev 26)',
      policy: 'RULE_HIGH_RISK_HUMAN_APPROVAL_REQUIRED'
    }
  ];

  useEffect(() => {
    // Load initial state
    setIncidents([initialDemoIncident]);
    setSelectedIncident(initialDemoIncident);
    setEvidenceList(initialEvidence);
    setTimelineEntries(initialTimeline);
    setAuditList(initialAudit);

    // Try fetching from backend if available
    fetch('/api/incidents')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.length > 0) {
          setIncidents(data);
          setSelectedIncident(data[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Approve & Execute Rollback (Flagship step 15-18)
  const handleApproveAndExecute = async () => {
    setIsProcessing(true);
    setExecutionBanner('Executing controlled rollback via Kubernetes API...');

    // Call API if live, otherwise simulate in frontend state
    try {
      const propId = selectedIncident?.remediationProposals[0]?.id || 'rem_proposal_001';
      await fetch(`/api/remediations/${propId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification: approvalJustification })
      });
      await fetch(`/api/remediations/${propId}/execute`, { method: 'POST' });
    } catch {
      // Offline fallback
    }

    setTimeout(() => {
      if (selectedIncident) {
        const updatedProposal = {
          ...selectedIncident.remediationProposals[0],
          status: 'SUCCESS',
          approvedBy: 'Alex Rivera (Staff SRE)',
          approvedAt: new Date().toISOString()
        };

        const updatedInc: Incident = {
          ...selectedIncident,
          state: 'RESOLVED',
          resolvedAt: new Date().toISOString(),
          mttrSeconds: 240,
          remediationProposals: [updatedProposal]
        };

        setSelectedIncident(updatedInc);
        setIncidents([updatedInc]);

        setTimelineEntries((prev) => [
          ...prev,
          {
            timestamp: '14:35:10',
            title: 'SRE Approval Granted',
            description: 'Approved by Alex Rivera: ' + approvalJustification,
            type: 'APPROVAL'
          },
          {
            timestamp: '14:35:45',
            title: 'Kubernetes Rollback Executed',
            description: 'Deployment checkout-api reverted to revision 26. 3 replica pods rolled out.',
            type: 'EXECUTION'
          },
          {
            timestamp: '14:37:00',
            title: 'Verification Confirmed: Healthy',
            description: '5xx error rate dropped to 0.02%. Memory stabilized at 185Mi. State: RESOLVED.',
            type: 'VERIFICATION'
          }
        ]);

        setAuditList((prev) => [
          ...prev,
          {
            hash: '4e9912089baec1942008fa721094ba129038472910abbcde12948712394012ab',
            prevHash: prev[prev.length - 1].hash,
            timestamp: '14:35:10 UTC',
            actor: 'Alex Rivera (Staff SRE)',
            action: 'remediation:approve',
            target: 'deployment/checkout-api',
            policy: 'CAN_APPROVE_HIGH_RISK_ROLE_SRE'
          },
          {
            hash: '8f0012934812abdc904812394871293847192834719283741928374918237491',
            prevHash: '4e9912089baec1942008fa721094ba129038472910abbcde12948712394012ab',
            timestamp: '14:37:00 UTC',
            actor: 'ai-verification-agent',
            action: 'incident:resolve',
            target: 'inc_flagship_001',
            policy: 'GOLDEN_SIGNALS_VERIFIED'
          }
        ]);

        setExecutionBanner('✅ Rollback verified! Memory normalized to 185Mi, 5xx dropped to 0.02%, incident RESOLVED.');
      }
      setIsProcessing(false);
    }, 1200);
  };

  // Reset Flagship Demo
  const handleResetDemo = () => {
    setSelectedIncident(initialDemoIncident);
    setIncidents([initialDemoIncident]);
    setEvidenceList(initialEvidence);
    setTimelineEntries(initialTimeline);
    setAuditList(initialAudit);
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
              aks-primary-eu [West Europe]
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-400" />
              EU Governance: DORA / NIS2 / AI Act
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleResetDemo}
              className="px-2.5 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:bg-slate-800 flex items-center space-x-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Scenario</span>
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
                      {selectedIncident.leadingHypothesis?.confidence || 94}%
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
                        • Confidence: <strong className="text-blue-300">94%</strong> • Evidence: <strong className="text-emerald-400">7 supporting</strong> / <strong className="text-amber-400">1 contradictory</strong>
                      </span>
                    </div>
                    <p className="text-xs text-slate-200 font-medium mt-0.5">
                      {selectedIncident.leadingHypothesis?.title || 'Deployment v1.1.0 is the leading causal hypothesis.'}
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
                    {/* Leading Hypothesis 1 */}
                    <div className="p-4 rounded-lg border border-blue-500/40 bg-[#0E1322] shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            RANK #1 LEADING
                          </span>
                          <h4 className="text-sm font-semibold text-white">
                            Deployment v1.1.0 In-Memory Cache Leak causing Pod OOMKilled
                          </h4>
                        </div>
                        <span className="text-sm font-mono font-bold text-blue-400">94% Confidence</span>
                      </div>

                      <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                        Code revision 27 deployed in version v1.1.0 introduced static cache orderHistoryMap with no TTL or eviction bounds. Pod memory climbed monotonically to 512Mi limit, causing container termination with exit code 137.
                      </p>

                      <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center space-x-4">
                          <span className="text-emerald-400">✓ 7 Supporting Signals</span>
                          <span className="text-amber-400">✕ 1 Contradictory Signal Analyzed</span>
                        </div>
                        <span className="text-slate-400">Proposed Action: <strong className="text-blue-300">rollback_deployment (to rev 26)</strong></span>
                      </div>
                    </div>

                    {/* Hypothesis 2 */}
                    <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]/50 opacity-75">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-400 bg-slate-800">
                            RANK #2
                          </span>
                          <h4 className="text-sm font-semibold text-slate-200">
                            Inbound Traffic Volumetric Spike / DDoS
                          </h4>
                        </div>
                        <span className="text-sm font-mono text-slate-400">24% Confidence</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">
                        Ingress requests remained steady within normal daily baseline band (+4% delta), disproving volumetric congestion.
                      </p>
                    </div>

                    {/* Hypothesis 3 */}
                    <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]/50 opacity-75">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-400 bg-slate-800">
                            RANK #3
                          </span>
                          <h4 className="text-sm font-semibold text-slate-200">
                            Downstream PostgreSQL Connection Pool Exhaustion
                          </h4>
                        </div>
                        <span className="text-sm font-mono text-slate-400">8% Confidence</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">
                        Disproven by Azure Monitor PostgreSQL metrics showing steady 12ms query latencies with 82 free pool connections.
                      </p>
                    </div>
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
                  <h3 className="text-sm font-bold text-white">Golden Signals & Anomaly Detection</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Error Rate Chart Simulation */}
                    <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-200">HTTP 5xx Error Rate (%)</span>
                        <span className="text-xs font-mono text-rose-400 font-bold">Peak: 6.8%</span>
                      </div>
                      <div className="h-32 flex items-end space-x-1.5 pt-4">
                        {[0.02, 0.03, 0.02, 0.04, 1.2, 3.8, 6.8, 6.7, 6.2, 2.1, 0.1, 0.02].map((val, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center">
                            <div
                              style={{ height: `${(val / 7.0) * 100}%` }}
                              className={`w-full rounded-t ${
                                val > 1.0 ? 'bg-rose-500' : 'bg-blue-500/60'
                              }`}
                            />
                            <span className="text-[9px] font-mono text-slate-500 mt-1">t+{i}m</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Memory Leak Chart Simulation */}
                    <div className="p-4 rounded-lg border border-slate-800 bg-[#0E1322]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-slate-200">Pod Memory Working Set (MiB)</span>
                        <span className="text-xs font-mono text-amber-400 font-bold">Limit: 512Mi</span>
                      </div>
                      <div className="h-32 flex items-end space-x-1.5 pt-4">
                        {[180, 195, 240, 310, 385, 460, 512, 512, 512, 250, 185, 182].map((mb, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center">
                            <div
                              style={{ height: `${(mb / 520) * 100}%` }}
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
                    {auditList.map((entry, idx) => (
                      <div key={idx} className="p-4 rounded-lg border border-slate-800 bg-[#0E1322] font-mono text-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-blue-400 font-bold">ACTION: {entry.action}</span>
                          <span>{entry.timestamp}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
                          <div><span className="text-slate-500">Actor:</span> {entry.actor}</div>
                          <div><span className="text-slate-500">Policy:</span> {entry.policy}</div>
                          <div><span className="text-slate-500">Target:</span> {entry.target}</div>
                        </div>
                        <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-500 space-y-0.5">
                          <p className="truncate">Current Hash: <span className="text-emerald-400">{entry.hash}</span></p>
                          <p className="truncate">Prev Hash: <span className="text-slate-400">{entry.prevHash}</span></p>
                        </div>
                      </div>
                    ))}
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
                      <span className="text-[10px] font-mono text-emerald-400">12ms • Healthy</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
