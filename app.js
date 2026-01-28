// ---------- Simple local DB ----------
const KEY = "gfp_v1";
const todayKey = () => new Date().toISOString().slice(0,10);

function loadDB(){
  const raw = localStorage.getItem(KEY);
  if(raw) return JSON.parse(raw);
  return {
    settings: { goal: 0, proteinGoal: 0 },
    foods: [],
    Meals: [],
    MealsItems: [], // {id, MealsId, foodId, servings}
    entries: [] // {id, dateKey, type: "food"|"quick", foodId?, servings?, quickCalories?, ts}
  };
}
function saveDB(db){ localStorage.setItem(KEY, JSON.stringify(db)); }

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); }

// ---------- UI Helpers ----------
const $ = (sel) => document.querySelector(sel);

function fmtDate(dateKey){
  const [y,m,d] = dateKey.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
}

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    const panel = $("#tab-"+btn.dataset.tab);
    if(panel) panel.classList.add("active");
    renderAll();
  });
});

// ---------- Modal ----------
function openModal(title, bodyEl){
  $("#modalTitle").textContent = title;
  const body = $("#modalBody");
  body.innerHTML = "";
  body.appendChild(bodyEl);
  $("#modalBackdrop").classList.remove("hidden");
}
function closeModal(){
  stopScanner(); // barcode scanner safety
  $("#modalBackdrop").classList.add("hidden");
}
$("#modalClose").addEventListener("click", closeModal);
$("#modalBackdrop").addEventListener("click", (e)=>{ if(e.target.id==="modalBackdrop") closeModal(); });

// ---------- Rendering ----------
function renderAll(){
  const db = loadDB();
  renderToday(db);
  renderHistory(db);     // NEW (daily log) — only runs if History panel exists
  renderFoods(db);
  renderMeals(db);
  renderSettings(db);
}

function renderToday(db){
  const dk = todayKey();
  if($("#todayDate")) $("#todayDate").textContent = fmtDate(dk);
  if($("#goalDisplay")) $("#goalDisplay").textContent = db.settings.goal ? String(db.settings.goal) : "—";

  const todays = db.entries.filter(e=>e.dateKey===dk).sort((a,b)=>b.ts-a.ts);
  const totals = calcTotals(db, todays);

  if($("#calTotal")) $("#calTotal").textContent = String(totals.calories);
  if($("#pTotal")) $("#pTotal").textContent = `${totals.protein} g`;
  if($("#cTotal")) $("#cTotal").textContent = `${totals.carbs} g`;

  const remaining = Math.max(0, (db.settings.goal||0) - totals.calories);
  if($("#calRemaining")) $("#calRemaining").textContent = db.settings.goal ? String(remaining) : "—";

  const pRem = Math.max(0, (db.settings.proteinGoal || 0) - totals.protein);
  if($("#pRemaining")) $("#pRemaining").textContent = db.settings.proteinGoal ? `${pRem} g` : "—";

  const list = $("#entriesList");
  if(!list) return;

  list.innerHTML = "";
  if($("#emptyEntries")) $("#emptyEntries").style.display = todays.length ? "none" : "block";

  todays.forEach(e=>{
    const el = document.createElement("div");
    el.className = "item";

    let title = "";
    let sub = "";
    let cal = 0;

    if(e.type==="quick"){
      title = "Quick Add";
      sub = "Manual calories";
      cal = e.quickCalories || 0;
    } else {
      const food = db.foods.find(f=>f.id===e.foodId);
      title = food ? food.name : "Unknown food";
      const servings = e.servings ?? 1;
      sub = `${servings} × ${food?.servingLabel || "serving"}`;
      cal = Math.round((food?.caloriesPerServing || 0) * servings);
    }

    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="right">
        <div class="title">${cal} cal</div>
        <div class="sub"><button class="ghost" data-del="${e.id}">Delete</button></div>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-del");
      const db2 = loadDB();
      db2.entries = db2.entries.filter(x=>x.id!==id);
      saveDB(db2);
      renderAll();
    });
  });
}

