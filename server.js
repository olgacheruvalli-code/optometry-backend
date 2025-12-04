require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 5050;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/optometry";
const ORIGINS_RAW = process.env.ALLOWED_ORIGINS || "";
const ALLOWED_ORIGINS = ORIGINS_RAW.split(",").map(s=>s.trim()).filter(Boolean);
const FISCAL_MONTHS = [
  "April","May","June","July","August","September",
  "October","November","December","January","February","March",
];
const ALL_QUESTION_KEYS = Array.from({length:84},(_,i)=>`q${i+1}`);

/* ================= HELPERS ================= */
const _num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const _answersTo84Array = a => ALL_QUESTION_KEYS.map(k => _num(a[k]));
const _sum84 = (a=[],b=[]) => a.map((x,i)=>_num(x)+_num(b[i]||0));
const _normalize84 = o => Object.fromEntries(ALL_QUESTION_KEYS.map(k=>[k,_num(o[k])]));
const _fiscalStartYear = (m,y)=>(["January","February","March"].includes(m)?(+y-1):(+y));
function _fiscalWindow(toMonth,toYear){
  const startY=_fiscalStartYear(toMonth,toYear);
  const win=[];
  for(let i=0;i<FISCAL_MONTHS.length;i++){
    const m=FISCAL_MONTHS[i]; const y=i<=8?startY:startY+1;
    win.push({month:m,year:String(y)});
    if(m===toMonth && String(y)===String(toYear)) break;
  }
  return win;
}
const ciEq=(f,v)=>({[f]:{$regex:`^${String(v).trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}$`,$options:"i"}});
function normalizeMonth(m=""){
  const map={jan:"January",feb:"February",mar:"March",apr:"April",may:"May",jun:"June",jul:"July",aug:"August",sep:"September",sept:"September",oct:"October",nov:"November",dec:"December"};
  const s=String(m).trim().toLowerCase();
  const full=FISCAL_MONTHS.find(n=>n.toLowerCase()===s);
  return full||map[s.slice(0,4)]||m;
}

/* ========== Canonicalize institution names ========== */
function canonicalizeInstitution(raw=""){
  const name=String(raw||"").trim().replace(/\s+/g," ");
  const lower=name.toLowerCase();
  if(/(bfhc|chc)\s*nari/i.test(lower)) return {key:"chc narikkuni",display:"CHC Narikkuni"};
  if(/(bfhc|chc)\s*olav/i.test(lower)) return {key:"chc olavanna",display:"CHC Olavanna"};
  return {key:lower,display:name};
}

/* ================= MONGOOSE ================= */
const ReportSchema=new mongoose.Schema({
  district:String,
  institution:String,
  month:String,
  year:String,
  answers:Object,
  cumulative:Object,
  eyeBank:Array,
  visionCenter:Array,
},{timestamps:true,versionKey:false});
const Report=mongoose.model("Report",ReportSchema);

/* ================= EXPRESS ================= */
const app=express();
app.use(cors({origin:(o,cb)=>cb(null,true)}));
app.use(express.json({limit:"2mb"}));

app.get("/api/health",(req,res)=>res.json({ok:true,version:"v8-canonical-fix"}));

/* ---------- LOGIN ---------- */
app.post("/api/login",(req,res)=>{
  const {district="",institution="",password=""}=req.body||{};
  if(!district||!institution||!password)
    return res.status(400).json({ok:false,error:"missing_fields"});
  const role=/^dc\s|^doc\s/i.test(institution)?"DOC":"USER";
  res.json({ok:true,user:{district,institution,role,isDoc:role==="DOC"}});
});

/* ---------- DISTRICT-INSTITUTION REPORT ---------- */
app.get("/api/district-institution-report",async(req,res)=>{
  try{
    const district=String(req.query.district||"").trim();
    const month=normalizeMonth(req.query.month||"");
    const year=String(req.query.year||"");
    if(!district||!month||!year)
      return res.status(400).json({ok:false,error:"missing_params"});

    const window=_fiscalWindow(month,year);
    const docs=(await Report.find(ciEq("district",district)).lean()).map(d=>{
      const canon=canonicalizeInstitution(d.institution);
      return {...d,institutionKey:canon.key,institutionName:canon.display};
    });

    // Group latest per institutionKey/month/year
    const latest=new Map();
    const instMap=new Map();
    const keyFor=(inst,m,y)=>`${inst}|${m}|${y}`;
    const ts=d=>Date.parse(d.updatedAt||d.createdAt||0)||0;
    for(const d of docs){
      if(/^doc|^dc/i.test(d.institutionKey)) continue;
      instMap.set(d.institutionKey,d.institutionName);
      const k=keyFor(d.institutionKey,d.month,d.year);
      const prev=latest.get(k);
      if(!prev||ts(d)>ts(prev)) latest.set(k,d);
    }

    const instEntries=[...instMap.entries()].sort((a,b)=>a[1].localeCompare(b[1],"en",{sensitivity:"base"}));

    const institutionData=instEntries.map(([key,display])=>{
      const monthDoc=latest.get(keyFor(key,month,year));
      const monthData=_answersTo84Array(monthDoc?.answers||{});
      let cumulativeData=new Array(84).fill(0);
      for(const w of window){
        const d=latest.get(keyFor(key,w.month,w.year));
        if(d) cumulativeData=_sum84(cumulativeData,_answersTo84Array(d.answers));
      }
      return {institution:display,monthData,cumulativeData};
    });

    // district totals
    const districtMonth=new Array(84).fill(0);
    const districtCum=new Array(84).fill(0);
    for(const inst of institutionData){
      for(let i=0;i<84;i++){
        districtMonth[i]+=_num(inst.monthData[i]);
        districtCum[i]+=_num(inst.cumulativeData[i]);
      }
    }

    res.json({ok:true,district,month,year,institutionData,
      districtPerformance:{monthData:districtMonth,cumulativeData:districtCum}});
  }catch(e){
    console.error("district-institution-report error",e);
    res.status(500).json({ok:false,error:"server_error"});
  }
});

/* ---------- 404 ---------- */
app.use((req,res)=>res.status(404).json({ok:false,error:"route_not_found",path:req.path}));

/* ---------- START ---------- */
mongoose.connect(MONGO_URI,{dbName:"optometry"})
  .then(()=>console.log("✅ Mongo connected"))
  .catch(e=>console.error("❌ Mongo connect failed:",e.message));
app.listen(PORT,"0.0.0.0",()=>console.log(`🚀 API listening on port ${PORT}`));
