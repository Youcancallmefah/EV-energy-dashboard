/**
 * EV Power Analytics Dashboard — Frontend Logic v2
 * ==================================================
 * Connects to Flask API, processes full dataset, and renders:
 *   • KPI cards: total, average, trend, status
 *   • Chart.js line chart with range filter (7 / 30 / 90 / all)
 *   • Alert banner for high-usage days
 *   • Incidents table (days > 180 kWh)
 *
 * Auto-refreshes every 60 seconds.
 */

// ── Config ──────────────────────────────────────────────
const API_URL        = "http://127.0.0.1:5000/api/energy";
const REFRESH_MS     = 10_000;    // ① FEATURE: refresh every 10 seconds
const HIGH_THRESHOLD = 180;       // kWh — must match backend
const WARN_THRESHOLD = 150;       // ② FEATURE: warning level threshold

// ── State ───────────────────────────────────────────────
let allData     = [];   // full dataset from API
let energyChart = null; // Chart.js instance


// ════════════════════════════════════════════════════════
//  CLOCK
// ════════════════════════════════════════════════════════
function startClock() {
  const el = document.getElementById("live-clock");
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  };
  tick();
  setInterval(tick, 1000);
}


// ════════════════════════════════════════════════════════
//  API STATUS PILL
// ════════════════════════════════════════════════════════
function setPillState(state, text) {
  const pill = document.getElementById("api-pill");
  pill.className = "api-pill " + (state === "ok" ? "connected" : state === "error" ? "error" : "");
  pill.querySelector(".pill-text").textContent = text;
}


// ════════════════════════════════════════════════════════
//  DATA FETCHING
// ════════════════════════════════════════════════════════
async function fetchData() {
  try {
    setPillState("", "Fetching…");
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    allData = await res.json();

    setPillState("ok", `API Connected · ${allData.length} records`);

    // ① FEATURE: stamp the last-updated time
    stampLastUpdated();

    renderAll();

  } catch (err) {
    console.error("Fetch error:", err);
    setPillState("error", "API Offline");
    setKpiError();
  }
}


// ════════════════════════════════════════════════════════
//  RENDER ORCHESTRATOR
// ════════════════════════════════════════════════════════
function renderAll() {
  const range    = document.getElementById("range-select").value;
  const filtered = filterByRange(allData, range);

  updateKPIs(filtered);
  buildChart(filtered);
  buildIncidentTable(allData);  // always show all incidents
  handleAlert(allData);
  updateInsight(allData);       // ③ FEATURE: insight section
}

// Called when the dropdown changes
function applyRange() {
  if (allData.length === 0) return;
  renderAll();
}


// ════════════════════════════════════════════════════════
//  RANGE FILTER
// ════════════════════════════════════════════════════════

/**
 * Return the last N days of data, or all if range === "all".
 */
function filterByRange(data, range) {
  if (range === "all" || !range) return data;
  const n = parseInt(range, 10);
  return data.slice(-n);    // last N entries (data is sorted asc)
}


// ════════════════════════════════════════════════════════
//  KPI CARDS
// ════════════════════════════════════════════════════════
function updateKPIs(data) {
  if (!data.length) return;

  const usages    = data.map(d => d.usage);
  const total     = usages.reduce((a, b) => a + b, 0);
  const avg       = total / usages.length;
  const today     = usages[usages.length - 1];
  const yesterday = usages[usages.length - 2] ?? today;
  const diff      = today - yesterday;
  const highCount = data.filter(d => d.status === "high").length;

  // Animate number counters
  animateNum("kpi-total", total, 1);
  animateNum("kpi-avg",   avg,   1);

  // ── Trend card ────────────────────────────────────────
  const trendEl    = document.getElementById("kpi-trend");
  const trendLabel = document.getElementById("kpi-trend-label");
  const trendIcon  = document.getElementById("trend-icon");

  trendEl.textContent    = (diff > 0 ? "+" : "") + diff.toFixed(1);
  trendLabel.textContent = `vs previous day (today: ${today.toFixed(1)} kWh)`;

  trendEl.className = "kpi-value";
  if (diff > 2) {
    trendEl.classList.add("trend-up");
    trendIcon.textContent = "↑";
  } else if (diff < -2) {
    trendEl.classList.add("trend-down");
    trendIcon.textContent = "↓";
  } else {
    trendEl.classList.add("trend-flat");
    trendIcon.textContent = "→";
  }

  // ── Status card ───────────────────────────────────────
  const statusEl  = document.getElementById("kpi-status");
  const statusSub = document.getElementById("kpi-status-sub");

  if (highCount > 0) {
    statusEl.textContent  = "High";
    statusEl.className    = "kpi-value status-high";
    statusSub.textContent = `${highCount} high-usage day${highCount > 1 ? "s" : ""} in view`;
  } else if (avg >= WARN_THRESHOLD) {
    statusEl.textContent  = "Warning";
    statusEl.className    = "kpi-value status-warning";
    statusSub.textContent = `Average usage above ${WARN_THRESHOLD} kWh`;
  } else {
    statusEl.textContent  = "Normal";
    statusEl.className    = "kpi-value status-normal";
    statusSub.textContent = "All readings within range";
  }

  // ② FEATURE: Apply dynamic color level to all KPI cards
  // Level is based on the most recent day's usage value
  applyKpiLevel(today);
}