function renderFoods(db){
  const searchEl = $("#foodSearch");
  const q = (searchEl ? (searchEl.value || "") : "").toLowerCase().trim();

  const foods = db.foods
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const list = $("#foodsList");
  if(!list) return;

  list.innerHTML = "";
  if($("#emptyFoods")) $("#emptyFoods").style.display = db.foods.length ? "none" : "block";

  foods.forEach(f=>{
    const el = document.createElement("div");
    el.className = "item";
    const carbs = (f.carbsPerServing ?? 0);
    const protein = (f.proteinPerServing ?? 0);

    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(f.name)}</div>
        <div class="sub">
          ${f.caloriesPerServing} cal • P ${protein}g • C ${carbs}g
          per ${escapeHtml(f.servingLabel || "serving")}
        </div>
      </div>
      <div class="right">
        <button data-add="${f.id}">Add</button>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const foodId = btn.getAttribute("data-add");
      openAddToTodayModal(foodId);
    });
  });
}

function renderMeals(db){
  const list = $("#MealsList");
  if(!list) return;

  list.innerHTML = "";
  if($("#emptyMeals")) $("#emptyMeals").style.display = db.Meals.length ? "none" : "block";

  db.Meals.forEach(t=>{
    const items = db.MealsItems.filter(i=>i.MealsId===t.id);
    const cal = Math.round(items.reduce((sum, it)=>{
      const food = db.foods.find(f=>f.id===it.foodId);
      return sum + (food?.caloriesPerServing||0) * (it.servings||1);
    }, 0));

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(t.name)}</div>
        <div class="sub">${items.length} items • ~${cal} cal</div>
      </div>
      <div class="right">
        <button data-use="${t.id}">Add to Today</button>
        <button class="ghost" data-edit="${t.id}">Edit</button>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-use]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const MealsId = btn.getAttribute("data-use");
      const db2 = loadDB();
      const dk = todayKey();
      const items = db2.MealsItems.filter(i=>i.MealsId===MealsId);

      items.forEach(it=>{
        db2.entries.push({
          id: uid(),
          dateKey: dk,
          type: "food",
          foodId: it.foodId,
          servings: it.servings || 1,
          ts: Date.now()
        });
      });
      saveDB(db2);
      // switch to Today tab
      const todayTab = document.querySelector('[data-tab="today"]');
      if(todayTab) todayTab.click();
    });
  });

  list.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const MealsId = btn.getAttribute("data-edit");
      openEditMealsModal(MealsId);
    });
  });
}

function renderSettings(db){
  if($("#goalInput")) $("#goalInput").value = db.settings.goal || "";
  if($("#proteinGoalInput")) $("#proteinGoalInput").value = db.settings.proteinGoal || "";
}

