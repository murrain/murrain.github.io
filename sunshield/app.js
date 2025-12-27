// SunVault — premium daylight licensing (fictional satire)

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const clamp = (n,a,b) => Math.min(b, Math.max(a,n));
const pad2 = (n) => String(n).padStart(2,"0");
const fmtUSD = (n) => n.toLocaleString(undefined, { style:"currency", currency:"USD" });

// Premium monopoly rates
const PRICE_MIN = 90;   // $/hr
const PRICE_MAX = 320;  // $/hr

// Stable activation timestamp per user
const FIXED_ACTIVATION_ISO = null;

function getActivationDate(){
  if (FIXED_ACTIVATION_ISO) return new Date(FIXED_ACTIVATION_ISO);
  const key = "sunvault_activation_iso";
  const existing = localStorage.getItem(key);
  if (existing) return new Date(existing);

  const hoursFromNow = 36 + Math.floor(Math.random()*18);
  const d = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  localStorage.setItem(key, d.toISOString());
  return d;
}
const activationDate = getActivationDate();

function humanCountdown(ms){
  const neg = ms < 0;
  ms = Math.abs(ms);
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400);
  const h = Math.floor((s%86400)/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  const label = `${d}d ${pad2(h)}h ${pad2(m)}m ${pad2(sec)}s`;
  return neg ? `T+${label}` : `T–${label}`;
}

