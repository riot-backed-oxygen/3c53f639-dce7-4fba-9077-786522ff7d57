require('dotenv').config();
const path=require('path'),express=require('express'),mysql=require('mysql2/promise');
const app=express(),port=Number(process.env.PORT||3000);
const pool=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'actresses',waitForConnections:true,connectionLimit:10,charset:'utf8mb4'});
app.use(express.json());app.use(express.static(path.join(__dirname,'public')));
function parseRow(r){for(const k of ['social_links','listing_data','profile_data'])if(typeof r[k]==='string')try{r[k]=JSON.parse(r[k])}catch{}return r}
const { buildActressQueries } = require('./actress-query');
app.get('/api/actresses', async (req, res) => {
  let query;
  try {
    query = buildActressQueries(req.query);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const [[counts], [rows]] = await Promise.all([
      pool.query(query.countSql, query.countArgs),
      pool.query(query.rowsSql, query.rowsArgs),
    ]);
    const total = counts[0].total;
    res.json({
      data: rows.map(parseRow),
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
    });
  } catch (error) {
    res.status(503).json({ error: 'Database connection failed. Check your .env and MySQL service.' });
  }
});
app.get('/api/actresses/:id',async(req,res)=>{try{const [r]=await pool.query('SELECT * FROM actresses WHERE actress_id=?',[req.params.id]);if(!r.length)return res.status(404).json({error:'Actress not found'});res.json({data:parseRow(r[0])})}catch(e){res.status(503).json({error:'Database connection failed. Check your .env.'})}});
const javbusBase=(process.env.JAVBUS_API_URL||'').replace(/\/$/,'');
async function javbus(pathname){if(!javbusBase)throw new Error('JAVBUS_API_URL is not configured');const r=await fetch(javbusBase+pathname,{headers:{'j-auth-token':process.env.JAVBUS_API_TOKEN||''}});if(!r.ok)throw new Error('Javbus API error: '+r.status);return r.json()}
app.get('/api/javbus/search',async(req,res)=>{try{const keyword=String(req.query.keyword||'').trim();if(!keyword)return res.status(400).json({error:'keyword is required'});res.json(await javbus('/api/movies/search?keyword='+encodeURIComponent(keyword)))}catch(e){res.status(502).json({error:e.message})}});
app.get('/api/javbus/movies/:id',async(req,res)=>{try{res.json(await javbus('/api/movies/'+encodeURIComponent(req.params.id)))}catch(e){res.status(502).json({error:e.message})}});
app.get('/api/javbus/magnets/:id',async(req,res)=>{try{const gid=String(req.query.gid||'');const uc=String(req.query.uc||'0');if(!gid)return res.status(400).json({error:'gid is required'});res.json(await javbus('/api/magnets/'+encodeURIComponent(req.params.id)+'?gid='+encodeURIComponent(gid)+'&uc='+encodeURIComponent(uc)))}catch(e){res.status(502).json({error:e.message})}});app.get('/api/image',async(req,res)=>{try{const target=String(req.query.url||'');const parsed=new URL(target);if(!['http:','https:'].includes(parsed.protocol))return res.status(400).end();const upstream=await fetch(parsed,{headers:{'user-agent':'Mozilla/5.0','referer':parsed.origin+'/'}});if(!upstream.ok)return res.status(upstream.status).end();res.set('Content-Type',upstream.headers.get('content-type')||'image/jpeg');res.set('Cache-Control','public, max-age=86400');res.send(Buffer.from(await upstream.arrayBuffer()))}catch(e){res.status(502).end()}});app.get('*',(_,res)=>res.sendFile(path.join(__dirname,'public/index.html')));app.listen(port,()=>console.log('Actress Atlas: http://localhost:'+port));