// ---------- NEW: History (daily totals) ----------
function renderHistory(db){
  const list = $("#historyList");
  const empty = $("#emptyHistory");
  if(!list || !empty) return; // only if you add the History panel in index.html

  list.innerHTML = "";

  const dateKeys = [...new Set(db.entries.map(e => e.dateKey))].sort((a,b)=>b.localeCompare(a));
  empty.style.display = dateKeys.length ? "none" : "block";

  dateKeys.forEach(dk=>{
    const dayEntries = db.entries.filter(e=>e.dateKey===dk);
    const totals = calcTotals(db, dayEntries);

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(fmtDate(dk))}</div>
        <div class="sub">${totals.calories} cal • P ${totals.protein}g • C ${totals.carbs}g</div>
      </div>
      <div class="right">
        <button data-open="${dk}">Open</button>
      </div>
    `;
    list.appendChild(el);
  });

  list.querySelectorAll("[data-open]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const dk = btn.getAttribute("data-open");
      openDayModal(dk);
    });
  });
}

function openDayModal(dateKey){
  const db = loadDB();
  const dayEntries = db.entries.filter(e=>e.dateKey===dateKey).sort((a,b)=>b.ts-a.ts);
  const totals = calcTotals(db, dayEntries);

  const wrap = document.createElement("div");

  const header = document.createElement("div");
  header.className = "muted small";
  header.style.marginBottom = "10px";
  header.textContent = `${totals.calories} cal • P ${totals.protein}g • C ${totals.carbs}g`;
  wrap.appendChild(header);

  const list = document.createElement("div");
  list.className = "list";
  wrap.appendChild(list);

  dayEntries.forEach(e=>{
    const el = document.createElement("div");
    el.className = "item";

    let title = "";
    let sub = "";
    let cal = 0;

    if(e.type==="quick"){
      title = "Quick Add";
      sub = "Manual calories";
      cal = e.quickCalories || 0;
    } else {
      const food = db.foods.find(f=>f.id===e.foodId);
      const s = e.servings ?? 1;
      title = food ? food.name : "Unknown food";
      sub = `${s} × ${food?.servingLabel || "serving"}`;
      cal = Math.round((food?.caloriesPerServing || 0) * s);
    }

    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      <div class="right">
        <div class="title">${cal} cal</div>
      </div>
    `;
    list.appendChild(el);
  });

  openModal(fmtDate(dateKey), wrap);
}

// ---------- Calculations ----------
function calcTotals(db, entries){
  let calories = 0;
  let protein = 0;
  let carbs = 0;

  for(const e of entries){
    if(e.type==="quick"){
      calories += (e.quickCalories || 0);
    } else {
      const food = db.foods.find(f=>f.id===e.foodId);
      const s = (e.servings || 1);
      calories += (food?.caloriesPerServing || 0) * s;
      protein += (food?.proteinPerServing || 0) * s;
      carbs   += (food?.carbsPerServing || 0) * s;
    }
  }

  return {
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs:   Math.round(carbs * 10) / 10
  };
}

// ---------- Actions ----------
if($("#foodSearch")) $("#foodSearch").addEventListener("input", renderAll);

if($("#btnSaveSettings")){
  $("#btnSaveSettings").addEventListener("click", ()=>{
    const db = loadDB();

    const calGoal = parseInt($("#goalInput")?.value || "0", 10);
    db.settings.goal = Number.isFinite(calGoal) ? Math.max(0, calGoal) : 0;

    const pGoal = parseInt($("#proteinGoalInput")?.value || "0", 10);
    db.settings.proteinGoal = Number.isFinite(pGoal) ? Math.max(0, pGoal) : 0;

    saveDB(db);
    renderAll();
  });
}

if($("#btnReset")){
  $("#btnReset").addEventListener("click", ()=>{
    if(confirm("Delete all data on this device?")){
      localStorage.removeItem(KEY);
      renderAll();
    }
  });
}

if($("#btnNewFood")) $("#btnNewFood").addEventListener("click", openNewFoodModal);
if($("#btnAddFoodToToday")) $("#btnAddFoodToToday").addEventListener("click", ()=> openPickFoodModal("Add Food"));
if($("#btnQuickAdd")) $("#btnQuickAdd").addEventListener("click", openQuickAddModal);
if($("#btnNewMeals")) $("#btnNewMeals").addEventListener("click", openNewMealsModal);
if($("#btnAddMealsToToday")) $("#btnAddMealsToToday").addEventListener("click", openPickMealsModal);

// NEW: barcode scan button (only works if you add <button id="btnScanBarcode">)
if($("#btnScanBarcode")) $("#btnScanBarcode").addEventListener("click", openScanBarcodeModal);

