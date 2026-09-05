const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n, currency = "USD") => {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  let suffix = "", div = 1;
  if (abs >= 1e12) { suffix = "T"; div = 1e12; }
  else if (abs >= 1e9) { suffix = "B"; div = 1e9; }
  else if (abs >= 1e6) { suffix = "M"; div = 1e6; }
  return `${(n / div).toFixed(2)}${suffix}`;
};
const fmtPct = (n) => (n === null || n === undefined) ? "—" : `${(n * 100).toFixed(2)}%`;
const fmtNum = (n) => (n === null || n === undefined) ? "—" : n.toLocaleString();
const fmtPrice = (n) => (n === null || n === undefined) ? "—" : `$${n.toFixed(2)}`;

let priceChart, volumeChart, rsiChart, forecastChart;
let currentSymbol = null;
let currentRange = "5y";
let currentForecastDays = 90;
let financialsCache = null;

const chartDefaults = {
  color: "#97A0B5",
  font: { family: "IBM Plex Mono" },
};

function baseGridOptions() {
  return {
    grid: { color: "rgba(255,255,255,0.05)", drawTicks: false },
    ticks: { color: "#97A0B5", font: { family: "IBM Plex Mono", size: 10 }, maxRotation: 0 },
    border: { color: "#26314A" },
  };
}

// -------------------- Search wiring --------------------

document.querySelectorAll(".chip").forEach((c) => {
  c.addEventListener("click", () => {
    $("#ticker-input").value = c.dataset.t;
    loadSymbol(c.dataset.t);
  });
});

$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const val = $("#ticker-input").value.trim();
  if (val) loadSymbol(val);
});

