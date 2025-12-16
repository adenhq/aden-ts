/**
 * HTML Report Generator
 * Creates interactive HTML reports with charts for CTO-level analytics
 */

import type {
  AnalyticsJSON,
  ConversationPattern,
  MultiTenantPattern,
  CascadedAgentPattern,
} from "./report-types.js";

/**
 * Generate complete HTML report from analytics JSON
 */
export function generateHTMLReport(data: AnalyticsJSON): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Platform Usage Report - IT Management Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f1f5f9;
      --text-primary: #1e293b;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --border-color: #e2e8f0;
      --border-dark: #cbd5e1;
      --accent-primary: #0f172a;
      --accent-blue: #2563eb;
      --accent-green: #16a34a;
      --accent-yellow: #ca8a04;
      --accent-red: #dc2626;
      --accent-purple: #7c3aed;
      --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
      --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
      font-size: 14px;
    }

    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 0;
    }

    /* Header/Navigation Bar */
    .top-bar {
      background: var(--accent-primary);
      color: #fff;
      padding: 0 2rem;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .top-bar .logo {
      font-weight: 600;
      font-size: 1rem;
      letter-spacing: -0.025em;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .top-bar .logo svg {
      width: 24px;
      height: 24px;
    }

    .top-bar .meta {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    /* Page Header */
    .page-header {
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 1.5rem 2rem;
    }

    .page-header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }

    .page-header .breadcrumb {
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }

    .page-header .breadcrumb a {
      color: var(--accent-blue);
      text-decoration: none;
    }

    /* Main Content */
    .main-content {
      padding: 1.5rem 2rem 3rem;
    }

    /* KPI Cards Row */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .kpi-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1rem 1.25rem;
      box-shadow: var(--shadow-sm);
    }

    .kpi-card .kpi-label {
      font-size: 0.6875rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .kpi-card .kpi-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.2;
    }

    .kpi-card .kpi-change {
      font-size: 0.75rem;
      margin-top: 0.375rem;
      color: var(--text-muted);
    }

    .kpi-card .kpi-change.positive { color: var(--accent-green); }
    .kpi-card .kpi-change.negative { color: var(--accent-red); }

    /* Section */
    .section {
      margin-bottom: 2rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-color);
    }

    .section-header h2 {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .section-header .section-actions {
      display: flex;
      gap: 0.5rem;
    }

    /* Panel/Card */
    .panel {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-shadow: var(--shadow-sm);
      margin-bottom: 1rem;
    }

    .panel-header {
      padding: 0.875rem 1.25rem;
      border-bottom: 1px solid var(--border-color);
      font-weight: 600;
      font-size: 0.8125rem;
      color: var(--text-primary);
      background: var(--bg-tertiary);
      border-radius: 6px 6px 0 0;
    }

    .panel-body {
      padding: 1.25rem;
    }

    .chart-container {
      position: relative;
      height: 280px;
    }

    /* Grid Layout */
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }

    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }

    /* Data Table */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }

    .data-table th {
      text-align: left;
      padding: 0.625rem 1rem;
      font-weight: 600;
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      background: var(--bg-tertiary);
      border-bottom: 1px solid var(--border-color);
    }

    .data-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-color);
      vertical-align: middle;
    }

    .data-table tbody tr:hover {
      background: var(--bg-tertiary);
    }

    .data-table tbody tr:last-child td {
      border-bottom: none;
    }

    /* Status Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.1875rem 0.5rem;
      border-radius: 4px;
      font-size: 0.6875rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }

    .badge.free { background: #fef3c7; color: #92400e; }
    .badge.pro { background: #dbeafe; color: #1e40af; }
    .badge.enterprise { background: #ede9fe; color: #5b21b6; }
    .badge.success { background: #dcfce7; color: #166534; }
    .badge.warning { background: #fef3c7; color: #92400e; }
    .badge.danger { background: #fee2e2; color: #991b1b; }

    /* Progress Bar */
    .progress-bar {
      height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-bar .fill {
      height: 100%;
      background: var(--accent-blue);
      border-radius: 3px;
    }

    .progress-bar .fill.warning { background: var(--accent-yellow); }
    .progress-bar .fill.danger { background: var(--accent-red); }

    /* Alert Box */
    .alert {
      display: flex;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border-radius: 6px;
      margin-bottom: 0.75rem;
      font-size: 0.8125rem;
      border: 1px solid;
    }

    .alert-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
    }

    .alert-content h4 {
      font-weight: 600;
      margin-bottom: 0.125rem;
    }

    .alert-content p {
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .alert.info {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .alert.info .alert-icon { color: var(--accent-blue); }

    .alert.warning {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .alert.warning .alert-icon { color: var(--accent-yellow); }

    .alert.critical {
      background: #fef2f2;
      border-color: #fecaca;
    }
    .alert.critical .alert-icon { color: var(--accent-red); }

    /* Stat Row */
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border-color);
      font-size: 0.8125rem;
    }

    .stat-row:last-child {
      border-bottom: none;
    }

    .stat-row .label {
      color: var(--text-secondary);
    }

    .stat-row .value {
      font-weight: 600;
    }

    /* Agent Tree */
    .agent-tree {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
      font-size: 0.75rem;
    }

    .agent-node {
      padding: 0.5rem 0.75rem;
      margin: 0.25rem 0;
      background: var(--bg-tertiary);
      border-radius: 4px;
      border-left: 3px solid var(--accent-blue);
    }

    .agent-node.orchestrator { border-left-color: var(--accent-purple); }
    .agent-node.worker { border-left-color: var(--accent-green); }
    .agent-node.specialist { border-left-color: var(--accent-yellow); }

    .agent-node strong {
      color: var(--text-primary);
    }

    .agent-node span {
      color: var(--text-muted);
      font-size: 0.6875rem;
    }

    /* Tool Cards */
    .tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
    }

    .tool-card {
      background: var(--bg-tertiary);
      padding: 0.875rem;
      border-radius: 6px;
      text-align: center;
      border: 1px solid var(--border-color);
    }

    .tool-card .name {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 0.375rem;
    }

    .tool-card .count {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .tool-card .meta {
      font-size: 0.6875rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    /* Scenario Cards */
    .scenario-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .scenario-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
    }

    .scenario-card .scenario-header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .scenario-card .scenario-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.125rem;
      flex-shrink: 0;
    }

    .scenario-card.conversation .scenario-icon { background: #dbeafe; }
    .scenario-card.tenant .scenario-icon { background: #dcfce7; }
    .scenario-card.agent .scenario-icon { background: #ede9fe; }

    .scenario-card h3 {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.125rem;
    }

    .scenario-card .description {
      font-size: 0.75rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .scenario-card .scenario-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border-color);
    }

    .scenario-card .scenario-stat {
      background: var(--bg-tertiary);
      padding: 0.375rem 0.625rem;
      border-radius: 4px;
      font-size: 0.6875rem;
    }

    .scenario-card .scenario-stat .num {
      font-weight: 600;
      color: var(--text-primary);
    }

    /* Responsive */
    @media (max-width: 1200px) {
      .kpi-row { grid-template-columns: repeat(3, 1fr); }
      .scenario-grid { grid-template-columns: repeat(2, 1fr); }
    }

    @media (max-width: 768px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .scenario-grid { grid-template-columns: 1fr; }
      .main-content { padding: 1rem; }
    }

    /* Print styles */
    @media print {
      .top-bar { background: #000; -webkit-print-color-adjust: exact; }
      .panel { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Navigation Bar -->
    <div class="top-bar">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        AI Platform Management
      </div>
      <div class="meta">Report ID: RPT-${Date.now().toString(36).toUpperCase()} | ${new Date(data.generated_at).toLocaleString()}</div>
    </div>

    <!-- Page Header -->
    <div class="page-header">
      <div class="breadcrumb"><a href="#">Dashboard</a> / <a href="#">Analytics</a> / Usage Report</div>
      <h1>AI Usage Analytics Report</h1>
    </div>

    <div class="main-content">

    <!-- Usage Pattern Overview -->
    ${generateScenariosSection(data)}

    <!-- KPI Summary Row -->
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Total Cost</div>
        <div class="kpi-value">${formatCost(data.summary.total_cost)}</div>
        <div class="kpi-change">Projected: ${formatCost(data.summary.projected_monthly_cost)}/mo</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Requests</div>
        <div class="kpi-value">${data.summary.total_requests.toLocaleString()}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value">${formatNumber(data.summary.total_tokens)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Success Rate</div>
        <div class="kpi-value">${data.summary.success_rate.toFixed(1)}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Latency</div>
        <div class="kpi-value">${data.summary.avg_latency_ms.toFixed(0)}ms</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Cache Savings</div>
        <div class="kpi-value" style="color: var(--accent-green);">${formatCost(data.summary.cache_savings)}</div>
      </div>
    </div>

    <!-- Performance Metrics Section -->
    <div class="section">
      <div class="section-header">
        <h2>Performance Metrics</h2>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-header">Latency Distribution</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="latencyChart"></canvas>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">Cost by Model</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="costByModelChart"></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${generateConversationsSection(data.patterns.conversations)}

    ${generateMultiTenantSection(data.patterns.multi_tenant)}

    ${generateCascadedAgentsSection(data.patterns.cascaded_agents)}

    <!-- Recommendations Section -->
    <div class="section">
      <div class="section-header">
        <h2>Recommendations & Alerts</h2>
      </div>
      ${data.recommendations.map((rec) => `
        <div class="alert ${rec.severity}">
          <div class="alert-icon">${getAlertIcon(rec.severity)}</div>
          <div class="alert-content">
            <h4>${rec.title}</h4>
            <p>${rec.description}${rec.potential_savings ? ` <strong>Potential savings: ${formatCost(rec.potential_savings)}/month</strong>` : ""}</p>
          </div>
        </div>
      `).join("")}
    </div>

    </div><!-- end main-content -->
  </div><!-- end container -->

  <script>
    // Chart.js configuration for light theme
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = '#e2e8f0';

    // Latency Chart
    new Chart(document.getElementById('latencyChart'), {
      type: 'bar',
      data: {
        labels: ['P50', 'P95', 'P99', 'Avg'],
        datasets: [{
          label: 'Latency (ms)',
          data: [${data.summary.p50_latency_ms}, ${data.summary.p95_latency_ms}, ${data.summary.p99_latency_ms}, ${data.summary.avg_latency_ms}],
          backgroundColor: ['#2563eb', '#16a34a', '#ca8a04', '#7c3aed'],
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#e2e8f0' }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });

    // Cost by Model Chart
    new Chart(document.getElementById('costByModelChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(Object.keys(data.costs.by_model))},
        datasets: [{
          data: ${JSON.stringify(Object.values(data.costs.by_model).map((m) => m.cost))},
          backgroundColor: ['#2563eb', '#16a34a', '#ca8a04', '#dc2626', '#7c3aed', '#0891b2'],
          borderWidth: 2,
          borderColor: '#ffffff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          }
        }
      }
    });

    ${generateConversationCharts(data.patterns.conversations)}
    ${generateTenantCharts(data.patterns.multi_tenant)}
    ${generateAgentCharts(data.patterns.cascaded_agents)}

    // Tab functionality
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabGroup = tab.closest('.card');
        tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tabGroup.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        tabGroup.querySelector(\`#\${tab.dataset.tab}\`).classList.add('active');
      });
    });
  </script>
</body>
</html>`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  if (cost >= 0.001) return `$${cost.toFixed(4)}`;
  if (cost === 0) return "$0.00";
  return `$${cost.toFixed(6)}`;
}

function generateScenariosSection(data: AnalyticsJSON): string {
  const hasConversations = data.patterns.conversations.length > 0;
  const hasTenants = data.patterns.multi_tenant !== null;
  const hasAgents = data.patterns.cascaded_agents.length > 0;

  if (!hasConversations && !hasTenants && !hasAgents) {
    return "";
  }

  // Calculate conversation stats
  const convStats = hasConversations ? {
    count: data.patterns.conversations.length,
    avgTurns: data.patterns.conversations.reduce((s, c) => s + c.summary.total_turns, 0) / data.patterns.conversations.length,
    totalTokens: data.patterns.conversations.reduce((s, c) => s + c.summary.total_tokens, 0),
    models: [...new Set(data.patterns.conversations.flatMap(c => c.turns.map(t => t.event.model)))],
  } : null;

  // Calculate tenant stats
  const tenantStats = hasTenants ? {
    count: data.patterns.multi_tenant!.tenants.length,
    tiers: Object.entries(data.patterns.multi_tenant!.summary.tier_distribution),
    totalRequests: data.patterns.multi_tenant!.summary.total_requests,
  } : null;

  // Calculate agent stats
  const agentStats = hasAgents ? {
    count: data.patterns.cascaded_agents.length,
    totalAgents: data.patterns.cascaded_agents.reduce((s, a) => s + a.summary.total_agents, 0),
    totalTools: data.patterns.cascaded_agents.reduce((s, a) => s + a.summary.total_tool_calls, 0),
    tasks: data.patterns.cascaded_agents.map(a => a.task_description ?? a.task_id),
  } : null;

  let html = `
    <div class="section">
      <div class="section-header">
        <h2>Usage Patterns Analyzed</h2>
      </div>
      <div class="scenario-grid">`;

  // Conversation card
  if (convStats) {
    html += `
        <div class="scenario-card conversation">
          <div class="scenario-header">
            <div class="scenario-icon">💬</div>
            <div>
              <h3>Multi-Turn Conversations</h3>
              <div class="description">Chat sessions with context accumulation</div>
            </div>
          </div>
          <div class="scenario-stats">
            <div class="scenario-stat"><span class="num">${convStats.count}</span> sessions</div>
            <div class="scenario-stat"><span class="num">${convStats.avgTurns.toFixed(1)}</span> avg turns</div>
            <div class="scenario-stat"><span class="num">${formatNumber(convStats.totalTokens)}</span> tokens</div>
          </div>
        </div>`;
  }

  // Tenant card
  if (tenantStats) {
    const tierBadges = tenantStats.tiers.map(([tier, count]) =>
      `<div class="scenario-stat"><span class="num">${count}</span> ${tier}</div>`
    ).join("");

    html += `
        <div class="scenario-card tenant">
          <div class="scenario-header">
            <div class="scenario-icon">🏢</div>
            <div>
              <h3>Multi-Tenant Fleet</h3>
              <div class="description">SaaS platform with tiered quotas</div>
            </div>
          </div>
          <div class="scenario-stats">
            <div class="scenario-stat"><span class="num">${tenantStats.count}</span> tenants</div>
            <div class="scenario-stat"><span class="num">${tenantStats.totalRequests.toLocaleString()}</span> requests</div>
            ${tierBadges}
          </div>
        </div>`;
  }

  // Agent card
  if (agentStats) {
    html += `
        <div class="scenario-card agent">
          <div class="scenario-header">
            <div class="scenario-icon">🤖</div>
            <div>
              <h3>Cascaded Agents</h3>
              <div class="description">Orchestrator with sub-agents and tools</div>
            </div>
          </div>
          <div class="scenario-stats">
            <div class="scenario-stat"><span class="num">${agentStats.count}</span> tasks</div>
            <div class="scenario-stat"><span class="num">${agentStats.totalAgents}</span> agents</div>
            <div class="scenario-stat"><span class="num">${agentStats.totalTools}</span> tool calls</div>
          </div>
        </div>`;
  }

  html += `
      </div>
    </div>`;

  return html;
}

function getAlertIcon(severity: string): string {
  switch (severity) {
    case "critical":
      return `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`;
    case "warning":
      return `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`;
    case "info":
    default:
      return `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`;
  }
}

function generateConversationsSection(conversations: ConversationPattern[]): string {
  if (!conversations || conversations.length === 0) return "";

  const avgTurns =
    conversations.reduce((sum, c) => sum + c.summary.total_turns, 0) /
    conversations.length;
  const avgCost =
    conversations.reduce((sum, c) => sum + c.summary.total_cost, 0) /
    conversations.length;
  const totalCacheSavings = conversations.reduce(
    (sum, c) => sum + c.summary.cache_savings,
    0
  );

  return `
    <div class="section">
      <div class="section-header">
        <h2>Multi-Turn Conversations</h2>
      </div>

      <div class="kpi-row" style="grid-template-columns: repeat(4, 1fr);">
        <div class="kpi-card">
          <div class="kpi-label">Conversations</div>
          <div class="kpi-value">${conversations.length}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Avg Turns</div>
          <div class="kpi-value">${avgTurns.toFixed(1)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Avg Cost/Conv</div>
          <div class="kpi-value">${formatCost(avgCost)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Cache Savings</div>
          <div class="kpi-value" style="color: var(--accent-green);">${formatCost(totalCacheSavings)}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-header">Context Growth Over Turns</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="contextGrowthChart"></canvas>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">Cost Accumulation</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="costAccumulationChart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">Conversation Details</div>
        <div class="panel-body" style="padding: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Turns</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Avg Latency</th>
                <th>Cache Efficiency</th>
              </tr>
            </thead>
            <tbody>
              ${conversations
                .slice(0, 10)
                .map(
                  (c) => `
                <tr>
                  <td style="font-family: monospace; font-size: 0.75rem;">${c.conversation_id}</td>
                  <td>${c.summary.total_turns}</td>
                  <td>${c.summary.total_tokens.toLocaleString()}</td>
                  <td>${formatCost(c.summary.total_cost)}</td>
                  <td>${c.summary.avg_latency.toFixed(0)}ms</td>
                  <td>
                    <div class="progress-bar" style="width: 100px;">
                      <div class="fill" style="width: ${Math.min(100, (c.summary.cache_savings / c.summary.total_cost) * 100 * 2)}%;"></div>
                    </div>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function generateConversationCharts(conversations: ConversationPattern[]): string {
  if (!conversations || conversations.length === 0) return "";

  // Find longest conversation for context growth
  const longest = conversations.reduce((a, b) =>
    a.turns.length > b.turns.length ? a : b
  );

  const contextData = longest.turns.map((t) => t.context_tokens);
  const costData = longest.turns.map((t) => t.cumulative_cost);
  const labels = longest.turns.map((t) => `Turn ${t.turn_number}`);

  return `
    // Context Growth Chart
    new Chart(document.getElementById('contextGrowthChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'Context Tokens',
          data: ${JSON.stringify(contextData)},
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });

    // Cost Accumulation Chart
    new Chart(document.getElementById('costAccumulationChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'Cumulative Cost ($)',
          data: ${JSON.stringify(costData)},
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  `;
}

function generateMultiTenantSection(data: MultiTenantPattern | null): string {
  if (!data) return "";

  return `
    <div class="section">
      <div class="section-header">
        <h2>Multi-Tenant Fleet</h2>
      </div>

      <div class="kpi-row" style="grid-template-columns: repeat(4, 1fr);">
        <div class="kpi-card">
          <div class="kpi-label">Active Tenants</div>
          <div class="kpi-value">${data.summary.total_tenants}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Requests</div>
          <div class="kpi-value">${data.summary.total_requests.toLocaleString()}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Cost</div>
          <div class="kpi-value">${formatCost(data.summary.total_cost)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Top Tenant</div>
          <div class="kpi-value" style="font-size: 1rem;">${data.summary.top_tenant_by_cost}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-header">Cost by Tenant</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="tenantCostChart"></canvas>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">Tier Distribution</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="tierDistributionChart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">Tenant Usage Details</div>
        <div class="panel-body" style="padding: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Tier</th>
                <th>Users</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Quota Used</th>
              </tr>
            </thead>
            <tbody>
              ${data.tenants
                .sort((a, b) => b.summary.total_cost - a.summary.total_cost)
                .map(
                  (t) => `
                <tr>
                  <td>${t.tenant_name ?? t.tenant_id}</td>
                  <td><span class="badge ${t.tier}">${t.tier}</span></td>
                  <td>${t.users.length}</td>
                  <td>${t.summary.total_requests.toLocaleString()}</td>
                  <td>${t.summary.total_tokens.toLocaleString()}</td>
                  <td>${formatCost(t.summary.total_cost)}</td>
                  <td>
                    <div class="progress-bar" style="width: 80px; display: inline-block; vertical-align: middle;">
                      <div class="fill" style="width: ${Math.min(100, t.summary.quota_used)}%; background: ${t.summary.quota_used > 80 ? "#ef4444" : "#3b82f6"};"></div>
                    </div>
                    <span style="font-size: 0.75rem; margin-left: 0.5rem;">${t.summary.quota_used.toFixed(1)}%</span>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function generateTenantCharts(data: MultiTenantPattern | null): string {
  if (!data) return "";

  const tenantLabels = data.tenants.map((t) => t.tenant_name ?? t.tenant_id);
  const tenantCosts = data.tenants.map((t) => t.summary.total_cost);
  const tierLabels = Object.keys(data.summary.tier_distribution);
  const tierCounts = Object.values(data.summary.tier_distribution);

  return `
    // Tenant Cost Chart
    new Chart(document.getElementById('tenantCostChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(tenantLabels)},
        datasets: [{
          label: 'Cost ($)',
          data: ${JSON.stringify(tenantCosts)},
          backgroundColor: '#3b82f6',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } }
      }
    });

    // Tier Distribution Chart
    new Chart(document.getElementById('tierDistributionChart'), {
      type: 'pie',
      data: {
        labels: ${JSON.stringify(tierLabels)},
        datasets: [{
          data: ${JSON.stringify(tierCounts)},
          backgroundColor: ['#eab308', '#3b82f6', '#a855f7'],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
      }
    });
  `;
}

function generateCascadedAgentsSection(agents: CascadedAgentPattern[]): string {
  if (!agents || agents.length === 0) return "";

  const totalTasks = agents.length;
  const avgAgents =
    agents.reduce((sum, a) => sum + a.summary.total_agents, 0) / totalTasks;
  const avgCost =
    agents.reduce((sum, a) => sum + a.summary.total_cost, 0) / totalTasks;
  const totalToolCalls = agents.reduce(
    (sum, a) => sum + a.summary.total_tool_calls,
    0
  );

  // Aggregate tool usage across all tasks
  const toolUsage: Record<
    string,
    { count: number; avgDuration: number; successRate: number }
  > = {};
  for (const agent of agents) {
    for (const [tool, stats] of Object.entries(agent.summary.tool_usage)) {
      if (!toolUsage[tool]) {
        toolUsage[tool] = { count: 0, avgDuration: 0, successRate: 0 };
      }
      toolUsage[tool].count += stats.count;
      toolUsage[tool].avgDuration += stats.avg_duration_ms * stats.count;
      toolUsage[tool].successRate += stats.success_rate * stats.count;
    }
  }
  for (const tool of Object.keys(toolUsage)) {
    toolUsage[tool].avgDuration /= toolUsage[tool].count;
    toolUsage[tool].successRate /= toolUsage[tool].count;
  }

  return `
    <div class="section">
      <div class="section-header">
        <h2>Cascaded Agent Executions</h2>
      </div>

      <div class="kpi-row" style="grid-template-columns: repeat(4, 1fr);">
        <div class="kpi-card">
          <div class="kpi-label">Tasks Completed</div>
          <div class="kpi-value">${totalTasks}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Avg Agents/Task</div>
          <div class="kpi-value">${avgAgents.toFixed(1)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Avg Cost/Task</div>
          <div class="kpi-value">${formatCost(avgCost)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total Tool Calls</div>
          <div class="kpi-value">${totalToolCalls}</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <div class="panel-header">Cost by Agent Type</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="agentTypeCostChart"></canvas>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">Tokens by Depth Level</div>
          <div class="panel-body">
            <div class="chart-container">
              <canvas id="tokensByDepthChart"></canvas>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">Tool Usage Statistics</div>
        <div class="panel-body">
          <div class="tool-grid">
            ${Object.entries(toolUsage)
              .sort((a, b) => b[1].count - a[1].count)
              .map(
                ([name, stats]) => `
              <div class="tool-card">
                <div class="name">${name}</div>
                <div class="count">${stats.count}</div>
                <div class="meta">${stats.avgDuration.toFixed(0)}ms avg</div>
                <div class="meta">${stats.successRate.toFixed(0)}% success</div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      </div>

      ${agents
        .slice(0, 3)
        .map(
          (task) => `
        <div class="panel">
          <div class="panel-header">Task: ${task.task_description ?? task.task_id}</div>
          <div class="panel-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
              <div>
                <div class="stat-row">
                  <span class="label">Total Agents</span>
                  <span class="value">${task.summary.total_agents}</span>
                </div>
                <div class="stat-row">
                  <span class="label">Max Depth</span>
                  <span class="value">${task.summary.max_depth}</span>
                </div>
                <div class="stat-row">
                  <span class="label">LLM Calls</span>
                  <span class="value">${task.summary.total_llm_calls}</span>
                </div>
              </div>
              <div>
                <div class="stat-row">
                  <span class="label">Tool Calls</span>
                  <span class="value">${task.summary.total_tool_calls}</span>
                </div>
                <div class="stat-row">
                  <span class="label">Total Tokens</span>
                  <span class="value">${task.summary.total_tokens.toLocaleString()}</span>
                </div>
                <div class="stat-row">
                  <span class="label">Total Cost</span>
                  <span class="value">${formatCost(task.summary.total_cost)}</span>
                </div>
              </div>
            </div>
            <h4 style="margin-bottom: 0.5rem; font-size: 0.8125rem; font-weight: 600; color: var(--text-secondary);">Agent Hierarchy</h4>
            <div class="agent-tree">
              ${renderAgentTree(task.root_agent)}
            </div>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderAgentTree(agent: CascadedAgentPattern["root_agent"], indent = 0): string {
  const paddingLeft = indent * 20;
  return `
    <div class="agent-node ${agent.agent_type}" style="margin-left: ${paddingLeft}px;">
      <strong>${agent.agent_name}</strong> (${agent.model})
      <span style="color: var(--text-secondary); font-size: 0.75rem;">
        | ${agent.events.length} calls | ${agent.tool_calls.length} tools | ${formatCost(agent.summary.total_cost)}
      </span>
    </div>
    ${agent.subagents.map((sub: CascadedAgentPattern["root_agent"]) => renderAgentTree(sub, indent + 1)).join("")}
  `;
}

function generateAgentCharts(agents: CascadedAgentPattern[]): string {
  if (!agents || agents.length === 0) return "";

  // Aggregate cost by agent type
  const costByType: Record<string, number> = {};
  const tokensByDepth: Record<number, number> = {};

  for (const task of agents) {
    for (const [type, cost] of Object.entries(task.summary.cost_by_agent_type)) {
      costByType[type] = (costByType[type] ?? 0) + cost;
    }
    for (const [depth, tokens] of Object.entries(task.summary.tokens_by_depth)) {
      const d = Number(depth);
      tokensByDepth[d] = (tokensByDepth[d] ?? 0) + tokens;
    }
  }

  return `
    // Agent Type Cost Chart
    new Chart(document.getElementById('agentTypeCostChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(Object.keys(costByType))},
        datasets: [{
          data: ${JSON.stringify(Object.values(costByType))},
          backgroundColor: ['#a855f7', '#22c55e', '#eab308'],
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
      }
    });

    // Tokens by Depth Chart
    new Chart(document.getElementById('tokensByDepthChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(Object.keys(tokensByDepth).map((d) => `Level ${d}`))},
        datasets: [{
          label: 'Tokens',
          data: ${JSON.stringify(Object.values(tokensByDepth))},
          backgroundColor: '#3b82f6',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  `;
}