// ---------- Modals ----------
function openNewFoodModal(){
  const wrap = document.createElement("div");

  wrap.innerHTML = `
    <label class="field"><span>Name</span><input class="input" id="f_name" placeholder="e.g., Chicken thighs"/></label>

    <label class="field"><span>Calories per serving</span>
      <input class="input" id="f_cal" type="number" min="0" step="1" placeholder="e.g., 150"/>
    </label>

    <label class="field"><span>Protein (g) per serving</span>
      <input class="input" id="f_p" type="number" min="0" step="0.1" placeholder="e.g., 25"/>
    </label>

    <label class="field"><span>Carbs (g) per serving</span>
      <input class="input" id="f_c" type="number" min="0" step="0.1" placeholder="e.g., 30"/>
    </label>

    <label class="field"><span>Serving label</span>
      <input class="input" id="f_label" placeholder="e.g., 1 thigh, 100g, 1 scoop"/>
    </label>

    <div class="actions" style="margin-top:12px;">
      <button id="f_save">Save</button>
      <button class="ghost" id="f_cancel">Cancel</button>
    </div>
  `;

  wrap.querySelector("#f_cancel").addEventListener("click", closeModal);
  wrap.querySelector("#f_save").addEventListener("click", ()=>{
    const name = wrap.querySelector("#f_name").value.trim();
    const cal = parseInt(wrap.querySelector("#f_cal").value || "0", 10);
    const p = parseFloat(wrap.querySelector("#f_p").value || "0");
    const c = parseFloat(wrap.querySelector("#f_c").value || "0");
    const label = wrap.querySelector("#f_label").value.trim() || "serving";

    if(!name) return alert("Food name is required.");

    const db = loadDB();
    db.foods.push({
      id: uid(),
      name,
      caloriesPerServing: Math.max(0, cal||0),
      proteinPerServing: Math.max(0, Number.isFinite(p) ? p : 0),
      carbsPerServing: Math.max(0, Number.isFinite(c) ? c : 0),
      servingLabel: label
    });

    saveDB(db);
    closeModal();
    renderAll();
  });

  openModal("New Food", wrap);
}

function openPickFoodModal(title){
  const db = loadDB();
  const wrap = document.createElement("div");

  const select = document.createElement("select");
  select.className = "input";
  db.foods.sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.name} (${f.caloriesPerServing} cal, P ${f.proteinPerServing||0}g, C ${f.carbsPerServing||0}g / ${f.servingLabel||"serving"})`;
    select.appendChild(opt);
  });

  const servings = document.createElement("input");
  servings.className = "input";
  servings.type = "number";
  servings.min = "0";
  servings.step = "0.25";
  servings.value = "1";

  wrap.appendChild(labelWrap("Food", select));
  wrap.appendChild(labelWrap("Servings", servings));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    if(db.foods.length===0) return alert("Add a food first.");
    const db2 = loadDB();
    db2.entries.push({
      id: uid(),
      dateKey: todayKey(),
      type: "food",
      foodId: select.value,
      servings: Math.max(0, parseFloat(servings.value||"1")),
      ts: Date.now()
    });
    saveDB(db2);
    closeModal();
    renderAll();
  });

  openModal(title, wrap);
}

function openAddToTodayModal(foodId){
  const db = loadDB();
  const food = db.foods.find(f=>f.id===foodId);
  if(!food) return;

  const wrap = document.createElement("div");
  const servings = document.createElement("input");
  servings.className = "input";
  servings.type = "number";
  servings.min = "0";
  servings.step = "0.25";
  servings.value = "1";

  wrap.appendChild(document.createTextNode(
    `${food.name} (${food.caloriesPerServing} cal • P ${food.proteinPerServing||0}g • C ${food.carbsPerServing||0}g per ${food.servingLabel})`
  ));
  wrap.appendChild(document.createElement("div")).style.height="10px";
  wrap.appendChild(labelWrap("Servings", servings));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    const db2 = loadDB();
    db2.entries.push({
      id: uid(),
      dateKey: todayKey(),
      type: "food",
      foodId,
      servings: Math.max(0, parseFloat(servings.value||"1")),
      ts: Date.now()
    });
    saveDB(db2);
    closeModal();
    renderAll();
  });

  openModal("Add to Today", wrap);
}

function openQuickAddModal(){
  const wrap = document.createElement("div");
  const cal = document.createElement("input");
  cal.className = "input";
  cal.type = "number";
  cal.min = "0";
  cal.step = "1";
  cal.placeholder = "e.g., 300";

  wrap.appendChild(labelWrap("Calories", cal));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    const v = parseInt(cal.value || "0", 10);
    if(!Number.isFinite(v) || v<=0) return alert("Enter calories > 0");
    const db = loadDB();
    db.entries.push({ id: uid(), dateKey: todayKey(), type:"quick", quickCalories: v, ts: Date.now() });
    saveDB(db);
    closeModal();
    renderAll();
  });

  openModal("Quick Add", wrap);
}

function openNewMealsModal(){
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <label class="field"><span>Meals name</span><input class="input" id="t_name" placeholder="e.g., Breakfast"/></label>
    <div class="actions" style="margin-top:12px;">
      <button id="t_save">Create</button>
      <button class="ghost" id="t_cancel">Cancel</button>
    </div>
  `;
  wrap.querySelector("#t_cancel").addEventListener("click", closeModal);
  wrap.querySelector("#t_save").addEventListener("click", ()=>{
    const name = wrap.querySelector("#t_name").value.trim();
    if(!name) return alert("Name required.");
    const db = loadDB();
    db.Meals.push({ id: uid(), name });
    saveDB(db);
    closeModal();
    renderAll();
  });
  openModal("New Meal", wrap);
}

