const API = "/api";
const STATIC_MODE = location.hostname.endsWith(".github.io") || location.protocol === "file:";

function staticStore() {
  try { return JSON.parse(localStorage.getItem("datavision-static") || '{"datasets":[],"jobs":{}}'); }
  catch { return {datasets:[],jobs:{}}; }
}
function saveStaticStore(store) { localStorage.setItem("datavision-static", JSON.stringify(store)); }

function staticCsvProfile(text) {
  const lines = text.replace(/^\\uFEFF/, "").split(/\\r?\\n/).filter(Boolean);
  const first = (lines[0] || "").split(",").map(s => s.trim().replace(/^"|"$/g,""));
  const sample = lines.slice(1, Math.min(lines.length, 501)).map(line => {
    const parts=[]; let cur=""; let quoted=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch === '"' && line[i+1] === '"'){cur+='"';i++;continue;}
      if(ch === '"'){quoted=!quoted;continue;}
      if(ch === "," && !quoted){parts.push(cur);cur="";continue;}
      cur+=ch;
    }
    parts.push(cur);
    return parts;
  });
  const columns=first.length;
  const rows=Math.max(0,lines.length-1);
  const missing=Array(columns).fill(0);
  const numeric=Array(columns).fill(true);
  const sums=Array(columns).fill(0), counts=Array(columns).fill(0);
  sample.forEach(row => {
    for(let i=0;i<columns;i++){
      const v=(row[i] ?? "").trim();
      if(v==="") missing[i]++;
      const n=Number(v);
      if(v!=="" && Number.isNaN(n)) numeric[i]=false;
      if(v!=="" && !Number.isNaN(n)){sums[i]+=n;counts[i]++;}
    }
  });
  const numerical_columns=[], categorical_columns=[];
  const columnProfiles=first.map((name,i)=>{
    if(numeric[i]) numerical_columns.push(name); else categorical_columns.push(name);
    return {name,dtype:numeric[i]?"float64":"object",non_null:Math.max(0,sample.length-missing[i]),missing:missing[i],missing_pct:sample.length?Number((missing[i]/sample.length*100).toFixed(2)):0,unique:sample.map(r=>r[i]??"").filter(v=>v!=="").filter((v,j,a)=>a.indexOf(v)===j).length,stats:numeric[i]?{mean:counts[i]?Number((sums[i]/counts[i]).toFixed(4)):null}:undefined};
  });
  const profile={shape:{rows,columns},memory_mb:0,missing_total:missing.reduce((a,b)=>a+b,0),duplicate_rows:0,numerical_columns,categorical_columns,identifier_candidates:[],high_cardinality:[],constant_columns:[],missing_alerts:[],columns:columnProfiles,correlations:{columns:[],matrix:[]}};
  profile.missing_alerts=columnProfiles.filter(x=>x.missing_pct>0).map(x=>({column:x.name,percentage:x.missing_pct,severity:x.missing_pct>=50?"high":x.missing_pct>=10?"medium":"low"}));
  return profile;
}
function staticInsights(profile){
  const out=[];
  if(profile.shape.rows<100) out.push("Small dataset detected; model validation may be sensitive to the train/test split.");
  else if(profile.shape.rows>=10000) out.push("Large dataset detected; asynchronous computation is recommended.");
  out.push(profile.missing_total ? profile.missing_total.toLocaleString()+" missing values need attention before high-confidence modeling." : "No missing values were detected across the dataset.");
  if(profile.constant_columns.length) out.push("Constant columns carry no predictive information and are candidates for removal.");
  out.push("Automated profile is running locally in GitHub Pages demo mode.");
  out.push("The hosted workspace keeps data in this browser only; the production FastAPI service remains available for full ML execution.");
  return out;
}
async function staticApi(url, options) {
  const store=staticStore();
  if(url==="/datasets") return {datasets:store.datasets};
  if(url==="/datasets/upload"){
    const file=options && options.body && options.body.get ? options.body.get("file") : null;
    if(!file) throw new Error("Choose a file.");
    let profile;\n    if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {\n      if (!window.XLSX) throw new Error("Excel parser is unavailable. Please upload CSV.");\n      const book=XLSX.read(await file.arrayBuffer(),{type:"array"});\n      const first=book.Sheets[book.SheetNames[0]];\n      const csv=XLSX.utils.sheet_to_csv(first);\n      profile=staticCsvProfile(csv);\n    } else {\n      profile=staticCsvProfile(await file.text());\n    }
    const id=Date.now();
    const d={id,name:file.name.replace(/\\.[^.]+$/,""),original_name:file.name,rows:profile.shape.rows,columns:profile.shape.columns,size_bytes:file.size,created_at:new Date().toISOString(),target:null,problem_type:null,model_path:null,model_name:null,metrics:null,insights:staticInsights(profile),profile};
    store.datasets.unshift(d); saveStaticStore(store);
    return {id,dataset:{...d}};
  }
  const detail=url.match(/^\\/datasets\\/(\\d+)$/);
  if(detail){
    const id=Number(detail[1]); const d=store.datasets.find(x=>x.id===id);
    if(!d) throw new Error("Dataset not found.");
    if(options && options.method==="DELETE"){store.datasets=store.datasets.filter(x=>x.id!==id);saveStaticStore(store);return {success:true};}
    return {dataset:d,profile:d.profile||staticCsvProfile(""),insights:d.insights||[]};
  }
  const train=url.match(/^\\/datasets\\/(\\d+)\\/train\\?target=(.+)$/);
  if(train){
    const id=Number(train[1]); const target=decodeURIComponent(train[2]); const jobId="demo-"+Date.now();
    store.jobs[jobId]={id:jobId,dataset_id:id,status:"running",progress:18,message:"Profiling target and preparing pipelines",readyAt:Date.now()+3200,target};
    saveStaticStore(store); return {job_id:jobId,status:"queued"};
  }
  const job=url.match(/^\\/jobs\\/(.+)$/);
  if(job){
    const j=store.jobs[job[1]]; if(!j) throw new Error("Job not found.");
    if(j.status==="running" && Date.now()>=j.readyAt){
      const d=store.datasets.find(x=>x.id===j.dataset_id);
      if(d){
        d.target=j.target; d.problem_type="classification"; d.model_name="Extra Trees"; d.model_path="browser://demo-model";
        d.metrics={best:{accuracy:.91,f1:.90},benchmark:[{model:"Extra Trees",score:.90,metrics:{accuracy:.91,f1:.90}},{model:"Random Forest",score:.87,metrics:{accuracy:.88,f1:.87}},{model:"Logistic Regression",score:.83,metrics:{accuracy:.84,f1:.83}}]};
      }
      j.status="complete"; j.progress=100; j.message="Best model: Extra Trees"; saveStaticStore(store);
    } else if(j.status==="running"){
      j.progress=Math.min(92,18+Math.floor((Date.now()-(j.readyAt-3200))/40)); j.message="Training candidate pipelines";
      saveStaticStore(store);
    }
    return j;
  }
  const imp=url.match(/^\\/datasets\\/(\\d+)\\/importance$/);
  if(imp){
    const d=store.datasets.find(x=>x.id===Number(imp[1])); if(!d) throw new Error("Dataset not found.");
    const cols=(d.profile?.numerical_columns||[]).concat(d.profile?.categorical_columns||[]).slice(0,10);
    return {feature_importance:cols.map((feature,i)=>({feature,importance:Number((1/(i+1)).toFixed(6))}))};
  }
  const pred=url.match(/^\\/datasets\\/(\\d+)\\/predict$/);
  if(pred){
    const d=store.datasets.find(x=>x.id===Number(pred[1])); if(!d || !d.model_name) throw new Error("Train a model for this dataset first.");
    return {prediction:"Demo prediction",confidence:.91};
  }
  throw new Error("This hosted static demo does not execute that backend endpoint.");
}

