require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

function requireAuth(req,res,next){
  if (!req.session.user) return res.status(401).json({ error:'Unauthorized' });
  next();
}

async function audit(req, action, entity, entityId, detail={}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs(user_id, action, entity, entity_id, detail)
       VALUES($1,$2,$3,$4,$5)`,
      [req.session?.user?.id || null, action, entity, entityId ? String(entityId) : null, JSON.stringify(detail)]
    );
  } catch {}
}

app.post('/api/login', asyncHandler(async (req,res)=>{
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error:'Username dan password wajib diisi.' });

  const result = await pool.query(`SELECT id,username,password_hash,role FROM users WHERE username=$1`, [username]);
  if (!result.rowCount) return res.status(401).json({ error:'Username atau password salah.' });

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error:'Username atau password salah.' });

  req.session.user = { id:user.id, username:user.username, role:user.role };
  await audit(req,'LOGIN','auth',user.id,{username:user.username});
  res.json({ user:req.session.user });
}));

app.post('/api/logout', requireAuth, (req,res)=>{
  req.session.destroy(()=>res.json({ ok:true }));
});

app.get('/api/me', (req,res)=>{
  if (!req.session.user) return res.status(401).json({ error:'Unauthorized' });
  res.json({ user:req.session.user });
});

app.get('/api/dashboard', requireAuth, asyncHandler(async (req,res)=>{
  const [mats, wo, usage] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE stock <= min_stock)::int low_stock,
      COALESCE(SUM(stock*avg_price),0)::float inventory_value
      FROM materials`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status NOT IN ('COMPLETED','CLOSED'))::int active FROM work_orders`),
    pool.query(`SELECT COALESCE(SUM(qty*unit_price),0)::float usage_cost FROM material_usages`)
  ]);
  res.json({
    materials:mats.rows[0].total,
    lowStock:mats.rows[0].low_stock,
    inventoryValue:mats.rows[0].inventory_value,
    activeWO:wo.rows[0].active,
    usageCost:usage.rows[0].usage_cost
  });
}));

app.get('/api/materials', requireAuth, asyncHandler(async (req,res)=>{
  const r = await pool.query(`SELECT * FROM materials ORDER BY code`);
  res.json(r.rows);
}));

app.post('/api/materials', requireAuth, asyncHandler(async (req,res)=>{
  const {code,name,category,unit,min_stock=0,stock=0,location='',avg_price=0} = req.body;
  const r = await pool.query(
    `INSERT INTO materials(code,name,category,unit,min_stock,stock,location,avg_price)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [code,name,category,unit,min_stock,stock,location,avg_price]
  );
  await audit(req,'CREATE','material',r.rows[0].id,r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/materials/:id', requireAuth, asyncHandler(async (req,res)=>{
  const {name,category,unit,min_stock,location} = req.body;
  const r = await pool.query(
    `UPDATE materials SET name=$1,category=$2,unit=$3,min_stock=$4,location=$5,updated_at=NOW()
     WHERE id=$6 RETURNING *`,
    [name,category,unit,min_stock,location,req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({error:'Material tidak ditemukan.'});
  await audit(req,'UPDATE','material',req.params.id,r.rows[0]);
  res.json(r.rows[0]);
}));

app.get('/api/work-orders', requireAuth, asyncHandler(async (req,res)=>{
  const r = await pool.query(`
    SELECT w.*,
      COALESCE(SUM(u.qty*u.unit_price),0)::float AS material_cost
    FROM work_orders w
    LEFT JOIN material_usages u ON u.work_order_id=w.id
    GROUP BY w.id
    ORDER BY w.created_date DESC, w.id DESC
  `);
  res.json(r.rows);
}));

app.post('/api/work-orders', requireAuth, asyncHandler(async (req,res)=>{
  const {wo_number,equipment,location='',priority='Medium',status='OPEN',description='',created_date} = req.body;
  const r = await pool.query(
    `INSERT INTO work_orders(wo_number,equipment,location,priority,status,description,created_date)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [wo_number,equipment,location,priority,status,description,created_date || new Date().toISOString().slice(0,10)]
  );
  await audit(req,'CREATE','work_order',r.rows[0].id,r.rows[0]);
  res.status(201).json(r.rows[0]);
}));

app.put('/api/work-orders/:id/status', requireAuth, asyncHandler(async (req,res)=>{
  const {status} = req.body;
  const allowed=['OPEN','IN PROGRESS','COMPLETED','CLOSED'];
  if (!allowed.includes(status)) return res.status(400).json({error:'Status tidak valid.'});
  const r = await pool.query(
    `UPDATE work_orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,
    [status,req.params.id]
  );
  if(!r.rowCount) return res.status(404).json({error:'Work Order tidak ditemukan.'});
  await audit(req,'UPDATE_STATUS','work_order',req.params.id,{status});
  res.json(r.rows[0]);
}));

app.get('/api/purchases', requireAuth, asyncHandler(async (req,res)=>{
  const r = await pool.query(`
    SELECT p.*, m.code material_code, m.name material_name, m.unit
    FROM purchases p JOIN materials m ON m.id=p.material_id
    ORDER BY p.purchase_date DESC, p.id DESC
  `);
  res.json(r.rows);
}));