function openEditMealodal(MealsId){
  const db = loadDB();
  const t = db.Meals.find(x=>x.id===mealsId);
  if(!t) return;

  const wrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "muted";
  title.textContent = "Add foods to this Meals:";
  wrap.appendChild(title);

  // picker
  const select = document.createElement("select");
  select.className = "input";
  db.foods.sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `${f.name} (${f.caloriesPerServing} cal/${f.servingLabel||"serving"})`;
    select.appendChild(opt);
  });
  const servings = document.createElement("input");
  servings.className = "input";
  servings.type = "number";
  servings.min = "0";
  servings.step = "0.25";
  servings.value = "1";

  wrap.appendChild(labelWrap("Food", select));
  wrap.appendChild(labelWrap("Servings", servings));

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add item";
  addBtn.style.marginTop = "10px";
  wrap.appendChild(addBtn);

  const list = document.createElement("div");
  list.className = "list";
  wrap.appendChild(list);

  function redraw(){
    const db2 = loadDB();
    const items = db2.MealsItems.filter(i=>i.MealsId===MealsId);
    list.innerHTML = "";
    items.forEach(it=>{
      const food = db2.foods.find(f=>f.id===it.foodId);
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div>
          <div class="title">${escapeHtml(food?.name || "Unknown")}</div>
          <div class="sub">${it.servings} × ${escapeHtml(food?.servingLabel || "serving")}</div>
        </div>
        <div class="right">
          <button class="ghost" data-del="${it.id}">Delete</button>
        </div>
      `;
      list.appendChild(el);
    });

    list.querySelectorAll("[data-del]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-del");
        const db3 = loadDB();
        db3.MealsItems = db3.MealsItems.filter(x=>x.id!==id);
        saveDB(db3);
        redraw();
        renderAll();
      });
    });
  }

  addBtn.addEventListener("click", ()=>{
    const db2 = loadDB();
    if(db2.foods.length===0) return alert("Add foods first.");
    db2.MealsItems.push({
      id: uid(),
      MealsId,
      foodId: select.value,
      servings: Math.max(0, parseFloat(servings.value||"1"))
    });
    saveDB(db2);
    redraw();
    renderAll();
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button class="ghost" id="done">Done</button>`;
  wrap.appendChild(actions);
  actions.querySelector("#done").addEventListener("click", closeModal);

  redraw();
  openModal(`Edit: ${t.name}`, wrap);
}

function openPickMealsModal(){
  const db = loadDB();
  if(db.Meals.length===0) return alert("Create a Meal first.");

  const wrap = document.createElement("div");
  const select = document.createElement("select");
  select.className = "input";
  db.Meals.forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  });

  wrap.appendChild(labelWrap("Meals", select));

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.innerHTML = `<button id="ok">Add to Today</button><button class="ghost" id="cancel">Cancel</button>`;
  wrap.appendChild(actions);

  actions.querySelector("#cancel").addEventListener("click", closeModal);
  actions.querySelector("#ok").addEventListener("click", ()=>{
    const MealsId = select.value;
    const db2 = loadDB();
    const items = db2.MealsItems.filter(i=>i.MealsId===MealsId);
    items.forEach(it=>{
      db2.entries.push({ id: uid(), dateKey: todayKey(), type:"food", foodId: it.foodId, servings: it.servings || 1, ts: Date.now() });
    });
    saveDB(db2);
    closeModal();
    renderAll();
  });

  openModal("Add Meals", wrap);
}