async function loadSymbol(symbol) {
  currentSymbol = symbol.toUpperCase();
  $("#search-error").textContent = "";
  $("#dashboard").classList.add("hidden");
  $("#loader").classList.remove("hidden");
  $("#loader-text").textContent = `Pulling data for ${currentSymbol}…`;

  try {
    const companyRes = await fetch(`/api/company/${currentSymbol}`);
    const companyData = await companyRes.json();
    if (companyData.error) throw new Error(companyData.error);

    renderCompany(companyData);

    const [histData, finData, forecastData, macroData] = await Promise.all([
      fetch(`/api/history/${currentSymbol}?range=${currentRange}`).then((r) => r.json()),
      fetch(`/api/financials/${currentSymbol}`).then((r) => r.json()),
      fetch(`/api/forecast/${currentSymbol}?days=${currentForecastDays}`).then((r) => r.json()),
      fetch(`/api/macro`).then((r) => r.json()),
    ]);

    if (!histData.error) renderHistory(histData);
    if (!finData.error) { financialsCache = finData; renderFinancials("income"); }
    if (!forecastData.error) renderForecast(forecastData, companyData);
    if (!macroData.error) renderMacro(macroData);

    $("#loader").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    $("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    $("#loader").classList.add("hidden");
    $("#search-error").textContent = err.message || "Something went wrong.";
  }
}

// -------------------- Render: company identity --------------------

function renderCompany(d) {
  $("#c-symbol").textContent = d.symbol;
  $("#c-exchange").textContent = d.exchange || "";
  $("#c-name").textContent = d.name;
  $("#c-sector").textContent = d.sector || "—";
  $("#c-industry").textContent = d.industry || "—";
  $("#c-country").textContent = d.country || "—";
  $("#c-summary").textContent = d.summary || "";

  $("#c-price").textContent = fmtPrice(d.price);
  const changeEl = $("#c-change");
  if (d.change !== null && d.change !== undefined) {
    const sign = d.change >= 0 ? "+" : "";
    changeEl.textContent = `${sign}${d.change.toFixed(2)} (${sign}${d.changePercent.toFixed(2)}%) today`;
    changeEl.className = "c-change " + (d.change >= 0 ? "pos" : "neg");
  } else {
    changeEl.textContent = "—";
  }

  if (d.fiftyTwoWeekLow && d.fiftyTwoWeekHigh && d.price) {
    $("#c-low").textContent = fmtPrice(d.fiftyTwoWeekLow);
    $("#c-high").textContent = fmtPrice(d.fiftyTwoWeekHigh);
    const pct = ((d.price - d.fiftyTwoWeekLow) / (d.fiftyTwoWeekHigh - d.fiftyTwoWeekLow)) * 100;
    $("#range-dot").style.left = `${Math.min(Math.max(pct, 0), 100)}%`;
  }

  $("#s-mcap").textContent = fmtMoney(d.marketCap);
  $("#s-pe").textContent = d.peRatio ? d.peRatio.toFixed(1) : "—";
  $("#s-fpe").textContent = d.forwardPE ? d.forwardPE.toFixed(1) : "—";
  $("#s-eps").textContent = d.eps ? `$${d.eps.toFixed(2)}` : "—";
  $("#s-div").textContent = d.dividendYield ? fmtPct(d.dividendYield) : "0.00%";
  $("#s-beta").textContent = d.beta ? d.beta.toFixed(2) : "—";
  $("#s-emp").textContent = d.employees ? fmtNum(d.employees) : "—";

  const marginGrid = $("#margin-grid");
  marginGrid.innerHTML = "";
  const margins = [
    ["Gross Margin", fmtPct(d.grossMargins)],
    ["Operating Margin", fmtPct(d.operatingMargins)],
    ["Profit Margin", fmtPct(d.profitMargins)],
    ["Return on Equity", fmtPct(d.returnOnEquity)],
    ["Return on Assets", fmtPct(d.returnOnAssets)],
    ["Revenue Growth (YoY)", fmtPct(d.revenueGrowth)],
  ];
  margins.forEach(([label, val]) => {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<span class="stat-label">${label}</span><span class="stat-val">${val}</span>`;
    marginGrid.appendChild(div);
  });
}

// -------------------- Render: history + technicals --------------------

document.querySelectorAll("#range-toggle button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#range-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;
    const data = await fetch(`/api/history/${currentSymbol}?range=${currentRange}`).then((r) => r.json());
    if (!data.error) renderHistory(data);
  });
});

function renderHistory(d) {
  $("#s-listed").textContent = d.listedSince ? d.listedSince.slice(0, 4) : "—";

  const ctx = $("#priceChart").getContext("2d");
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: d.dates,
      datasets: [
        {
          label: "Close",
          data: d.close,
          borderColor: "#D4A24E",
          backgroundColor: "rgba(212,162,78,0.08)",
          fill: true,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.15,
        },
        {
          label: "SMA 50",
          data: d.sma50,
          borderColor: "#3FB68B",
          borderWidth: 1.3,
          pointRadius: 0,
          borderDash: [3, 3],
        },
        {
          label: "SMA 200",
          data: d.sma200,
          borderColor: "#E2574C",
          borderWidth: 1.3,
          pointRadius: 0,
          borderDash: [3, 3],
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#97A0B5", font: { family: "IBM Plex Mono", size: 11 }, boxWidth: 14 } },
        tooltip: { backgroundColor: "#0F1626", borderColor: "#26314A", borderWidth: 1, titleFont: { family: "IBM Plex Mono" }, bodyFont: { family: "IBM Plex Mono" } },
      },
      scales: {
        x: { ...baseGridOptions(), ticks: { ...baseGridOptions().ticks, maxTicksLimit: 8 } },
        y: baseGridOptions(),
      },
    },
  });

  const vctx = $("#volumeChart").getContext("2d");
  if (volumeChart) volumeChart.destroy();
  volumeChart = new Chart(vctx, {
    type: "bar",
    data: {
      labels: d.dates,
      datasets: [{ label: "Volume", data: d.volume, backgroundColor: "rgba(151,160,181,0.35)" }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ...baseGridOptions(), ticks: { ...baseGridOptions().ticks, maxTicksLimit: 3 } },
      },
    },
  });

  const rctx = $("#rsiChart").getContext("2d");
  if (rsiChart) rsiChart.destroy();
  rsiChart = new Chart(rctx, {
    type: "line",
    data: {
      labels: d.dates,
      datasets: [{
        label: "RSI (14)",
        data: d.rsi,
        borderColor: "#D4A24E",
        pointRadius: 0,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ...baseGridOptions(), ticks: { ...baseGridOptions().ticks, maxTicksLimit: 6 } },
        y: { ...baseGridOptions(), min: 0, max: 100 },
      },
    },
  });

  const lastRsi = [...d.rsi].reverse().find((v) => v !== null && v !== undefined);
  if (lastRsi !== undefined) {
    let note = `Current RSI: ${lastRsi.toFixed(1)}. `;
    if (lastRsi > 70) note += "Above 70 is often read as overbought.";
    else if (lastRsi < 30) note += "Below 30 is often read as oversold.";
    else note += "Between 30–70 is considered neutral territory.";
    $("#rsi-note").textContent = note;
  }
}

// -------------------- Render: financial statements --------------------

document.querySelectorAll("#fin-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#fin-tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderFinancials(btn.dataset.tab);
  });
});

function renderFinancials(tab) {
  if (!financialsCache) return;
  const dataset = financialsCache[tab];
  const thead = $("#fin-table thead");
  const tbody = $("#fin-table tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const rows = Object.keys(dataset || {});
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No data available for this statement.</td></tr>`;
    return;
  }
  const years = Object.keys(dataset[rows[0]]).sort().reverse();

  const headRow = document.createElement("tr");
  headRow.innerHTML = `<th>Line item</th>` + years.map((y) => `<th>${y}</th>`).join("");
  thead.appendChild(headRow);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    let html = `<td>${row}</td>`;
    years.forEach((y) => {
      const val = dataset[row][y];
      html += `<td>${val === null || val === undefined ? "—" : fmtMoney(val)}</td>`;
    });
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}

// -------------------- Render: forecast --------------------

document.querySelectorAll("#forecast-toggle button").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#forecast-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentForecastDays = btn.dataset.days;
    const data = await fetch(`/api/forecast/${currentSymbol}?days=${currentForecastDays}`).then((r) => r.json());
    if (!data.error) renderForecast(data);
  });
});