let selectedDataset = null;
let latestModel = null;

const $ = (id) => document.getElementById(id);
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function showToast(message, type) {
  type = type || "info";
  const el = $("toast");
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}
function showView(view) {
  document.querySelectorAll(".nav").forEach(function(n){ n.classList.toggle("active", n.dataset.view === view); });
  document.querySelectorAll(".view").forEach(function(v){ v.classList.toggle("active", v.id === "view-" + view); });
  const titles = {overview:"Operational overview",datasets:"Datasets & intelligence",models:"Models, signals & prediction",stream:"Realtime system events"};
  $("pageTitle").textContent = titles[view] || "DataVision Intelligence";
}
window.showView = showView;

document.querySelectorAll(".nav").forEach(function(n){ n.addEventListener("click", function(){ showView(n.dataset.view); }); });
$("refreshBtn").addEventListener("click", refreshAll);
$("uploadBtn").addEventListener("click", function(){ $("fileInput").click(); });
$("fileInput").addEventListener("change", function(e){ if(e.target.files[0]) uploadFile(e.target.files[0]); });

const dropzone = $("dropzone");
["dragenter","dragover"].forEach(function(evt){ dropzone.addEventListener(evt, function(e){e.preventDefault();dropzone.classList.add("drag");});});
["dragleave","drop"].forEach(function(evt){ dropzone.addEventListener(evt, function(e){e.preventDefault();dropzone.classList.remove("drag");});});
dropzone.addEventListener("drop", function(e){ if(e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
dropzone.addEventListener("click", function(){ $("fileInput").click(); });

async function getJson(url, options) {
  if (STATIC_MODE) return staticApi(url, options);
  const res = await fetch(API + url, options);
  const data = await res.json().catch(function(){ return {}; });
  if(!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}
async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  showToast("Ingesting " + file.name + "…");
  try {
    const data = await getJson("/datasets/upload", {method:"POST", body:fd});
    selectedDataset = data.id;
    await refreshAll();
    await selectDataset(data.id);
    showView("datasets");
    showToast("Dataset ingested and profiled", "success");
  } catch(e){ showToast(e.message,"error"); }
}
async function refreshAll() {
  try {
    const data = await getJson("/datasets");
    const list = data.datasets || [];
    renderMetrics(list);
    renderDatasetList(list);
    renderLatest(list);
    if(selectedDataset) await selectDataset(selectedDataset, true);
  } catch(e){ showToast(e.message,"error"); }
}
function renderMetrics(list) {
  const totalRows = list.reduce(function(s,d){ return s + (d.rows || 0); },0);
  const trained = list.filter(function(d){ return d.model_name; }).length;
  const events = document.querySelectorAll(".feed-item").length;
  const cards = [["DATASETS",list.length,"persistent"],["ROWS INGESTED",totalRows.toLocaleString(),"across all datasets"],["MODELS READY",trained,trained ? "predictive assets" : "train a model"],["LIVE EVENTS",events,"this session"]];
  $("metrics").innerHTML = cards.map(function(x){ return '<div class="metric"><div class="eyebrow">'+x[0]+'</div><strong>'+escapeHtml(x[1])+'</strong><span>'+escapeHtml(x[2])+'</span></div>'; }).join("");
}
function renderDatasetList(list) {
  if(!list.length){ $("datasetList").innerHTML='<div class="signal-empty">No datasets yet. Use the ingest control to begin.</div>'; return; }
  $("datasetList").innerHTML = list.map(function(d){
    return '<button class="dataset-row '+(d.id===selectedDataset?"selected":"")+'" onclick="selectDataset('+d.id+')"><span class="dataset-icon">▦</span><span class="dataset-main"><strong>'+escapeHtml(d.name)+'</strong><span>'+d.rows.toLocaleString()+' rows · '+d.columns+' cols</span></span><span class="dataset-status">'+(d.model_name?"MODEL READY":"PROFILED")+'</span></button>';
  }).join("");
}
async function selectDataset(id, silent) {
  selectedDataset = Number(id);
  if(!silent) showView("datasets");
  try{
    const data = await getJson("/datasets/"+id);
    renderProfile(data);
    const list = (await getJson("/datasets")).datasets || [];
    renderDatasetList(list);
    prepareTarget(data.profile.columns || []);
    if(data.dataset.model_path){
      latestModel = data.dataset;
      renderModelSummary(data.dataset);
      await loadImportance(id);
      await loadPredictionFields(id);
    }else{
      latestModel = null;
      $("modelTable").innerHTML='<div class="signal-empty">No trained model yet.</div>';
      $("importance").innerHTML='<div class="signal-empty">Train a model to activate explainability.</div>';
      $("predictPanel").hidden=true;
      $("modelReadiness").innerHTML='<div class="signal-empty">Train a model from the Data Workbench.</div>';
    }
  }catch(e){ if(!silent) showToast(e.message,"error"); }
}
window.selectDataset = selectDataset;

function renderProfile(data){
  const p=data.profile;
  $("analysisPanel").hidden=false;
  $("analysisTitle").textContent=data.dataset.name+" · intelligence profile";
  const items=[["ROWS",p.shape.rows.toLocaleString()],["COLUMNS",p.shape.columns],["MISSING",p.missing_total.toLocaleString()],["DUPLICATES",p.duplicate_rows.toLocaleString()],["NUMERIC",p.numerical_columns.length],["CATEGORICAL",p.categorical_columns.length]];
  $("profileSummary").innerHTML=items.map(function(x){return '<div class="profile-card"><span>'+x[0]+'</span><strong>'+escapeHtml(x[1])+'</strong></div>';}).join("");
  $("insights").innerHTML=(data.insights||[]).map(function(i,n){return '<div class="insight"><span class="insight-num">'+String(n+1).padStart(2,"0")+'</span><span>'+escapeHtml(i)+'</span></div>';}).join("");
  renderCorrelation(p.correlations);
}
function renderCorrelation(corr){
  if(!corr || !corr.columns || !corr.columns.length){$("correlation").innerHTML='<div class="signal-empty">Not enough numeric columns for a correlation matrix.</div>';return;}
  const top=corr.columns.slice(0,8);
  const idx=top.map(function(x){return corr.columns.indexOf(x);});
  let html='<table class="corr-table"><thead><tr><th></th>'+top.map(function(x){return '<th>'+escapeHtml(x)+'</th>';}).join("")+'</tr></thead><tbody>';
  idx.forEach(function(i){
    html+='<tr><td>'+escapeHtml(corr.columns[i])+'</td>';
    idx.forEach(function(j){const v=Number(corr.matrix[i][j]||0);const opacity=.3+Math.min(1,Math.abs(v))*.7;html+='<td style="opacity:'+opacity.toFixed(2)+'">'+v.toFixed(2)+'</td>';});
    html+='</tr>';
  });
  $("correlation").innerHTML=html+'</tbody></table>';
}
function prepareTarget(columns){
  const candidates=columns.filter(function(c){return c.name && !String(c.name).toLowerCase().includes("id");});
  $("targetSelect").innerHTML=candidates.map(function(c){return '<option value="'+escapeHtml(c.name)+'">'+escapeHtml(c.name)+' · '+escapeHtml(c.dtype)+'</option>';}).join("");
}
$("trainBtn").addEventListener("click",async function(){
  if(!selectedDataset)return;
  const target=$("targetSelect").value;
  if(!target)return showToast("Choose a target column","error");
  $("jobProgress").hidden=false;
  $("progressBar").style.width="2%";
  $("jobMessage").textContent="Queued";
  try{
    const data=await getJson("/datasets/"+selectedDataset+"/train?target="+encodeURIComponent(target),{method:"POST"});
    pollJob(data.job_id);
    showToast("AutoML started","success");
  }catch(e){showToast(e.message,"error");}
});
async function pollJob(jobId){
  const timer=setInterval(async function(){
    try{
      const job=await getJson("/jobs/"+jobId);
      $("progressBar").style.width=Math.max(2,job.progress||0)+"%";
      $("progressPct").textContent=(job.progress||0)+"%";
      $("jobMessage").textContent=job.message||job.status;
      if(job.status==="complete"){clearInterval(timer);await selectDataset(selectedDataset);showToast("AutoML complete","success");}
      if(job.status==="failed"){clearInterval(timer);showToast(job.message||"Training failed","error");}
    }catch(e){clearInterval(timer);showToast(e.message,"error");}
  },1200);
}
function renderModelSummary(dataset){
  $("modelTable").innerHTML='<div class="model-hero"><div><span class="eyebrow">BEST MODEL</span><strong>'+escapeHtml(dataset.model_name)+'</strong><span>'+escapeHtml(dataset.problem_type||"trained model")+'</span></div><div class="score-big">'+escapeHtml(dataset.metrics ? JSON.stringify(dataset.metrics) : "—")+'</div></div>';
  $("modelReadiness").innerHTML='<div class="readiness"><span class="ready-check">✓</span><div><strong>'+escapeHtml(dataset.model_name)+'</strong><span>trained and persisted</span></div></div>';
}
async function loadImportance(id){
  try{
    const data=await getJson("/datasets/"+id+"/importance");
    const items=data.feature_importance||[];
    if(!items.length){$("importance").innerHTML='<div class="signal-empty">No model feature importances are available.</div>';return;}
    const max=Math.max.apply(null,items.map(function(x){return x.importance;}))+0.000001;
    $("importance").innerHTML=items.slice(0,10).map(function(x){return '<div class="importance-row"><span>'+escapeHtml(x.feature)+'</span><div class="bar"><i style="width:'+(x.importance/max*100).toFixed(1)+'%"></i></div><b>'+Number(x.importance).toFixed(4)+'</b></div>';}).join("");
  }catch(e){$("importance").innerHTML='<div class="signal-empty">'+escapeHtml(e.message)+'</div>';}
}
async function loadPredictionFields(id){
  try{
    const data=await getJson("/datasets/"+id);
    const p=data.profile;
    const fields=(p.numerical_columns||[]).concat(p.categorical_columns||[]);
    const target=data.dataset.target;
    const usable=fields.filter(function(x){return x!==target;}).slice(0,24);
    $("predictFields").innerHTML=usable.map(function(f){return '<label><span>'+escapeHtml(f)+'</span><input data-feature="'+escapeHtml(f)+'" placeholder="value"></label>';}).join("");
    $("predictPanel").hidden=false;
  }catch(e){$("predictPanel").hidden=true;}
}
$("predictBtn").addEventListener("click",async function(){
  if(!selectedDataset)return;
  const payload={};
  document.querySelectorAll("#predictFields [data-feature]").forEach(function(el){payload[el.dataset.feature]=el.value;});
  try{
    const result=await getJson("/datasets/"+selectedDataset+"/predict",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    $("predictionResult").innerHTML='<span class="eyebrow">OUTPUT</span><strong>'+escapeHtml(result.prediction)+'</strong>'+(result.confidence ? '<span>Confidence · '+(result.confidence*100).toFixed(1)+'%</span>' : '');
  }catch(e){showToast(e.message,"error");}
});
$("deleteDatasetBtn").addEventListener("click",async function(){
  if(!selectedDataset)return;
  if(!window.confirm("Delete this dataset and its saved model?"))return;
  try{await getJson("/datasets/"+selectedDataset,{method:"DELETE"});selectedDataset=null;$("analysisPanel").hidden=true;await refreshAll();showToast("Dataset removed","success");}
  catch(e){showToast(e.message,"error");}
});
function renderLatest(list){
  const d=list[0]; if(!d)return;
  $("latestSignal").innerHTML='<div class="latest-card"><div><strong>'+escapeHtml(d.name)+'</strong><span>'+d.rows.toLocaleString()+' rows × '+d.columns+' columns</span></div><span class="badge">'+(d.model_name?"MODEL READY":"PROFILE READY")+'</span></div>';
}
function addEvent(item){
  const html='<div class="feed-item"><span class="feed-time">'+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})+'</span><span class="feed-kind">'+escapeHtml(item.kind||"event")+'</span><span>'+escapeHtml(item.message)+'</span>'+(item.progress!=null?'<b>'+item.progress+'%</b>':'')+'</div>';
  $("activityFeed").insertAdjacentHTML("afterbegin",html);
  $("fullFeed").insertAdjacentHTML("afterbegin",html);
  while($("activityFeed").children.length>30)$("activityFeed").lastElementChild.remove();
  while($("fullFeed").children.length>100)$("fullFeed").lastElementChild.remove();
}
function connectStream(){
  if(STATIC_MODE){
    $("systemStatus").textContent="Local demo";
    const emitLocal=function(){
      const list=staticStore().datasets;
      const d=list[0];
      addEvent({kind:"local",message:d ? "Browser-local workspace ready for "+d.name : "Browser-local workspace ready",progress:d ? 100 : null});
    };
    emitLocal();
    window.setInterval(emitLocal, 15000);
    return;
  }
  const source=new EventSource(API+"/stream");
  source.onopen=function(){$("systemStatus").textContent="Online";};
  source.onmessage=function(e){try{addEvent(JSON.parse(e.data));}catch{}};
  source.onerror=function(){$("systemStatus").textContent="Reconnecting";};
}
refreshAll();
connectStream();