// ---------- Barcode scanning + Open Food Facts (FREE) ----------
// IMPORTANT: in index.html you must add:
// <script src="https://unpkg.com/html5-qrcode"></script> BEFORE app.js
let html5Qr = null;

function openScanBarcodeModal(){
  if(typeof Html5Qrcode === "undefined"){
    alert("Scanner library not loaded. Add html5-qrcode script tag in index.html.");
    return;
  }

  const wrap = document.createElement("div");

  const cam = document.createElement("div");
  cam.id = "qr-reader";
  cam.style.width = "100%";
  cam.style.borderRadius = "12px";
  cam.style.overflow = "hidden";

  const status = document.createElement("div");
  status.className = "muted small";
  status.style.marginTop = "10px";
  status.textContent = "Point your camera at a barcode…";

  const manual = document.createElement("input");
  manual.className = "input";
  manual.placeholder = "Or type barcode (UPC/EAN)…";
  manual.inputMode = "numeric";
  manual.autocomplete = "off";

  const btnLookup = document.createElement("button");
  btnLookup.textContent = "Lookup barcode";
  btnLookup.addEventListener("click", async ()=>{
    const code = (manual.value || "").trim();
    if(!code) return alert("Enter a barcode first.");
    await handleBarcode(code, status);
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.style.marginTop = "12px";
  actions.appendChild(btnLookup);

  wrap.appendChild(cam);
  wrap.appendChild(status);
  wrap.appendChild(manual);
  wrap.appendChild(actions);

  openModal("Scan Barcode", wrap);

  startScanner(status).catch(err=>{
    console.error(err);
    status.textContent = "Could not start camera. You can type the barcode manually below.";
  });
}

async function startScanner(statusEl){
  await stopScanner();

  html5Qr = new Html5Qrcode("qr-reader");
  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  const onScanSuccess = async (decodedText) => {
    const code = String(decodedText).replace(/[^\d]/g, "");
    if(!code) return;
    await handleBarcode(code, statusEl);
  };
  const onScanFailure = () => {};

  await html5Qr.start({ facingMode: "environment" }, config, onScanSuccess, onScanFailure);
  statusEl.textContent = "Scanning…";
}

async function stopScanner(){
  try{
    if(html5Qr){
      await html5Qr.stop().catch(()=>{});
      await html5Qr.clear().catch(()=>{});
    }
  } finally {
    html5Qr = null;
  }
}

async function handleBarcode(code, statusEl){
  statusEl.textContent = `Looking up ${code}…`;
  try{
    const product = await fetchOpenFoodFacts(code);
    if(!product){
      statusEl.textContent = "Not found in Open Food Facts. Add it manually in Foods.";
      alert("Product not found. You can create it manually.");
      return;
    }

    await stopScanner(); // stop camera once we have a hit
    openPrefilledFoodModalFromOFF(product);
    closeModal(); // closes scan modal (also calls stopScanner safely)
  } catch (e){
    console.error(e);
    statusEl.textContent = "Lookup failed. Try again.";
    alert("Lookup failed. Try again.");
  }
}

async function fetchOpenFoodFacts(barcode){
  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error("OFF request failed");
  const data = await res.json();
  if(data.status !== 1) return null;
  return data.product || null;
}

function mapOFFNutrition(product){
  const name =
    product.product_name ||
    product.abbreviated_product_name ||
    product.generic_name ||
    "Scanned product";

  const n = product.nutriments || {};
  const caloriesPer100g = num(n["energy-kcal_100g"] ?? n["energy-kcal"] ?? 0);
  const proteinPer100g  = num(n["proteins_100g"] ?? n["proteins"] ?? 0);
  const carbsPer100g    = num(n["carbohydrates_100g"] ?? n["carbohydrates"] ?? 0);

  const servingSize = product.serving_size || "";
  return {
    name,
    caloriesPerServing: Math.round(caloriesPer100g),
    proteinPerServing: round1(proteinPer100g),
    carbsPerServing: round1(carbsPer100g),
    servingLabel: servingSize ? `100g (serving: ${servingSize})` : "100g"
  };
}
function num(x){
  const v = parseFloat(String(x).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}
function round1(v){ return Math.round(v * 10) / 10; }

function openPrefilledFoodModalFromOFF(product){
  const mapped = mapOFFNutrition(product);

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p class="muted small">Auto-filled from Open Food Facts (usually per 100g). Adjust if needed.</p>

    <label class="field"><span>Name</span>
      <input class="input" id="pf_name" />
    </label>

    <label class="field"><span>Calories per serving</span>
      <input class="input" id="pf_cal" type="number" min="0" step="1" />
    </label>

    <label class="field"><span>Protein (g) per serving</span>
      <input class="input" id="pf_p" type="number" min="0" step="0.1" />
    </label>

    <label class="field"><span>Carbs (g) per serving</span>
      <input class="input" id="pf_c" type="number" min="0" step="0.1" />
    </label>

    <label class="field"><span>Serving label</span>
      <input class="input" id="pf_label" />
    </label>

    <div class="actions" style="margin-top:12px;">
      <button id="pf_save">Save Food</button>
      <button class="ghost" id="pf_cancel">Cancel</button>
    </div>
  `;

  wrap.querySelector("#pf_name").value = mapped.name;
  wrap.querySelector("#pf_cal").value = mapped.caloriesPerServing;
  wrap.querySelector("#pf_p").value = mapped.proteinPerServing;
  wrap.querySelector("#pf_c").value = mapped.carbsPerServing;
  wrap.querySelector("#pf_label").value = mapped.servingLabel;

  wrap.querySelector("#pf_cancel").addEventListener("click", closeModal);

  wrap.querySelector("#pf_save").addEventListener("click", ()=>{
    const name = wrap.querySelector("#pf_name").value.trim();
    if(!name) return alert("Name required.");

    const cal = parseInt(wrap.querySelector("#pf_cal").value || "0", 10);
    const p   = parseFloat(wrap.querySelector("#pf_p").value || "0");
    const c   = parseFloat(wrap.querySelector("#pf_c").value || "0");
    const label = wrap.querySelector("#pf_label").value.trim() || "serving";

    const db = loadDB();
    db.foods.push({
      id: uid(),
      name,
      caloriesPerServing: Math.max(0, Number.isFinite(cal) ? cal : 0),
      proteinPerServing: Math.max(0, Number.isFinite(p) ? p : 0),
      carbsPerServing: Math.max(0, Number.isFinite(c) ? c : 0),
      servingLabel: label
    });
    saveDB(db);
    closeModal();
    renderAll();
  });

  openModal("Save scanned food", wrap);
}

// ---------- Utils ----------
function labelWrap(label, inputEl){
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(inputEl);
  return wrap;
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// Initial render
renderAll();