function renderForecast(d, companyData) {
  $("#f-drift").textContent = `${d.annualizedDriftPct >= 0 ? "+" : ""}${d.annualizedDriftPct}%/yr`;
  $("#f-vol").textContent = `${d.annualizedVolatilityPct}%/yr`;
  if (companyData && companyData.targetMeanPrice) {
    $("#f-target").textContent = `${fmtPrice(companyData.targetMeanPrice)} (${companyData.numberOfAnalystOpinions || 0} analysts)`;
  }

  const labels = [d.lastDate, ...d.dates];
  const anchor = d.lastPrice;
  const projected = [anchor, ...d.projected];
  const upper68 = [anchor, ...d.upper68];
  const lower68 = [anchor, ...d.lower68];
  const upper95 = [anchor, ...d.upper95];
  const lower95 = [anchor, ...d.lower95];

  const ctx = $("#forecastChart").getContext("2d");
  if (forecastChart) forecastChart.destroy();
  forecastChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "95% band", data: upper95, borderColor: "transparent", backgroundColor: "rgba(212,162,78,0.06)", fill: "+1", pointRadius: 0 },
        { label: "_lower95", data: lower95, borderColor: "transparent", fill: false, pointRadius: 0 },
        { label: "68% band", data: upper68, borderColor: "transparent", backgroundColor: "rgba(212,162,78,0.14)", fill: "+1", pointRadius: 0 },
        { label: "_lower68", data: lower68, borderColor: "transparent", fill: false, pointRadius: 0 },
        { label: "Projected path", data: projected, borderColor: "#D4A24E", borderWidth: 2, borderDash: [6, 4], pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          labels: {
            color: "#97A0B5", font: { family: "IBM Plex Mono", size: 11 }, boxWidth: 14,
            filter: (item) => !item.text.startsWith("_"),
          },
        },
        tooltip: { backgroundColor: "#0F1626", borderColor: "#26314A", borderWidth: 1 },
      },
      scales: {
        x: { ...baseGridOptions(), ticks: { ...baseGridOptions().ticks, maxTicksLimit: 8 } },
        y: baseGridOptions(),
      },
    },
  });
}

// -------------------- Render: macro --------------------

function renderMacro(d) {
  const grid = $("#macro-grid");
  grid.innerHTML = "";
  Object.entries(d).forEach(([label, obj]) => {
    const div = document.createElement("div");
    div.className = "stat";
    const sign = obj.changePercent >= 0 ? "+" : "";
    const cls = obj.changePercent >= 0 ? "pos" : "neg";
    div.innerHTML = `<span class="stat-label">${label}</span><span class="stat-val">${obj.value} <span class="c-change ${cls}" style="font-size:12px">${sign}${obj.changePercent}%</span></span>`;
    grid.appendChild(div);
  });
}
