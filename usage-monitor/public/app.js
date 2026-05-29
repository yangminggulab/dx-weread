const state = {
  report: null,
  days: 30
};

const elements = {
  rangeSelect: document.querySelector("#rangeSelect"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sessionsMetric: document.querySelector("#sessionsMetric"),
  tokensMetric: document.querySelector("#tokensMetric"),
  cacheMetric: document.querySelector("#cacheMetric"),
  costMetric: document.querySelector("#costMetric"),
  generatedAt: document.querySelector("#generatedAt"),
  dailyChart: document.querySelector("#dailyChart"),
  providerList: document.querySelector("#providerList"),
  modelTable: document.querySelector("#modelTable"),
  sessionList: document.querySelector("#sessionList"),
  sourceList: document.querySelector("#sourceList")
};

elements.rangeSelect.addEventListener("change", () => {
  state.days = Number(elements.rangeSelect.value);
  loadUsage();
});
elements.refreshBtn.addEventListener("click", loadUsage);

await loadUsage();

async function loadUsage() {
  setLoading(true);
  try {
    const response = await fetch(`/api/usage?days=${state.days}`);
    state.report = await response.json();
    render();
  } catch (error) {
    elements.sessionList.innerHTML = `<div class="empty">加载失败：${escapeHtml(error.message)}</div>`;
  } finally {
    setLoading(false);
  }
}

function render() {
  const report = state.report;
  const summary = report.summary;
  elements.sessionsMetric.textContent = formatNumber(summary.sessions);
  elements.tokensMetric.textContent = compact(summary.usage.totalTokens);
  elements.cacheMetric.textContent = compact(summary.usage.cachedInputTokens);
  elements.costMetric.textContent = summary.costUSD ? `$${formatMoney(summary.costUSD)}` : "N/A";
  elements.generatedAt.textContent = `Updated ${formatDateTime(report.generatedAt)}`;
  renderDailyChart(summary.byDay);
  renderProviders(summary.byProvider);
  renderModels(summary.byModel);
  renderSessions(report.records);
  renderSources(report.sources);
}

function renderDailyChart(days) {
  if (!days.length) {
    elements.dailyChart.innerHTML = `<div class="empty">暂无数据</div>`;
    return;
  }
  const max = Math.max(...days.map((day) => day.usage.totalTokens), 1);
  elements.dailyChart.innerHTML = days.map((day) => {
    const height = Math.max(4, Math.round((day.usage.totalTokens / max) * 100));
    return `
      <div class="day" title="${day.key}: ${formatNumber(day.usage.totalTokens)} tokens">
        <span class="bar" style="height:${height}%"></span>
        <small>${day.key.slice(5)}</small>
      </div>
    `;
  }).join("");
}

function renderProviders(groups) {
  elements.providerList.innerHTML = groups.map((group) => `
    <div class="row-card">
      <div>
        <strong>${escapeHtml(group.key)}</strong>
        <span>${formatNumber(group.sessions)} sessions</span>
      </div>
      <div class="row-metrics">
        <b>${compact(group.usage.totalTokens)}</b>
        <span>${group.costUSD ? `$${formatMoney(group.costUSD)}` : "N/A"}</span>
      </div>
    </div>
  `).join("") || `<div class="empty">暂无数据</div>`;
}

function renderModels(groups) {
  const rows = groups.slice(0, 12).map((group) => `
    <div class="table-row">
      <span class="model-name">${escapeHtml(group.key)}</span>
      <span>${compact(group.usage.inputTokens)}</span>
      <span>${compact(group.usage.cachedInputTokens)}</span>
      <span>${compact(group.usage.outputTokens + group.usage.reasoningOutputTokens)}</span>
      <span>${group.costUSD ? `$${formatMoney(group.costUSD)}` : "N/A"}</span>
    </div>
  `).join("");
  elements.modelTable.innerHTML = `
    <div class="table-row table-head">
      <span>Model</span><span>Input</span><span>Cached</span><span>Output</span><span>Cost</span>
    </div>
    ${rows || `<div class="empty">暂无数据</div>`}
  `;
}

function renderSessions(records) {
  const sorted = [...records].sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)).slice(0, 24);
  elements.sessionList.innerHTML = sorted.map((record) => `
    <article class="session-card">
      <div>
        <div class="session-title">
          <strong>${escapeHtml(record.product)}</strong>
          <span>${escapeHtml(record.model)}</span>
        </div>
        <p>${escapeHtml(record.cwdLabel || record.source)}</p>
      </div>
      <div class="session-usage">
        <b>${compact(record.usage.totalTokens)}</b>
        <span>${formatDateTime(record.lastSeenAt)}</span>
      </div>
    </article>
  `).join("") || `<div class="empty">暂无数据</div>`;
}

function renderSources(sources) {
  elements.sourceList.innerHTML = sources.map((source) => `
    <div class="source">
      <span class="status ${source.status}"></span>
      <div>
        <strong>${escapeHtml(source.label)}</strong>
        <p>${escapeHtml(source.detail)}</p>
      </div>
    </div>
  `).join("");
}

function setLoading(isLoading) {
  elements.refreshBtn.disabled = isLoading;
  elements.refreshBtn.textContent = isLoading ? "读取中" : "刷新";
}

function compact(value) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en").format(value || 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value || 0);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