app.post('/api/purchases', requireAuth, asyncHandler(async (req,res)=>{
  const {po_number,purchase_date,supplier,material_id,qty,unit_price} = req.body;
  const q = Number(qty), price = Number(unit_price);
  if (!(q>0) || price<0) return res.status(400).json({error:'Qty/harga tidak valid.'});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mr = await client.query(`SELECT * FROM materials WHERE id=$1 FOR UPDATE`,[material_id]);
    if(!mr.rowCount) throw new Error('Material tidak ditemukan');
    const m=mr.rows[0];
    const oldStock=Number(m.stock), oldAvg=Number(m.avg_price);
    const newStock=oldStock+q;
    const newAvg=newStock===0?price:((oldStock*oldAvg)+(q*price))/newStock;

    const pr = await client.query(
      `INSERT INTO purchases(po_number,purchase_date,supplier,material_id,qty,unit_price)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [po_number,purchase_date,supplier,material_id,q,price]
    );
    await client.query(
      `UPDATE materials SET stock=$1,avg_price=$2,updated_at=NOW() WHERE id=$3`,
      [newStock,newAvg,material_id]
    );
    await client.query('COMMIT');
    await audit(req,'RECEIVE','purchase',pr.rows[0].id,{material_id,qty:q,unit_price:price});
    res.status(201).json(pr.rows[0]);
  } catch(err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}));

app.get('/api/usages', requireAuth, asyncHandler(async (req,res)=>{
  const r = await pool.query(`
    SELECT u.*, m.code material_code,m.name material_name,m.unit,
           w.wo_number,w.equipment
    FROM material_usages u
    JOIN materials m ON m.id=u.material_id
    JOIN work_orders w ON w.id=u.work_order_id
    ORDER BY u.usage_date DESC,u.id DESC
  `);
  res.json(r.rows);
}));

app.post('/api/usages', requireAuth, asyncHandler(async (req,res)=>{
  const {usage_date,work_order_id,material_id,qty} = req.body;
  const q=Number(qty);
  if(!(q>0)) return res.status(400).json({error:'Qty tidak valid.'});

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const mr=await client.query(`SELECT * FROM materials WHERE id=$1 FOR UPDATE`,[material_id]);
    if(!mr.rowCount) throw new Error('Material tidak ditemukan');
    const m=mr.rows[0];
    const stock=Number(m.stock);
    if(q>stock){
      await client.query('ROLLBACK');
      return res.status(400).json({error:`Stok tidak cukup. Tersedia ${stock} ${m.unit}.`});
    }
    const wr=await client.query(`SELECT id FROM work_orders WHERE id=$1`,[work_order_id]);
    if(!wr.rowCount) throw new Error('Work Order tidak ditemukan');

    const ur=await client.query(
      `INSERT INTO material_usages(usage_date,work_order_id,material_id,qty,unit_price)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [usage_date,work_order_id,material_id,q,Number(m.avg_price)]
    );
    await client.query(
      `UPDATE materials SET stock=stock-$1,updated_at=NOW() WHERE id=$2`,
      [q,material_id]
    );
    await client.query('COMMIT');
    await audit(req,'ISSUE','material_usage',ur.rows[0].id,{work_order_id,material_id,qty:q});
    res.status(201).json(ur.rows[0]);
  }catch(err){
    try{ await client.query('ROLLBACK'); }catch{}
    throw err;
  }finally{ client.release(); }
}));

app.get('/api/reports/wo-cost', requireAuth, asyncHandler(async(req,res)=>{
  const r=await pool.query(`
    SELECT w.wo_number,w.equipment,w.status,
      COALESCE(SUM(u.qty),0)::float issued_qty,
      COALESCE(SUM(u.qty*u.unit_price),0)::float material_cost
    FROM work_orders w
    LEFT JOIN material_usages u ON u.work_order_id=w.id
    GROUP BY w.id
    ORDER BY material_cost DESC
  `);
  res.json(r.rows);
}));

app.get('/api/backup', requireAuth, asyncHandler(async(req,res)=>{
  const tables=['materials','work_orders','purchases','material_usages','audit_logs'];
  const data={version:'2.0',generated_at:new Date().toISOString(),tables:{}};
  for(const t of tables){
    const r=await pool.query(`SELECT * FROM ${t} ORDER BY id`);
    data.tables[t]=r.rows;
  }
  await audit(req,'BACKUP','system',null,{});
  const filename=`inventory-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.send(JSON.stringify(data,null,2));
}));

app.get('/api/audit', requireAuth, asyncHandler(async(req,res)=>{
  const r=await pool.query(`
    SELECT a.*,u.username FROM audit_logs a
    LEFT JOIN users u ON u.id=a.user_id
    ORDER BY a.created_at DESC LIMIT 200
  `);
  res.json(r.rows);
}));

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

app.use((err,req,res,next)=>{
  console.error(err);
  if (err.code === '23505') return res.status(409).json({error:'Data dengan kode/nomor tersebut sudah ada.'});
  res.status(500).json({error:err.message || 'Terjadi kesalahan server.'});
});

app.listen(port, ()=>console.log(`Inventory Admin v2 running on port ${port}`));
