export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function display(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : escapeHtml(value);
}

export function number(value, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function compactNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function signed(value, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${number(value, Number.isInteger(value) ? 0 : 1)}${suffix}`;
}

export function qualityBadge(quality) {
  const status = String(quality?.status ?? "unknown").toLowerCase();
  const label = status === "complete" || status === "available" ? "Available" :
    status === "partial" ? "Partial" : status === "unavailable" ? "Unavailable" : "Unknown";
  return `<span class="quality quality-${escapeHtml(status)}">${label}</span>`;
}

export function errorState(error) {
  return `<div class="state-card error-state"><div class="state-icon">!</div><div><h3>${escapeHtml(error?.message ?? "Something went wrong.")}</h3><p>Code: <code>${escapeHtml(error?.code ?? "DEMO_PROXY_ERROR")}</code>${error?.requestId ? ` · Request ${escapeHtml(error.requestId)}` : ""}</p><button class="button secondary retry-button">Try again</button></div></div>`;
}

export function emptyState(title = "No results for these filters") {
  return `<div class="state-card empty-state"><div class="state-icon">∅</div><div><h3>${escapeHtml(title)}</h3><p>Try widening the filters or choosing a different quarter. Empty results are returned by the API, not inferred by this demo.</p></div></div>`;
}

export function disclosure(meta, extra = "") {
  return `<div class="disclosure"><span class="disclosure-icon">i</span><div><strong>Delayed reported holdings</strong><p>${extra || "Form 13F information reflects what institutions reported to the SEC. It is delayed and is not a real-time position feed."}</p>${meta?.dataAsOf ? `<span class="as-of">Data as of ${escapeHtml(meta.dataAsOf)}</span>` : ""}</div></div>`;
}

export function renderPagination(data) {
  const total = Number(data?.totalCount ?? 0);
  const limit = Number(data?.limit ?? 25);
  const offset = Number(data?.offset ?? 0);
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return `<div class="pagination"><span>Showing ${number(from)}–${number(to)} of ${number(total)}</span><div><button class="button secondary page-button" data-offset="${Math.max(0, offset - limit)}" ${offset <= 0 ? "disabled" : ""}>← Previous</button><button class="button secondary page-button" data-offset="${offset + limit}" ${offset + limit >= total ? "disabled" : ""}>Next →</button></div></div>`;
}

export function renderAccumulation(data, filters = {}) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return `${emptyState()}${disclosure({ dataAsOf: data?.quarter?.periodEndDate })}`;
  const rows = items.map((item) => `<tr>
    <td><button class="symbol-link stock-link" data-symbol="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol)}</button><span class="muted">${display(item.companyName, "Company name unavailable")}</span></td>
    <td>${display(item.sector)}</td>
    <td class="numeric">${number(item.currentReportedHolderCount)}</td>
    <td class="${item.netHolderIncrease > 0 ? "positive" : item.netHolderIncrease < 0 ? "negative" : ""} numeric">${signed(item.netHolderIncrease)}</td>
    <td class="numeric">${number(item.newlyReportedHolderCount)}</td>
    <td class="numeric positive">${number(item.increasedReportedHolderCount)}</td>
    <td class="numeric">${number(item.unchangedReportedHolderCount)}</td>
    <td class="numeric negative">${number(item.reducedReportedHolderCount)}</td>
    <td class="numeric negative">${number(item.noLongerReportedHolderCount)}</td>
    <td class="numeric">${signed(item.aggregateReportedShareChangePct, "%")}</td>
    <td class="numeric">${item.aggregateReportedValue == null ? "—" : `$${compactNumber(item.aggregateReportedValue)}`}</td>
    <td><button class="icon-button stock-link" data-symbol="${escapeHtml(item.symbol)}" aria-label="Open ${escapeHtml(item.symbol)}">↗</button></td>
  </tr>`).join("");
  return `<div class="view-heading"><div><p class="eyebrow">INSTITUTIONAL ACTIVITY</p><h2>Accumulation ranking</h2><p>Descriptive ranking of reported holder activity. The API handles ranking and pagination server-side.</p></div><div class="meta-stack"><span>Quarter</span><strong>${display(data?.quarter?.label, "Latest")}</strong>${qualityBadge(data?.dataQuality)}</div></div>
    <div class="filter-bar filter-grid">
      <label>Quarter<input name="quarter" value="${escapeHtml(filters.quarter ?? "latest")}" placeholder="latest or 2026-Q1" /></label>
      <label>Position type<select name="positionType"><option value="COMMON_EQUITY" ${filters.positionType === "COMMON_EQUITY" || !filters.positionType ? "selected" : ""}>Common equity</option><option value="PUT" ${filters.positionType === "PUT" ? "selected" : ""}>Reported puts</option><option value="CALL" ${filters.positionType === "CALL" ? "selected" : ""}>Reported calls</option></select></label>
      <label>Manager cohort<select name="cohort"><option value="">All cohorts</option><option value="hedge_fund" ${filters.cohort === "hedge_fund" ? "selected" : ""}>Hedge fund</option><option value="pension" ${filters.cohort === "pension" ? "selected" : ""}>Pension</option><option value="sovereign" ${filters.cohort === "sovereign" ? "selected" : ""}>Sovereign</option><option value="endowment" ${filters.cohort === "endowment" ? "selected" : ""}>Endowment</option><option value="asset_manager" ${filters.cohort === "asset_manager" ? "selected" : ""}>Asset manager</option><option value="quantitative" ${filters.cohort === "quantitative" ? "selected" : ""}>Quantitative</option><option value="technology_specialist" ${filters.cohort === "technology_specialist" ? "selected" : ""}>Technology specialist</option><option value="healthcare_specialist" ${filters.cohort === "healthcare_specialist" ? "selected" : ""}>Healthcare specialist</option><option value="concentrated" ${filters.cohort === "concentrated" ? "selected" : ""}>Concentrated</option><option value="broad_diversified" ${filters.cohort === "broad_diversified" ? "selected" : ""}>Broad diversified</option></select></label>
      <label>Sector<input name="sector" value="${escapeHtml(filters.sector ?? "")}" placeholder="e.g. Technology" /></label>
      <label>Industry<input name="industry" value="${escapeHtml(filters.industry ?? "")}" placeholder="e.g. Software" /></label>
      <label>Theme<input name="theme" value="${escapeHtml(filters.theme ?? "")}" placeholder="e.g. AI Infrastructure" /></label>
      <label>Market cap minimum<input type="number" name="marketCapMin" min="0" value="${escapeHtml(filters.marketCapMin ?? "")}" placeholder="100000000" /></label>
      <label>Market cap maximum<input type="number" name="marketCapMax" min="0" value="${escapeHtml(filters.marketCapMax ?? "")}" placeholder="5000000000" /></label>
      <label>Minimum managers<input type="number" name="minManagers" min="1" max="10000" value="${escapeHtml(filters.minManagers ?? "")}" placeholder="2" /></label>
      <label>Min reported value<input type="number" name="minReportedValue" min="0" value="${escapeHtml(filters.minReportedValue ?? "")}" placeholder="1000000" /></label>
      <label>Sort by<select name="sortBy"><option value="netHolderIncrease" ${filters.sortBy === "netHolderIncrease" || !filters.sortBy ? "selected" : ""}>Net holder increase</option><option value="newHolderCount" ${filters.sortBy === "newHolderCount" ? "selected" : ""}>New holder count</option><option value="increasedHolderCount" ${filters.sortBy === "increasedHolderCount" ? "selected" : ""}>Increased holder count</option><option value="aggregateShareIncreasePct" ${filters.sortBy === "aggregateShareIncreasePct" ? "selected" : ""}>Share increase %</option><option value="aggregateShareIncrease" ${filters.sortBy === "aggregateShareIncrease" ? "selected" : ""}>Share increase</option><option value="reportedValue" ${filters.sortBy === "reportedValue" ? "selected" : ""}>Reported value</option></select></label>
      <label>Direction<select name="sortDirection"><option value="desc" ${filters.sortDirection === "desc" || !filters.sortDirection ? "selected" : ""}>Descending</option><option value="asc" ${filters.sortDirection === "asc" ? "selected" : ""}>Ascending</option></select></label>
      <label>Rows<select name="limit"><option ${filters.limit === "10" ? "selected" : ""}>10</option><option ${filters.limit === "25" || !filters.limit ? "selected" : ""}>25</option><option ${filters.limit === "50" ? "selected" : ""}>50</option></select></label>
      <button class="button primary apply-ranking">Apply filters</button>
    </div>
    <div class="table-wrap"><table class="wide-table"><thead><tr><th>Symbol</th><th>Sector</th><th>Reported holders</th><th>Net change</th><th>Newly reported</th><th>Increased</th><th>Unchanged</th><th>Reduced</th><th>No longer reported</th><th>Share change</th><th>Reported value</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${renderPagination(data)}${disclosure({ dataAsOf: data?.quarter?.periodEndDate })}`;
}

function metric(label, value, detail = "") {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
}

function holderList(title, list) {
  const values = Array.isArray(list) ? list : [];
  return `<div class="panel"><div class="panel-title"><h3>${escapeHtml(title)}</h3><span>${values.length} shown</span></div>${values.length ? `<div class="holder-list">${values.map((holder) => `<div class="holder-row"><div><strong>${display(holder.managerName, "Manager unavailable")}</strong><span>${display(holder.changeType, "Reported change")}</span></div><div class="numeric ${holder.reportedShareChange > 0 ? "positive" : holder.reportedShareChange < 0 ? "negative" : ""}">${signed(holder.reportedShareChange)} shares</div></div>`).join("")}</div>` : `<p class="muted empty-inline">No ranked changes were reported for this view.</p>`}</div>`;
}

function profileSummary(profiles = {}) {
  const labels = [
    ["fiveX", "5x"],
    ["tenX", "10x"],
    ["twentyFiveX", "25x"],
    ["hundredX", "100x"],
  ];
  return `<div class="mini-grid">${labels.map(([key, label]) => `<span><b>${label}</b>${display(profiles[key]?.classification?.replaceAll("_", " "))}</span>`).join("")}</div>`;
}

function componentSummary(components = {}) {
  const labels = [
    ["institutional", "Inst."],
    ["growth", "Growth"],
    ["fundamentals", "Fund."],
    ["valuation", "Value"],
    ["runway", "Runway"],
    ["optionality", "Optionality"],
    ["risk", "Risk"],
  ];
  return `<div class="mini-grid components-mini">${labels.map(([key, label]) => `<span><b>${label}</b>${components[key] == null ? "—" : number(components[key], 0)}</span>`).join("")}</div>`;
}

export function renderStock(data, trend, symbol) {
  if (!data && !trend) return `<div class="view-heading"><div><p class="eyebrow">STOCK VIEW</p><h2>Inspect a symbol</h2><p>Enter a ticker to request holder counts, ranked changes, and the multi-quarter trend directly from the API.</p></div></div><form class="symbol-form"><label>Symbol<input name="symbol" value="${escapeHtml(symbol ?? "")}" placeholder="AAPL" maxlength="10" required /></label><button class="button primary">Load stock view</button></form><div class="tip-card"><strong>Try a known symbol</strong><span>For example, AAPL or MSFT. The demo validates symbols before they reach the upstream API.</span></div>`;
  const current = data?.data ?? data ?? {};
  const trendData = trend?.data ?? trend ?? {};
  const meta = data?.meta ?? trend?.meta ?? {};
  return `<div class="view-heading"><div><p class="eyebrow">STOCK VIEW / ${escapeHtml(current.symbol ?? symbol)}</p><h2>${escapeHtml(current.symbol ?? symbol)} institutional profile</h2><p>Server-provided analytics for reported holders and quarter-to-quarter activity.</p></div><div class="meta-stack">${qualityBadge(current.dataQuality)}<span>Model ${display(current.modelVersion?.version ?? meta.modelVersion)}</span></div></div>
    <form class="symbol-form compact-form"><label>Symbol<input name="symbol" value="${escapeHtml(current.symbol ?? symbol)}" maxlength="10" required /></label><button class="button secondary">Refresh</button></form>
    <div class="metrics-grid">${metric("Reported holders", number(current.reportedHolderCount), `of ${number(current.reportingManagerCount)} reporting managers`)}${metric("Prior reported holders", number(current.previousReportedHolderCount))}${metric("Holder count change", signed(current.holderCountChange), "versus prior quarter")}${metric("Newly reported holders", number(current.newlyReportedHolderCount))}${metric("Increased holders", number(current.increasedReportedHolderCount))}${metric("Unchanged holders", number(current.unchangedReportedHolderCount))}${metric("Reduced holders", number(current.reducedReportedHolderCount))}${metric("No longer reported", number(current.noLongerReportedHolderCount))}${metric("Aggregate shares", compactNumber(current.aggregateReportedShares))}${metric("Share change", signed(current.aggregateReportedShareChangePct, "%"))}</div>
    <div class="lists-grid">${holderList("Largest reported holders", current.topReportedHolders)}${holderList("Largest newly reported positions", current.largestNewlyReportedPositions)}${holderList("Largest reported increases", current.largestReportedShareIncreases)}${holderList("Largest reported reductions", current.largestReportedShareReductions)}${holderList("No-longer-reported positions", current.noLongerReportedPositions)}</div>
    <div class="panel trend-panel"><div class="panel-title"><h3>Multi-quarter trend</h3><span class="trend-class">${display(trendData.classification)}</span></div>${Array.isArray(trendData.quarters) && trendData.quarters.length ? `<div class="trend-table">${trendData.quarters.map((quarter) => `<div class="trend-row"><strong>${display(quarter.quarter?.label)}</strong><span>${number(quarter.reportedHolderCount)} holders</span><span class="${quarter.breadthChange > 0 ? "positive" : quarter.breadthChange < 0 ? "negative" : ""}">${signed(quarter.breadthChange)} breadth</span><span>${signed(quarter.shareTrend, "%")} shares</span></div>`).join("")}</div>` : `<p class="muted empty-inline">No comparable quarters are available.</p>`}</div>
    ${disclosure(meta)}${Array.isArray(current.dataQuality?.warnings) && current.dataQuality.warnings.length ? `<div class="warning-list"><strong>Data quality notes</strong>${current.dataQuality.warnings.map((warning) => `<span>• ${escapeHtml(warning)}</span>`).join("")}</div>` : ""}`;
}

export function renderMultibagger(data, filters = {}) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  if (!candidates.length) return `${emptyState("No candidate profiles match these filters")}<div class="research-note">Candidate screens remain descriptive research context. Missing inputs stay unavailable rather than being inferred.</div>`;
  const rows = candidates.map((candidate) => `<tr>
    <td><button class="symbol-link multibagger-link" data-symbol="${escapeHtml(candidate.symbol)}">${escapeHtml(candidate.symbol)}</button><span class="muted">${display(candidate.sector, "Sector unavailable")}</span></td>
    <td class="score-cell">${candidate.overallScore == null ? "—" : number(candidate.overallScore, 1)}</td>
    <td>${profileSummary(candidate.profiles)}</td>
    <td>${componentSummary(candidate.componentScores)}</td>
    <td>${qualityBadge(candidate.dataQuality)}</td>
    <td>${display(candidate.dataAsOf)}</td>
    <td><button class="icon-button multibagger-link" data-symbol="${escapeHtml(candidate.symbol)}" aria-label="Open ${escapeHtml(candidate.symbol)}">↗</button></td>
  </tr>`).join("");
  return `<div class="view-heading"><div><p class="eyebrow">DETERMINISTIC DISCOVERY</p><h2>Candidate profile screen</h2><p>Explore versioned evidence and constrained optional-upside profiles. This is a research screen, not a recommendation.</p></div><div class="meta-stack"><span>Model</span><strong>${display(data?.modelVersion, "multibagger_v1")}</strong></div></div>
    <div class="filter-bar filter-grid">
      <label>Min overall score<input type="number" name="minOverallScore" min="0" max="100" value="${escapeHtml(filters.minOverallScore ?? "")}" placeholder="70" /></label>
      <label>Profile<select name="profile"><option value="">Any profile</option><option value="fiveX" ${filters.profile === "fiveX" ? "selected" : ""}>5x potential</option><option value="tenX" ${filters.profile === "tenX" ? "selected" : ""}>10x potential</option><option value="twentyFiveX" ${filters.profile === "twentyFiveX" ? "selected" : ""}>25x optionality</option><option value="hundredX" ${filters.profile === "hundredX" ? "selected" : ""}>100x optionality</option></select></label>
      <label>Sector<input name="sector" value="${escapeHtml(filters.sector ?? "")}" placeholder="e.g. Technology" /></label>
      <label>Industry<input name="industry" value="${escapeHtml(filters.industry ?? "")}" placeholder="e.g. Software" /></label>
      <label>Theme<input name="theme" value="${escapeHtml(filters.theme ?? "")}" placeholder="e.g. AI Infrastructure" /></label>
      <label>Market cap minimum<input type="number" name="marketCapMin" min="0" value="${escapeHtml(filters.marketCapMin ?? "")}" placeholder="100000000" /></label>
      <label>Market cap maximum<input type="number" name="marketCapMax" min="0" value="${escapeHtml(filters.marketCapMax ?? "")}" placeholder="5000000000" /></label>
      <label>Institutional trend<select name="institutionalTrend"><option value="">Any trend</option><option value="ACCELERATING_ACCUMULATION" ${filters.institutionalTrend === "ACCELERATING_ACCUMULATION" ? "selected" : ""}>Accelerating accumulation</option><option value="ACCUMULATION" ${filters.institutionalTrend === "ACCUMULATION" ? "selected" : ""}>Accumulation</option><option value="STABLE" ${filters.institutionalTrend === "STABLE" ? "selected" : ""}>Stable</option><option value="DISTRIBUTION" ${filters.institutionalTrend === "DISTRIBUTION" ? "selected" : ""}>Distribution</option><option value="ACCELERATING_DISTRIBUTION" ${filters.institutionalTrend === "ACCELERATING_DISTRIBUTION" ? "selected" : ""}>Accelerating distribution</option></select></label>
      <label>Min institutional score<input type="number" name="minInstitutionalScore" min="0" max="100" value="${escapeHtml(filters.minInstitutionalScore ?? "")}" placeholder="60" /></label>
      <label>Min revenue growth<input type="number" name="minRevenueGrowth" min="-100" max="10000" value="${escapeHtml(filters.minRevenueGrowth ?? "")}" placeholder="20" /></label>
      <label>Rows<select name="limit"><option ${filters.limit === "10" ? "selected" : ""}>10</option><option ${filters.limit === "25" || !filters.limit ? "selected" : ""}>25</option><option ${filters.limit === "50" ? "selected" : ""}>50</option></select></label>
      <button class="button primary apply-multibagger">Apply filters</button>
    </div>
    <div class="table-wrap"><table class="wide-table"><thead><tr><th>Symbol</th><th>Overall score</th><th>All profiles</th><th>Component scores</th><th>Data quality</th><th>Data as of</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${renderPagination(data)}<div class="research-note">Profile classifications summarize available evidence. They do not predict outcomes or provide investment advice.</div>`;
}

export function renderMultibaggerDetail(item) {
  const data = item?.data ?? item ?? {};
  const meta = item?.meta ?? {};
  const components = Object.entries(data.componentScores ?? {});
  const profiles = Object.entries(data.profiles ?? {});
  const limitations = [
    ...(Array.isArray(meta.limitations) ? meta.limitations : []),
    ...(Array.isArray(data.dataQuality?.warnings) ? data.dataQuality.warnings : []),
  ];
  return `<div class="detail-back"><button class="button secondary back-to-screen">← Back to screen</button></div><div class="view-heading"><div><p class="eyebrow">CANDIDATE PROFILE / ${escapeHtml(data.symbol)}</p><h2>${escapeHtml(data.symbol)} evidence profile</h2><p>Server-provided evidence from the deterministic Multibagger Discovery screen.</p></div><div class="meta-stack"><strong>${data.overallScore == null ? "Score unavailable" : `Overall ${number(data.overallScore, 1)}`}</strong><span>Model ${display(data.modelVersion)}</span></div></div>
    <div class="metrics-grid">${metric("Data quality", display(data.dataQuality?.status))}${metric("Confidence", display(data.dataQuality?.confidence))}${metric("Market cap", data.marketCap == null ? "—" : `$${compactNumber(data.marketCap)}`)}${metric("Revenue growth", data.revenueGrowth == null ? "—" : `${number(data.revenueGrowth, 1)}%`)}</div>
    <div class="panel"><div class="panel-title"><h3>Component evidence</h3><span>Provided by the API</span></div><div class="component-grid">${components.map(([name, score]) => `<div class="component"><span>${escapeHtml(name)}</span><strong>${score == null ? "—" : number(score, 1)}</strong><div class="meter"><i style="width:${typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0}%"></i></div></div>`).join("")}</div></div>
    <div class="two-col"><div class="panel"><div class="panel-title"><h3>Optional-upside profiles</h3></div>${profiles.map(([name, profile]) => `<div class="profile-row"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(profile?.classification?.replaceAll("_", " ") ?? "Unavailable")}</span><b>${profile?.score == null ? "—" : number(profile.score, 1)}</b></div>`).join("")}</div><div class="panel"><div class="panel-title"><h3>Supporting evidence</h3></div>${(data.supportingFactors ?? []).length ? data.supportingFactors.map((factor) => `<div class="factor-row"><span class="factor-dot support-dot"></span><div><strong>${escapeHtml(factor.component)}</strong><p>${escapeHtml(factor.explanation)}</p></div></div>`).join("") : `<p class="muted empty-inline">No supporting factors were returned.</p>`}</div></div>
    <div class="panel limits-panel"><div class="panel-title"><h3>Evidence limits</h3></div>${(data.limitingFactors ?? []).length ? data.limitingFactors.map((factor) => `<div class="factor-row"><span class="factor-dot"></span><div><strong>${escapeHtml(factor.component)}</strong><p>${escapeHtml(factor.explanation)}</p></div></div>`).join("") : `<p class="muted empty-inline">No limiting factors were returned.</p>`}</div>
    <div class="warning-list"><strong>API limitations and data-quality notes</strong>${limitations.length ? limitations.map((limitation) => `<span>• ${escapeHtml(limitation)}</span>`).join("") : "<span>• No additional limitations were returned.</span>"}</div>
    <div class="research-note"><strong>Research context only.</strong> This versioned candidate profile screen does not provide investment advice or certainty about future outcomes. ${data.dataAsOf ? `Data as of ${escapeHtml(data.dataAsOf)}.` : "Data as-of is unavailable."}</div>`;
}