/**
 * ② FEATURE: Dynamic KPI Card Colors
 * Adds a CSS class to every KPI card based on the latest day's usage.
 *   < 150 kWh  → level-normal  (green glow)
 *   150–180    → level-warning (amber glow)
 *   > 180      → level-high    (red glow)
 */
function applyKpiLevel(latestUsage) {
  // Determine which level applies
  let level;
  if (latestUsage > HIGH_THRESHOLD)     level = "high";
  else if (latestUsage >= WARN_THRESHOLD) level = "warning";
  else                                   level = "normal";

  // Apply to every KPI card (remove old level classes first)
  document.querySelectorAll(".kpi-card").forEach(card => {
    card.classList.remove("level-normal", "level-warning", "level-high");
    card.classList.add(`level-${level}`);
  });
}

function setKpiError() {
  ["kpi-total","kpi-avg","kpi-trend","kpi-status"].forEach(id => {
    document.getElementById(id).textContent = "—";
  });
}

/**
 * Smooth count-up animation for a numeric KPI element.
 */
function animateNum(id, target, decimals = 1) {
  const el       = document.getElementById(id);
  const duration = 900;
  const start    = performance.now();

  const tick = (now) => {
    const t     = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);   // ease-out cubic
    el.textContent = (eased * target).toFixed(decimals);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}