// region guess for flavor
function guessRegion(){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";
  if (/America\/(Los_Angeles|Tijuana|Vancouver)/.test(tz)) return "West Coast (NA)";
  if (/America\/(Denver|Phoenix)/.test(tz)) return "Mountain (NA)";
  if (/America\/(Chicago|Mexico_City)/.test(tz)) return "Central (NA)";
  if (/America\/(New_York|Toronto)/.test(tz)) return "East (NA)";
  if (/Europe\//.test(tz)) return "EU";
  if (/Asia\//.test(tz)) return "APAC";
  if (/Australia\//.test(tz)) return "AU";
  return tz;
}

// pseudo random stable-ish
const seed = localStorage.getItem("sunvault_seed") || (() => {
  const s = String(Math.floor(Math.random()*1e9));
  localStorage.setItem("sunvault_seed", s);
  return s;
})();

function pseudoRand(t){
  let x = Math.sin(t*0.00017 + Number(seed)*0.000001) * 10000;
  return x - Math.floor(x);
}

let currentPrice = 165;
let congestionPct = 42;

function updateMarket(){
  const now = Date.now();
  const r1 = pseudoRand(now);
  const r2 = pseudoRand(now + 7777);

  const timeToActivation = activationDate.getTime() - now;
  const proximity = clamp(1 - timeToActivation/(72*3600*1000), 0, 1);

  // congestion climbs as activation approaches
  congestionPct = Math.round(clamp(30 + r2*60 + proximity*14, 18, 98));

  const base = PRICE_MIN + r1*(PRICE_MAX-PRICE_MIN);
  const congestionFactor = 1 + (congestionPct - 40)/160;
  const proximityFactor = 1 + proximity*0.55;

  currentPrice = clamp(base * congestionFactor * proximityFactor, PRICE_MIN, PRICE_MAX);

  $("#sunPrice") && ($("#sunPrice").textContent = fmtUSD(currentPrice));
  $("#spotRateBig") && ($("#spotRateBig").textContent = fmtUSD(currentPrice));
  $("#congestion") && ($("#congestion").textContent = `${congestionPct}%`);

  const priceBar = $("#priceBar");
  const congBar = $("#congestionBar");
  if (priceBar) priceBar.style.width = `${Math.round(((currentPrice-PRICE_MIN)/(PRICE_MAX-PRICE_MIN))*100)}%`;
  if (congBar) congBar.style.width = `${congestionPct}%`;

  const indexHint = $("#indexHint");
  if (indexHint) indexHint.textContent = `${fmtUSD(currentPrice)}/hr • congestion ${congestionPct}% • repricing enabled`;

  const mt = $("#menuTelemetry");
  if (mt) mt.textContent = `Spot ${fmtUSD(currentPrice)}/hr • Congestion ${congestionPct}%`;

  // status indicator
  const dot = $("#statusDot");
  const statusText = $("#statusText");
  if (dot && statusText){
    if (congestionPct > 85){
      dot.style.background = "#c47b00";
      statusText.textContent = "Relay: constrained";
    } else if (congestionPct > 68){
      dot.style.background = "#2d6cdf";
      statusText.textContent = "Relay: elevated";
    } else {
      dot.style.background = "#1a8f4d";
      statusText.textContent = "Relay: nominal";
    }
  }

  if ($("#modalBack")?.classList.contains("show")) computeTotal();

  // occasional propaganda
  if (Math.random() < 0.07) {
    const msgs = [
      "Index updated to reflect global need.",
      "Congestion event detected. Priority routing enabled.",
      "Legacy exposure requests are under review.",
      "Safety optimization applied to evening slots.",
      "Unauthorized brightness attempt prevented (Shade Mode).",
      "Allocation fairness review in progress."
    ];
    toast("Program update", msgs[Math.floor(Math.random() * msgs.length)]);
  }
}

function updateCountdown(){
  const now = Date.now();
  const ms = activationDate.getTime() - now;
  const label = humanCountdown(ms);

  $("#countdownInline") && ($("#countdownInline").textContent = label);
  $("#countdownInline2") && ($("#countdownInline2").textContent = label);
  $("#countdownPill") && ($("#countdownPill").textContent = label);
  $("#activationUTC") && ($("#activationUTC").textContent = activationDate.toISOString().replace(".000Z","Z"));
}

// Toast
function toast(title, msg){
  const wrap = $("#toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<b>${escapeHtml(title)}</b><p>${escapeHtml(msg)}</p>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4400);
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// Menu
function openMenu(){
  const menu = $("#menu");
  const btn = $("#menuBtn");
  if (!menu || !btn) return;
  menu.classList.add("show");
  menu.setAttribute("aria-hidden","false");
  btn.setAttribute("aria-expanded","true");
}
function closeMenu(){
  const menu = $("#menu");
  const btn = $("#menuBtn");
  if (!menu || !btn) return;
  menu.classList.remove("show");
  menu.setAttribute("aria-hidden","true");
  btn.setAttribute("aria-expanded","false");
}

// Modal
function openModal(preset){
  const back = $("#modalBack");
  const product = $("#product");
  const hours = $("#hours");
  if (!back || !product || !hours) return;

  if (preset){
    const opt = Array.from(product.options).find(o => o.value === preset);
    if (opt) product.value = preset;
  }
  const selected = product.selectedOptions[0];
  hours.value = Number(selected.dataset.included || 12);

  computeTotal();
  back.classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeModal(){
  const back = $("#modalBack");
  if (!back) return;
  back.classList.remove("show");
  document.body.style.overflow = "";
}

function computeTotal(){
  const product = $("#product");
  const hours = $("#hours");
  const mode = $("#mode");
  const totalEl = $("#total");
  const fine = $("#fineprint");
  if (!product || !hours || !mode || !totalEl || !fine) return;

  const opt = product.selectedOptions[0];
  const base = Number(opt.dataset.base || 0);
  const included = Number(opt.dataset.included || 0);
  const requested = clamp(Number(hours.value || included || 1), 1, 9999);

  const m = mode.value;
  const mult = m === "golden" ? 1.35 : m === "agri" ? 1.18 : 1.0;

  // spot usage is charged for ALL hours requested (simple, scary, believable)
  const usage = requested * currentPrice * mult;
  const total = base + usage;

  totalEl.textContent = fmtUSD(total);

  fine.textContent =
    `${opt.value}: base ${fmtUSD(base)} + ${requested} hrs @ ${fmtUSD(currentPrice)}/hr × ${mult.toFixed(2)} spectrum` +
    ` • repricing may apply at delivery`;
}

// Wiring
function attach(){
  $("#year") && ($("#year").textContent = new Date().getFullYear());
  $("#region") && ($("#region").textContent = guessRegion());

  // menu
  $("#menuBtn")?.addEventListener("click", () => {
    const showing = $("#menu")?.classList.contains("show");
    showing ? closeMenu() : openMenu();
  });
  $("#menuClose")?.addEventListener("click", closeMenu);
  $$(".menuLink").forEach(a => a.addEventListener("click", closeMenu));

  // CTAs
  $("#reserveBtn")?.addEventListener("click", () => openModal("Priority Daylight"));
  $("#reserveBtn2")?.addEventListener("click", () => openModal("Priority Daylight"));
  $("#reserveBtn3")?.addEventListener("click", () => openModal("Priority Daylight"));
  $("#briefBtn")?.addEventListener("click", () => toast("Briefing", "We made the sky measurable. The rest follows."));
  $("#emergencyBtn")?.addEventListener("click", () => openModal("Emergency Sun Pack"));
  $("#emergencyBtn2")?.addEventListener("click", () => openModal("Emergency Sun Pack"));
  

  // pricing cards
  $$(".buyBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      openModal(card?.dataset.plan || "Priority Daylight");
    });
  });

  // modal controls
  $("#modalClose")?.addEventListener("click", closeModal);
  $("#modalBack")?.addEventListener("click", (e) => {
    if (e.target.id === "modalBack") closeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){
      if ($("#menu")?.classList.contains("show")) closeMenu();
      if ($("#modalBack")?.classList.contains("show")) closeModal();
    }
  });

  $("#product")?.addEventListener("change", () => {
    const p = $("#product");
    const hours = $("#hours");
    const mode = $("#mode");
    const opt = p.selectedOptions[0];
    hours.value = Number(opt.dataset.included || 12);
    if (p.value === "Emergency Sun Pack") mode.value = "standard";
    computeTotal();
  });
  $("#hours")?.addEventListener("input", computeTotal);
  $("#mode")?.addEventListener("change", computeTotal);

  $("#confirm")?.addEventListener("click", () => {
    const email = $("#email").value.trim();
    closeModal();
    toast(
      "Request received",
      email
        ? `Verification initiated for ${email}. Allocation will be scheduled.`
        : "Verification pending. Add email to finalize."
    );
    setTimeout(() => toast("Reminder", "Unregulated sunlight is a legacy system."), 1500);
  });

  // opening vibe
  setTimeout(() => toast("System note", "We do not “sell the sun.” We license regulated exposure."), 900);
}

// Start
attach();
updateCountdown();
updateMarket();
computeTotal();

setInterval(updateCountdown, 250);
setInterval(updateMarket, 2200);