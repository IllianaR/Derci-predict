    const fmtInt = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString() : "—";
    const fmt1 = (n) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toLocaleString() : "—";
    const fmtPct = (n) => Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

    const STORAGE_KEY = "df_sandbox_v2";

    function today() {
      const d = new Date();
      d.setHours(0,0,0,0);
      return d;
    }
    function addDays(d, days) {
      const n = new Date(d);
      n.setDate(n.getDate() + days);
      return n;
    }
    function ymd(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${da}`;
    }
    function monthLabel(d) {
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    const DEFAULTS = {
      sandbox: {
        id: "sandbox",
        mode: "editable",
        location: { label: "Sandbox", county: "", state: "" },
        capacity: {
          retorts: 2,
          cycles_per_retort_per_day: 2.0,
          operating_days_per_week: 5,
          staffing_factor: 0.85,
          refrigeration_slots: 20
        },
        demand: {
          deaths_per_year: 6500,
          cremation_rate: 0.634,
          authorization_delay_days: 2.0,
          seasonality_on: true,
          surge: 0
        }
      },
      miami: {
        id: "miami",
        mode: "readonly",
        location: { label: "Miami-Dade County, Florida", county: "Miami-Dade", state: "FL" },
        capacity: { retorts: 9, cycles_per_retort_per_day: 2.3, operating_days_per_week: 6, staffing_factor: 1.0, refrigeration_slots: 120 },
        demand: { deaths_per_year: 28000, cremation_rate: 0.634, authorization_delay_days: 2.4, seasonality_on: true, surge: 0 }
      },
      anchorage: {
        id: "anchorage",
        mode: "readonly",
        location: { label: "Anchorage Borough, Alaska", county: "Anchorage", state: "AK" },
        capacity: { retorts: 2, cycles_per_retort_per_day: 1.7, operating_days_per_week: 5, staffing_factor: 0.85, refrigeration_slots: 26 },
        demand: { deaths_per_year: 2600, cremation_rate: 0.618, authorization_delay_days: 3.5, seasonality_on: true, surge: 0 }
      },
      mecklenburg: {
        id: "mecklenburg",
        mode: "readonly",
        location: { label: "Mecklenburg County, North Carolina", county: "Mecklenburg", state: "NC" },
        capacity: { retorts: 4, cycles_per_retort_per_day: 2.0, operating_days_per_week: 5, staffing_factor: 0.85, refrigeration_slots: 55 },
        demand: { deaths_per_year: 9500, cremation_rate: 0.634, authorization_delay_days: 2.2, seasonality_on: true, surge: 0 }
      }
    };

    const appState = {
      currentTab: "sandbox",
      rangeDays: 365,
      heatCursor: today(),
      sandbox: null,
      cases: {
        miami: DEFAULTS.miami,
        anchorage: DEFAULTS.anchorage,
        mecklenburg: DEFAULTS.mecklenburg
      }
    };

    let chart;

    function seasonality(month) {
      return [1.08, 1.05, 1.02, 1, 0.98, 0.96, 0.95, 0.96, 0.98, 1, 1.03, 1.07][month] || 1;
    }

    function activeState() {
      return appState.currentTab === "sandbox" ? appState.sandbox : appState.cases[appState.currentTab];
    }

    function effectiveCapacityPerDay(s) {
      const retortBase = s.capacity.retorts * s.capacity.cycles_per_retort_per_day;
      const operatingAdj = s.capacity.operating_days_per_week / 7;
      const staffAdj = s.capacity.staffing_factor;
      const effective = retortBase * operatingAdj * staffAdj;
      return effective;
    }

    function demandForDate(s, d) {
      const deathsDaily = s.demand.deaths_per_year / 365;
      const seasonal = s.demand.seasonality_on ? seasonality(d.getMonth()) : 1;
      const surge = 1 + (s.demand.surge || 0);
      const cremRate = s.demand.cremation_rate || 0.6;
      return deathsDaily * seasonal * surge * cremRate;
    }

    function runProjection(s, start, days) {
      const cap = effectiveCapacityPerDay(s);
      const labels = [];
      const demandSeries = [];
      const capSeries = [];

      let totalDeaths = 0;
      let totalCrem = 0;
      let backlog = 0;
      let riskDays = 0;
      let firstStrain = null;

      for (let i = 0; i < days; i++) {
        const d = addDays(start, i);
        const deathsDaily = (s.demand.deaths_per_year / 365) * (s.demand.seasonality_on ? seasonality(d.getMonth()) : 1) * (1 + (s.demand.surge || 0));
        const demand = deathsDaily * s.demand.cremation_rate;

        backlog = Math.max(0, backlog + demand - cap);

        const isRisk = demand > cap || backlog > 0;
        if (isRisk) {
          riskDays += 1;
          if (!firstStrain) firstStrain = new Date(d);
        }

        totalDeaths += deathsDaily;
        totalCrem += demand;

        labels.push(ymd(d));
        demandSeries.push(demand);
        capSeries.push(cap);
      }

      const utilization = cap > 0 ? (totalCrem / days) / cap : Infinity;
      const backlogRisk = riskDays / days;

      return {
        totalDeaths,
        totalCrem,
        utilization,
        backlogRisk,
        firstStrain,
        cap,
        labels,
        demandSeries,
        capSeries
      };
    }

    function renderKPIs(s, p) {
      document.getElementById("kDeaths").textContent = fmtInt(p.totalDeaths);
      document.getElementById("kCrem").textContent = fmtInt(p.totalCrem);
      document.getElementById("kUtil").textContent = fmtPct(p.utilization);
      document.getElementById("kRisk").textContent = fmtPct(p.backlogRisk);
      document.getElementById("kFirst").textContent = p.firstStrain ? ymd(p.firstStrain) : "No strain";
      document.getElementById("kDeathsHint").textContent = `${appState.rangeDays} day period`;
      document.getElementById("kCremHint").textContent = `Cremation rate ${fmtPct(s.demand.cremation_rate)}`;
    }

    function renderChart(proj) {
      const bucket = appState.rangeDays > 365 ? 30 : appState.rangeDays > 60 ? 7 : 1;
      const labels = [];
      const demand = [];
      const capacity = [];

      for (let i = 0; i < proj.labels.length; i += bucket) {
        const end = Math.min(proj.labels.length, i + bucket);
        const chunk = proj.demandSeries.slice(i, end);
        const avgDemand = chunk.reduce((a,b)=>a+b,0) / chunk.length;
        labels.push(proj.labels[i]);
        demand.push(avgDemand);
        capacity.push(proj.cap);
      }

      const strainBand = demand.map((d) => d);

      if (chart) chart.destroy();
      const ctx = document.getElementById("heroChart");
      chart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Projected demand",
              data: demand,
              borderColor: "rgba(79,127,157,0.95)",
              backgroundColor: "rgba(79,127,157,0.16)",
              tension: 0.2,
              pointRadius: 0,
              borderWidth: 2
            },
            {
              label: "Effective capacity",
              data: capacity,
              borderColor: "rgba(19,74,112,0.92)",
              borderDash: [2, 4],
              borderCapStyle: "round",
              tension: 0,
              pointRadius: 0,
              borderWidth: 1.5
            },
            {
              label: "Strain area",
              data: strainBand,
              borderWidth: 0,
              pointRadius: 0,
              fill: {
                target: 1,
                above: "rgba(19,74,112,0.22)",
                below: "rgba(255,255,255,1)"
              }
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#5f7382", boxWidth: 9, boxHeight: 9 } }
          },
          scales: {
            x: { ticks: { color: "#5f7382", maxTicksLimit: 8 }, grid: { color: "rgba(177,196,208,0.55)" } },
            y: { ticks: { color: "#5f7382" }, grid: { color: "rgba(177,196,208,0.55)" } }
          }
        }
      });

      document.getElementById("chartMeta").textContent = `Bucket ${bucket === 1 ? "daily" : bucket === 7 ? "weekly" : "monthly"} · effective capacity ${fmt1(proj.cap)}/day`;
    }

    function heatColor(ratio) {
      const x = clamp(ratio, 0, 1.25) / 1.25;
      const start = [229, 239, 245];
      const end = [30, 92, 130];
      const r = Math.round(start[0] + (end[0] - start[0]) * x);
      const g = Math.round(start[1] + (end[1] - start[1]) * x);
      const b = Math.round(start[2] + (end[2] - start[2]) * x);
      return `rgb(${r}, ${g}, ${b})`;
    }

    function renderHeatmap(s) {
      const dow = document.getElementById("dow");
      const grid = document.getElementById("heatmap");
      dow.innerHTML = "";
      grid.innerHTML = "";

      ["Su","Mo","Tu","We","Th","Fr","Sa"].forEach(d => {
        const el = document.createElement("div");
        el.textContent = d;
        dow.appendChild(el);
      });

      const monthStart = new Date(appState.heatCursor.getFullYear(), appState.heatCursor.getMonth(), 1);
      const start = addDays(monthStart, -monthStart.getDay());
      const cap = effectiveCapacityPerDay(s);

      for (let i = 0; i < 42; i++) {
        const date = addDays(start, i);
        const demand = demandForDate(s, date);
        const util = cap > 0 ? demand / cap : 2;
        const backlog = Math.max(0, demand - cap);

        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.background = heatColor(util + backlog * 0.02);
        if (date.getMonth() !== appState.heatCursor.getMonth()) cell.style.opacity = "0.4";
        cell.title = `${ymd(date)}\nProjected cremations: ${fmt1(demand)}\nCapacity: ${fmt1(cap)}\nUtilization: ${fmtPct(util)}\nBacklog: ${fmt1(backlog)}`;
        grid.appendChild(cell);
      }

      document.getElementById("heatmapMonth").textContent = monthLabel(appState.heatCursor);
    }

    function buildField(label, type, value, onInput, opts = {}) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const l = document.createElement("label");
      l.textContent = label;
      wrap.appendChild(l);

      const input = document.createElement("input");
      input.type = type;
      input.value = value;
      if (opts.step !== undefined) input.step = opts.step;
      if (opts.min !== undefined) input.min = opts.min;
      if (opts.max !== undefined) input.max = opts.max;
      if (opts.disabled) input.disabled = true;
      input.addEventListener("input", () => onInput(input.value));
      wrap.appendChild(input);
      return wrap;
    }

    function buildSelectField(label, value, choices, onInput, disabled = false) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const l = document.createElement("label");
      l.textContent = label;
      const sel = document.createElement("select");
      choices.forEach(c => {
        const op = document.createElement("option");
        op.value = String(c.value);
        op.textContent = c.label;
        if (String(c.value) === String(value)) op.selected = true;
        sel.appendChild(op);
      });
      sel.disabled = disabled;
      sel.addEventListener("change", () => onInput(sel.value));
      wrap.appendChild(l);
      wrap.appendChild(sel);
      return wrap;
    }

    function renderInputs() {
      const capEl = document.getElementById("capacityFields");
      const demEl = document.getElementById("demandFields");
      capEl.innerHTML = "";
      demEl.innerHTML = "";

      const s = activeState();
      const editable = appState.currentTab === "sandbox";

      const setAndRefresh = (fn) => {
        if (!editable) return;
        fn();
        persistSandbox();
        recalc();
      };

      capEl.appendChild(buildField("Retorts", "number", s.capacity.retorts, v => setAndRefresh(()=> s.capacity.retorts = clamp(parseInt(v || "0",10), 0, 60)), {min:0, max:60, step:1, disabled:!editable}));
      capEl.appendChild(buildField("Cycles per retort / day", "number", s.capacity.cycles_per_retort_per_day, v => setAndRefresh(()=> s.capacity.cycles_per_retort_per_day = clamp(parseFloat(v || "0"), 0, 10)), {min:0, max:10, step:0.1, disabled:!editable}));
      capEl.appendChild(buildField("Operating days / week", "number", s.capacity.operating_days_per_week, v => setAndRefresh(()=> s.capacity.operating_days_per_week = clamp(parseFloat(v || "0"), 0, 7)), {min:0, max:7, step:1, disabled:!editable}));
      capEl.appendChild(buildSelectField("Staffing factor", s.capacity.staffing_factor, [
        {label:"0.70", value:0.7},
        {label:"0.85", value:0.85},
        {label:"1.00", value:1.0}
      ], v => setAndRefresh(()=> s.capacity.staffing_factor = parseFloat(v)), !editable));
      capEl.appendChild(buildField("Refrigeration slots", "number", s.capacity.refrigeration_slots, v => setAndRefresh(()=> s.capacity.refrigeration_slots = clamp(parseInt(v || "0",10), 0, 999)), {min:0, max:999, step:1, disabled:!editable}));

      demEl.appendChild(buildSelectField("County", appState.currentTab, [
        {label:"Sandbox", value:"sandbox"},
        {label:"Miami-Dade, FL", value:"miami"},
        {label:"Anchorage, AK", value:"anchorage"},
        {label:"Mecklenburg, NC", value:"mecklenburg"}
      ], v => setTab(v), false));
      demEl.appendChild(buildField("Base deaths / year", "number", s.demand.deaths_per_year, v => setAndRefresh(()=> s.demand.deaths_per_year = clamp(parseFloat(v || "0"), 0, 1000000)), {min:0, max:1000000, step:50, disabled:!editable}));
      demEl.appendChild(buildField("Cremation rate", "number", s.demand.cremation_rate, v => setAndRefresh(()=> s.demand.cremation_rate = clamp(parseFloat(v || "0"), 0, 1)), {min:0, max:1, step:0.01, disabled:!editable}));
      demEl.appendChild(buildField("Authorization delay (days)", "number", s.demand.authorization_delay_days, v => setAndRefresh(()=> s.demand.authorization_delay_days = clamp(parseFloat(v || "0"), 0, 15)), {min:0, max:15, step:0.1, disabled:!editable}));
      demEl.appendChild(buildField("Demand surge", "number", s.demand.surge, v => setAndRefresh(()=> s.demand.surge = clamp(parseFloat(v || "0"), 0, 1)), {min:0, max:1, step:0.01, disabled:!editable}));
    }

    function recalc() {
      const s = activeState();
      const proj = runProjection(s, today(), appState.rangeDays);
      renderKPIs(s, proj);
      renderChart(proj);
      renderHeatmap(s);
      renderInputs();
    }

    function setTab(tab) {
      appState.currentTab = tab;
      document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      const s = activeState();
      document.getElementById("title").textContent = tab === "sandbox" ? "Sandbox" : s.location.label;
      document.getElementById("subtitle").textContent = tab === "sandbox"
        ? "Edit capacity and demand assumptions to stress test strain points."
        : "Case study defaults are locked. Copy values into sandbox to tune assumptions.";
      recalc();
    }

    function persistSandbox() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.sandbox));
    }

    function loadSandbox() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) throw new Error("none");
        const parsed = JSON.parse(raw);
        parsed.id = "sandbox";
        parsed.mode = "editable";
        appState.sandbox = parsed;
      } catch (_) {
        appState.sandbox = JSON.parse(JSON.stringify(DEFAULTS.sandbox));
      }
    }
    function resetSandbox() {
      appState.sandbox = JSON.parse(JSON.stringify(DEFAULTS.sandbox));
      persistSandbox();
      if (appState.currentTab !== "sandbox") setTab("sandbox");
      else recalc();
    }

    function init() {
      loadSandbox();

      document.querySelectorAll("#nav button").forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));
      document.getElementById("rangeSel").addEventListener("change", (e) => {
        appState.rangeDays = parseInt(e.target.value, 10);
        recalc();
      });
      document.getElementById("resetBtn").addEventListener("click", resetSandbox);

      setTab("sandbox");
    }

    init();
