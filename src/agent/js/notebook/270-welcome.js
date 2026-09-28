/* ----- first-run welcome: shown only while the notebook is a single empty cell with no data ----- */
function renderWelcome(){
  let w=document.getElementById("welcome");
  const first=cells[0],empty=cells.length<=1&&(!first||!String((first.taEl?first.taEl.value:first.source)||"").trim())&&!dataFiles.length;
  if(!empty){ if(w) w.remove(); return; }
  if(w||!nb.parentNode) return;
  w=document.createElement("section"); w.id="welcome"; w.className="welcome";
  w.innerHTML='<h2>Start exploring</h2><p>Python runs right here in your browser, and your data never leaves it. Bring a file or try the sample, then write code — or describe what you want and let the agent build the analysis with you.</p><div class="welcome-acts"><button class="btn primary" data-w="sample">Try a sample dataset</button><button class="btn" data-w="data">Upload data</button><button class="btn" data-w="open">Open a notebook</button><button class="btn" data-w="agent">Ask the agent</button></div><p class="welcome-tip">Drop files anywhere to mount them · ⇧⏎ runs a cell · press ? for every shortcut</p>';
  w.addEventListener("click",e=>{ const b=e.target.closest("[data-w]"); if(!b) return; const k=b.dataset.w;
    if(k==="sample") loadSampleDataset();
    else if(k==="data"){ openData(); const up=$("#dataUpload"); if(up) up.click(); }
    else if(k==="open"){ const o=$("#btnOpen"); if(o) o.click(); }
    else if(k==="agent"&&typeof openAgent==="function"){ openAgent(); const inp=$("#agIn"); if(inp&&!inp.value){ inp.value="Explore the mounted data: describe its shape and quality, then chart the most interesting patterns."; inp.select(); } }
  });
  nb.parentNode.insertBefore(w,nb);
}
async function loadSampleDataset(){
  if(!kernelReady){ toast("Kernel still booting — one moment.","err"); return; }
  let seed=20250101; const rnd=()=>(seed=(Math.imul(seed,1103515245)+12345)>>>0)/4294967296;
  const regions=["North","South","East","West"],channels=["Online","Retail","Partner"],products=[["Notebook",4.5],["Backpack",38],["Headphones",59],["Desk lamp",24],["Water bottle",12]],start=Date.UTC(2025,0,1),rows=["date,region,channel,product,units,unit_price,discount,returned"];
  for(let i=0;i<600;i++){ const day=Math.floor(rnd()*365),date=new Date(start+day*86400000),r=regions[Math.floor(rnd()*4)],c=channels[Math.floor(rnd()*3)],[name,base]=products[Math.floor(rnd()*5)],season=1+0.3*Math.sin(date.getUTCMonth()/12*2*Math.PI),units=Math.max(1,Math.round((3+rnd()*9)*season*(c==="Online"?1.3:1))),discount=[0,0,0,0.05,0.1,0.15][Math.floor(rnd()*6)],price=(base*(0.9+rnd()*0.2)).toFixed(2),returned=rnd()<(c==="Online"?0.09:0.04)?1:0; rows.push([date.toISOString().slice(0,10),r,c,name,units,price,discount,returned].join(",")); }
  await mountUploadedFiles([new File([rows.join("\n")+"\n"],"sample_sales.csv",{type:"text/csv"})],false);
  const spec=[["markdown","# Sample sales\nA synthetic year of orders across regions, channels, and products. Edit any cell, or ask the agent to take the analysis further."],["code",'import pandas as pd\ndf = pd.read_csv("sample_sales.csv", parse_dates=["date"])\ndf["revenue"] = df.units * df.unit_price * (1 - df.discount)\ndf.head()'],["code",'df.pivot_table(index="region", columns="channel", values="revenue", aggfunc="sum").round(0)']];
  const first=cells[0]; if(cells.length===1&&first&&!String((first.taEl?first.taEl.value:first.source)||"").trim()) cells.splice(0,1);
  const made=spec.map(([type,source],i)=>{ const c=mkCell(type,source); cells.splice(i,0,c); return c; });
  render(); if(nbName==="Untitled"){ nbName="sample-sales"; setNbTitle(); } persist();
  for(const c of made){ if(c.type==="markdown") showRendered(c,true); else await runCell(c); }
  selectCell(made[made.length-1].id,"command");
}
