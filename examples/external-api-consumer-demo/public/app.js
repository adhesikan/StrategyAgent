import {
  errorState,
  renderAccumulation,
  renderMultibagger,
  renderMultibaggerDetail,
  renderStock,
} from "./ui-render.mjs";

const app = document.querySelector("#app");
const tabs = [...document.querySelectorAll(".tab")];
const state = {
  view: "accumulation",
  accumulation: { sector: "", industry: "", theme: "", limit: "25", offset: 0 },
  multibagger: { minOverallScore: "", profile: "", sector: "", limit: "25", offset: 0 },
  stockSymbol: "",
  stock: null,
  trend: null,
  detail: null,
};

function query(params) {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value !== undefined && value !== null) output.set(key, value);
  }
  return output.toString();
}

async function api(path, params = {}) {
  const suffix = query(params);
  const response = await fetch(`/api/demo${path}${suffix ? `?${suffix}` : ""}`, {
    headers: { accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw body.error ?? { code: "DEMO_PROXY_ERROR", message: "The demo could not retrieve this resource." };
  return body;
}

function loading(label = "Loading API response…") {
  app.innerHTML = `<div class="loading-state"><span class="loader"></span>${label}</div>`;
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function loadAccumulation(params = state.accumulation) {
  state.accumulation = { ...state.accumulation, ...params };
  loading("Requesting accumulation ranking…");
  try {
    const data = await api("/institutional/accumulation", state.accumulation);
    app.innerHTML = renderAccumulation(data.data, state.accumulation);
    bindViewEvents();
  } catch (error) {
    app.innerHTML = errorState(error);
    bindViewEvents();
  }
}

async function loadStock(symbol = state.stockSymbol) {
  state.stockSymbol = symbol.trim().toUpperCase();
  loading("Requesting stock analytics and trend…");
  try {
    const [stock, trend] = await Promise.all([
      api(`/institutional/stocks/${encodeURIComponent(state.stockSymbol)}`),
      api(`/institutional/stocks/${encodeURIComponent(state.stockSymbol)}/trend`),
    ]);
    state.stock = stock;
    state.trend = trend;
    app.innerHTML = renderStock(stock, trend, state.stockSymbol);
    bindViewEvents();
  } catch (error) {
    app.innerHTML = errorState(error);
    bindViewEvents();
  }
}

async function loadMultibagger(params = state.multibagger) {
  state.multibagger = { ...state.multibagger, ...params };
  loading("Requesting candidate profile screen…");
  try {
    const data = await api("/multibagger/screener", state.multibagger);
    app.innerHTML = renderMultibagger(data.data, state.multibagger);
    bindViewEvents();
  } catch (error) {
    app.innerHTML = errorState(error);
    bindViewEvents();
  }
}

async function loadDetail(symbol) {
  loading("Requesting server-provided symbol detail…");
  try {
    state.detail = await api(`/multibagger/${encodeURIComponent(symbol)}`);
    app.innerHTML = renderMultibaggerDetail(state.detail);
    bindViewEvents();
  } catch (error) {
    app.innerHTML = errorState(error);
    bindViewEvents();
  }
}

function showView(view) {
  state.view = view;
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  if (view === "accumulation") loadAccumulation();
  if (view === "stock") {
    app.innerHTML = renderStock(null, null, state.stockSymbol);
    bindViewEvents();
  }
  if (view === "multibagger") loadMultibagger();
}

function bindViewEvents() {
  document.querySelector(".retry-button")?.addEventListener("click", () => showView(state.view));
  document.querySelector(".symbol-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = readForm(event.currentTarget);
    if (values.symbol) loadStock(values.symbol);
  });
  document.querySelector(".apply-ranking")?.addEventListener("click", () => {
    const values = readForm(document.querySelector(".filter-bar"));
    loadAccumulation({ ...values, offset: 0 });
  });
  document.querySelector(".apply-multibagger")?.addEventListener("click", () => {
    const values = readForm(document.querySelector(".filter-bar"));
    loadMultibagger({ ...values, offset: 0 });
  });
  document.querySelectorAll(".page-button:not([disabled])").forEach((button) => button.addEventListener("click", () => {
    const offset = Number(button.dataset.offset);
    if (state.view === "accumulation") loadAccumulation({ offset });
    if (state.view === "multibagger") loadMultibagger({ offset });
  }));
  document.querySelectorAll(".stock-link").forEach((button) => button.addEventListener("click", () => {
    state.stockSymbol = button.dataset.symbol;
    showView("stock");
    loadStock(state.stockSymbol);
  }));
  document.querySelectorAll(".multibagger-link").forEach((button) => button.addEventListener("click", () => loadDetail(button.dataset.symbol)));
  document.querySelector(".back-to-screen")?.addEventListener("click", () => showView("multibagger"));
}

tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
showView("accumulation");