// ════════════════════════════════════════════════════════
//  CHART
// ════════════════════════════════════════════════════════
function buildChart(data) {
  const ctx = document.getElementById("energyChart").getContext("2d");

  // Format x-axis labels (e.g. "Jan 01")
  const labels = data.map(d => {
    const [, mm, dd] = d.date.split("-");
    return `${monthShort(mm)} ${dd}`;
  });

  const values   = data.map(d => d.usage);
  const isHighArr = data.map(d => d.status === "high");

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, 290);
  grad.addColorStop(0, "rgba(34, 211, 165, 0.22)");
  grad.addColorStop(1, "rgba(34, 211, 165, 0.00)");

  // Per-point colours: red for high, teal for normal
  const pointColors = isHighArr.map(h => h ? "#f87171" : "#22d3a5");
  const pointBorder = isHighArr.map(h => h ? "#f87171" : "#22d3a5");

  const chartData = {
    labels,
    datasets: [{
      label: "Usage (kWh)",
      data: values,
      borderColor: "#22d3a5",
      backgroundColor: grad,
      pointBackgroundColor: pointColors,
      pointBorderColor: "#0f172a",
      pointBorderWidth: 2,
      pointRadius: data.length > 60 ? 2 : 4,   // smaller dots for large datasets
      pointHoverRadius: 6,
      fill: true,
      tension: 0.35,
      borderWidth: 2,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },

      // Threshold annotation line (manual via afterDraw plugin below)
      tooltip: {
        backgroundColor: "#1a2840",
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        titleColor: "#e2e8f0",
        bodyColor: "#94a3b8",
        padding: 12,
        callbacks: {
          label: ctx => {
            const status = data[ctx.dataIndex]?.status;
            const flag   = status === "high" ? " ⚠ HIGH" : "";
            return ` ${ctx.parsed.y} kWh${flag}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid:  { color: "rgba(255,255,255,0.04)" },
        ticks: {
          color: "#475569",
          font: { family: "'Fira Code'", size: 10 },
          // Show fewer ticks for large ranges
          maxTicksLimit: data.length > 60 ? 12 : 20,
          maxRotation: 45
        }
      },
      y: {
        grid:  { color: "rgba(255,255,255,0.06)" },
        ticks: { color: "#475569", font: { family: "'Fira Code'", size: 10 } },
        beginAtZero: false,
        suggestedMin: 60,
      }
    }
  };

  if (energyChart) {
    // Update existing chart (avoids flicker on refresh)
    energyChart.data    = chartData;
    energyChart.options = chartOptions;
    energyChart.update("none");   // "none" = skip animation on refresh
  } else {
    energyChart = new Chart(ctx, {
      type: "line",
      data: chartData,
      options: chartOptions,
      plugins: [{
        // Draw a dashed red threshold line at 180 kWh
        id: "thresholdLine",
        afterDraw(chart) {
          const { ctx: c, scales: { y, x } } = chart;
          const yPixel = y.getPixelForValue(HIGH_THRESHOLD);

          c.save();
          c.setLineDash([6, 4]);
          c.strokeStyle = "rgba(248,113,113,0.45)";
          c.lineWidth   = 1.5;
          c.beginPath();
          c.moveTo(x.left,  yPixel);
          c.lineTo(x.right, yPixel);
          c.stroke();

          // Label
          c.setLineDash([]);
          c.fillStyle  = "rgba(248,113,113,0.75)";
          c.font       = "10px 'Fira Code'";
          c.fillText(`${HIGH_THRESHOLD} kWh threshold`, x.right - 130, yPixel - 6);
          c.restore();
        }
      }]
    });
  }
}


// ════════════════════════════════════════════════════════
//  ALERT BANNER
// ════════════════════════════════════════════════════════
function handleAlert(data) {
  const highDays = data.filter(d => d.status === "high");
  const banner   = document.getElementById("alert-banner");
  const detail   = document.getElementById("alert-detail");

  if (highDays.length > 0) {
    const latest = highDays[highDays.length - 1];
    detail.textContent =
      `${highDays.length} day${highDays.length > 1 ? "s" : ""} exceeded 180 kWh. ` +
      `Latest: ${latest.date} (${latest.usage} kWh)`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

function dismissAlert() {
  document.getElementById("alert-banner").classList.add("hidden");
}


// ════════════════════════════════════════════════════════
//  INCIDENTS TABLE
// ════════════════════════════════════════════════════════
function buildIncidentTable(data) {
  const highDays = data
    .filter(d => d.status === "high")
    .sort((a, b) => b.usage - a.usage);   // sorted by severity

  document.getElementById("incident-count").textContent =
    `${highDays.length} incident${highDays.length !== 1 ? "s" : ""}`;

  const tbody = document.getElementById("incidents-body");
  tbody.innerHTML = "";

  if (highDays.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;color:var(--txt-lo);padding:24px;">
          ✅ No high-usage incidents found
        </td>
      </tr>`;
    return;
  }

  highDays.forEach(row => {
    const over    = (row.usage - HIGH_THRESHOLD).toFixed(1);
    const barPct  = Math.min((row.usage - HIGH_THRESHOLD) / 40 * 100, 100);  // 40 kWh max bar

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="td-date">${row.date}</td>
      <td class="td-usage">${row.usage.toFixed(1)}</td>
      <td>
        <div class="over-bar">
          <div class="over-bar-fill" style="width:${barPct}px"></div>
          <span class="over-label">+${over}</span>
        </div>
      </td>
      <td><span class="status-pill">HIGH</span></td>
    `;
    tbody.appendChild(tr);
  });
}


// ════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════
function monthShort(mm) {
  return ["Jan","Feb","Mar","Apr","May","Jun",
          "Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(mm, 10) - 1] ?? mm;
}


// ════════════════════════════════════════════════════════
//  ① FEATURE: LAST UPDATED TIMESTAMP
// ════════════════════════════════════════════════════════

/**
 * Stamps the current time into the "Last Updated" display.
 * Also starts a staleness timer — after 20 s without a refresh,
 * the timestamp turns amber to signal the data might be old.
 */
let staleTimer = null;

function stampLastUpdated() {
  const el    = document.getElementById("last-updated");
  const block = document.getElementById("updated-block");

  // Format as HH:MM:SS
  const now = new Date().toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });

  el.textContent = now;
  el.classList.remove("stale");    // fresh = green
  block.classList.add("visible");  // fade in on first update

  // After 20 s without a new stamp → turn amber (stale)
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => el.classList.add("stale"), 20_000);
}


// ════════════════════════════════════════════════════════
//  ③ FEATURE: ENERGY INSIGHT SECTION
// ════════════════════════════════════════════════════════

/**
 * Compares the last 7 days vs the 7 days before that,
 * then surfaces spike detection and average in the Insight panel.
 */
function updateInsight(data) {
  if (data.length < 2) return;

  // Slice last 14 entries (or however many exist)
  const recent = data.slice(-7);          // last 7 days
  const prev   = data.slice(-14, -7);     // 7 days before that

  // ── Period comparison ─────────────────────────────────
  const recentAvg = avg(recent.map(d => d.usage));
  const prevAvg   = prev.length ? avg(prev.map(d => d.usage)) : recentAvg;

  // Percentage change: positive = increase, negative = decrease
  const pctChange = prevAvg === 0
    ? 0
    : ((recentAvg - prevAvg) / prevAvg * 100);
  const absPct    = Math.abs(pctChange).toFixed(1);

  const compareCard  = document.getElementById("insight-compare");
  const compareVal   = document.getElementById("insight-compare-value");
  const compareSub   = document.getElementById("insight-compare-sub");
  const compareIcon  = document.getElementById("insight-compare-icon");

  // Reset classes
  compareCard.classList.remove("insight-up", "insight-down");

  if (pctChange > 1) {
    // Usage went up → warn the user
    compareVal.textContent = `↑ Increased by ${absPct}%`;
    compareSub.textContent = `Last 7-day avg: ${recentAvg.toFixed(1)} kWh vs ${prevAvg.toFixed(1)} kWh`;
    compareCard.classList.add("insight-up");
    compareIcon.textContent = "📈";
  } else if (pctChange < -1) {
    // Usage went down → positive news
    compareVal.textContent = `↓ Decreased by ${absPct}%`;
    compareSub.textContent = `Last 7-day avg: ${recentAvg.toFixed(1)} kWh vs ${prevAvg.toFixed(1)} kWh`;
    compareCard.classList.add("insight-down");
    compareIcon.textContent = "📉";
  } else {
    // Essentially flat
    compareVal.textContent = `→ Stable (${absPct}% change)`;
    compareSub.textContent = `Last 7-day avg: ${recentAvg.toFixed(1)} kWh`;
    compareIcon.textContent = "📊";
  }

  // ── Spike detection ───────────────────────────────────
  // Look for spikes in the full dataset
  const spikeCount = data.filter(d => d.usage > HIGH_THRESHOLD).length;
  const last7Spikes = recent.filter(d => d.usage > HIGH_THRESHOLD).length;

  const spikeCard  = document.getElementById("insight-spikes");
  const spikeVal   = document.getElementById("insight-spike-value");
  const spikeSub   = document.getElementById("insight-spike-sub");
  const spikeIcon  = document.getElementById("insight-spike-icon");

  spikeCard.classList.remove("insight-alert", "insight-down");

  if (last7Spikes > 1) {
    // Multiple spikes in recent window → prominent warning
    spikeVal.textContent = `⚠ Multiple high-usage days detected`;
    spikeSub.textContent = `${last7Spikes} spikes in last 7 days · ${spikeCount} total`;
    spikeCard.classList.add("insight-alert");
    spikeIcon.textContent = "⚠️";
  } else if (last7Spikes === 1) {
    spikeVal.textContent = `1 spike in last 7 days`;
    spikeSub.textContent = `${spikeCount} total high-usage days on record`;
    spikeCard.classList.add("insight-alert");
    spikeIcon.textContent = "⚡";
  } else {
    spikeVal.textContent = `No spikes in last 7 days`;
    spikeSub.textContent = `${spikeCount} total high-usage days on record`;
    spikeCard.classList.add("insight-down");
    spikeIcon.textContent = "✅";
  }

  // ── 7-day average card ────────────────────────────────
  document.getElementById("insight-avg7-value").textContent =
    `${recentAvg.toFixed(1)} kWh/day`;
}

/** Simple average helper */
function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}


// ════════════════════════════════════════════════════════
//  BOOTSTRAP
// ════════════════════════════════════════════════════════
startClock();
fetchData();                          // initial load
setInterval(fetchData, REFRESH_MS);  // ① auto-refresh every 10 s
