const API = "/api";
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
  const source=new EventSource(API+"/stream");
  source.onopen=function(){$("systemStatus").textContent="Online";};
  source.onmessage=function(e){try{addEvent(JSON.parse(e.data));}catch{}};
  source.onerror=function(){$("systemStatus").textContent="Reconnecting";};
}
refreshAll();
connectStream();
