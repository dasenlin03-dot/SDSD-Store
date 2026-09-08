const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");


const app = express();


// Render / 本地通用端口
const PORT = process.env.PORT || 3000;


// ======================
// 基础设置
// ======================


app.use(cors());


app.use(express.json());


app.use(express.urlencoded({
    extended:true
}));


// 静态文件
// 静态文件（后台 admin.html 单独做登录保护）
app.use((req, res, next) => {
    if (req.path === "/admin.html") return next();
    return express.static(__dirname, { index: false })(req, res, next);
});




// ======================
// Supabase 持久化配置
// ======================
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "product-images";

function requireSupabase(res) {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
        res.status(500).json({ message: "Supabase environment variables are not configured" });
        return false;
    }
    return true;
}

async function supabaseRequest(endpoint, options = {}) {
    const response = await fetch(`${SUPABASE_URL}${endpoint}`, {
        ...options,
        headers: {
            apikey: SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!response.ok) {
        const detail = typeof data === "string" ? data : JSON.stringify(data);
        const error = new Error(`Supabase request failed (${response.status}): ${detail}`);
        error.status = response.status;
        throw error;
    }
    return data;
}

function publicImageUrl(storagePath) {
    return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${storagePath}`;
}

// 图片上传到 Supabase Storage，而不是 Render 临时磁盘。
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post("/upload-image", requireAdmin, upload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });
    if (!requireSupabase(res)) return;

    try {
        const ext = path.extname(req.file.originalname || "").toLowerCase();
        const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"];
        const safeExt = allowed.includes(ext) ? ext : ".jpg";
        const filename = `products/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;
        const contentType = req.file.mimetype || "application/octet-stream";

        await supabaseRequest(
            `/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${filename.split("/").map(encodeURIComponent).join("/")}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": contentType,
                    "x-upsert": "false"
                },
                body: req.file.buffer
            }
        );

        const url = publicImageUrl(filename);
        res.json({
            success: true,
            message: "Image upload successful",
            image: url,
            path: url,
            url,
            filename
        });
    } catch (error) {
        console.error("Supabase image upload error:", error);
        res.status(500).json({ message: "Image upload failed", detail: error.message });
    }
});

// ======================
// 首页
// ======================


app.get("/",(req,res)=>{


res.sendFile(

path.join(
__dirname,
"index.html"

)

);


});








// ======================
// 后台管理员认证
// ======================
const adminAuthFile = path.join(__dirname, "admin-auth.json");
const DEFAULT_ADMIN_USER = process.env.ADMIN_USER || "admin";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "SDSD@2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "sdsd-store-change-this-secret";

// 管理员账号密码也保存到 Supabase，避免 Render 重新部署后密码被重置。
const ADMIN_AUTH_TABLE = "admin_auth";

// 登录成功后使用一次性通行票进入后台页面。
const adminPageTickets = new Map();

function makeAdminPageTicket(username) {
    const ticket = crypto.randomBytes(32).toString("base64url");
    adminPageTickets.set(ticket, { username, exp: Date.now() + 60 * 1000 });
    return ticket;
}

function consumeAdminPageTicket(ticket, username) {
    if (!ticket) return false;
    const item = adminPageTickets.get(ticket);
    if (!item) return false;
    adminPageTickets.delete(ticket);
    return item.username === username && item.exp > Date.now();
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
}

function localAdminAuth() {
    if (!fs.existsSync(adminAuthFile)) {
        const salt = crypto.randomBytes(16).toString("hex");
        const auth = { username: DEFAULT_ADMIN_USER, salt, passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD, salt) };
        fs.writeFileSync(adminAuthFile, JSON.stringify(auth, null, 2));
        return auth;
    }
    try { return JSON.parse(fs.readFileSync(adminAuthFile, "utf8")); }
    catch { return null; }
}

async function getAdminAuth() {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return localAdminAuth();
    try {
        const rows = await supabaseRequest(`${SUPABASE_URL}/rest/v1/${ADMIN_AUTH_TABLE}?id=eq.1&select=username,salt,password_hash`, { method: "GET" });
        if (Array.isArray(rows) && rows.length) return { username: rows[0].username, salt: rows[0].salt, passwordHash: rows[0].password_hash };

        const auth = localAdminAuth();
        if (auth) {
            await supabaseRequest(`${SUPABASE_URL}/rest/v1/${ADMIN_AUTH_TABLE}`, {
                method: "POST",
                headers: { "Prefer": "resolution=merge-duplicates" },
                body: JSON.stringify({ id: 1, username: auth.username, salt: auth.salt, password_hash: auth.passwordHash })
            });
        }
        return auth;
    } catch (err) {
        console.error("读取 Supabase 管理员账号失败，暂时使用本地账号文件：", err.message);
        return localAdminAuth();
    }
}

async function saveAdminAuth(auth) {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
        fs.writeFileSync(adminAuthFile, JSON.stringify(auth, null, 2));
        return;
    }
    await supabaseRequest(`${SUPABASE_URL}/rest/v1/${ADMIN_AUTH_TABLE}`, {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ id: 1, username: auth.username, salt: auth.salt, password_hash: auth.passwordHash })
    });
    // 同时更新本地文件作为备用，不影响 Supabase 持久化。
    fs.writeFileSync(adminAuthFile, JSON.stringify(auth, null, 2));
}

function makeSession(username) {
    const payload = Buffer.from(JSON.stringify({ username, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
    const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    return payload + "." + sig;
}

function validSession(token) {
    if (!token || !token.includes(".")) return false;
    const [payload, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    try { return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now(); }
    catch { return false; }
}

function getAdminSessionToken(req) {
    const header = req.headers.cookie || "";
    const match = header.match(/(?:^|;)\s*admin_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
}

function requireAdmin(req, res, next) {
    const cookieToken = getAdminSessionToken(req);
    const sessionToken = cookieToken || req.cookies?.admin_session || req.headers["x-admin-token"];
    if (validSession(sessionToken)) return next();
    return res.status(401).json({ message: "Admin login required" });
}

app.use((req, res, next) => {
    const header = req.headers.cookie || "";
    req.cookies = {};
    header.split(";").forEach(part => {
        const idx = part.indexOf("=");
        if (idx > -1) req.cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    next();
});

app.get("/admin-login.html", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.sendFile(path.join(__dirname, "admin-login.html"));
});

app.get("/admin.html", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const sessionToken = getAdminSessionToken(req);
    if (!validSession(sessionToken)) return res.redirect("/admin-login.html");
    let username = "";
    try { username = JSON.parse(Buffer.from(sessionToken.split(".")[0], "base64url").toString()).username || ""; }
    catch { return res.redirect("/admin-login.html"); }
    const ticket = String(req.query.ticket || "");
    if (!consumeAdminPageTicket(ticket, username)) return res.redirect("/admin-login.html");
    res.sendFile(path.join(__dirname, "admin.html"));
});

app.post("/admin-login", async (req, res) => {
    try {
        const auth = await getAdminAuth();
        const supplied = hashPassword(String(req.body.password || ""), auth?.salt || "");
        const passwordOk = auth && supplied.length === auth.passwordHash.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(auth.passwordHash));
        if (!passwordOk || req.body.username !== auth.username) return res.status(401).json({ message: "账号或密码错误" });
        res.setHeader("Set-Cookie", `admin_session=${makeSession(auth.username)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
        res.json({ success: true, ticket: makeAdminPageTicket(auth.username) });
    } catch (err) {
        console.error("管理员登录失败：", err);
        res.status(500).json({ message: "登录服务异常，请稍后再试" });
    }
});

app.post("/admin-change-password", requireAdmin, async (req, res) => {
    try {
        const auth = await getAdminAuth();
        const oldPassword = String(req.body.oldPassword || "");
        const newPassword = String(req.body.newPassword || "");
        if (!auth || hashPassword(oldPassword, auth.salt) !== auth.passwordHash) return res.status(400).json({ message: "原密码错误" });
        if (newPassword.length < 8) return res.status(400).json({ message: "新密码至少 8 位" });
        const salt = crypto.randomBytes(16).toString("hex");
        await saveAdminAuth({ username: auth.username, salt, passwordHash: hashPassword(newPassword, salt) });
        res.setHeader("Set-Cookie", "admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
        res.json({ success: true, message: "密码修改成功，请重新登录" });
    } catch (err) {
        console.error("修改管理员密码失败：", err);
        res.status(500).json({ message: "密码保存失败，请稍后再试" });
    }
});

app.post("/admin-logout", (req, res) => {
    res.setHeader("Set-Cookie", "admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
    res.json({ success: true });
});

app.get("/admin-status", requireAdmin, (req, res) => res.json({ success: true }));

// ======================
// 支付设置（Supabase）
// ======================

app.get("/payment-settings", async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
        const rows = await supabaseRequest("/rest/v1/payment_settings?id=eq.1&select=*");
        const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
        res.json({
            paypal: row.paypal || "",
            cashapp: row.cashapp || "",
            stripe: row.stripe || "",
            bank: row.bank || ""
        });
    } catch (error) {
        console.error("Supabase payment settings read error:", error);
        res.status(500).json({ message: "Failed to load payment settings" });
    }
});

app.post("/payment-settings", requireAdmin, async (req, res) => {
    if (!requireSupabase(res)) return;
    const settings = {
        id: 1,
        paypal: req.body.paypal || "",
        cashapp: req.body.cashapp || "",
        stripe: req.body.stripe || "",
        bank: req.body.bank || ""
    };

    try {
        await supabaseRequest("/rest/v1/payment_settings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify(settings)
        });
        console.log("Payment settings updated");
        res.json({ message: "Saved successfully" });
    } catch (error) {
        console.error("Supabase payment settings write error:", error);
        res.status(500).json({ message: "Failed to save payment settings" });
    }
});

// ======================
// 商品系统（Supabase）
// ======================

app.get("/products", async (req, res) => {
    if (!requireSupabase(res)) return;
    try {
        const products = await supabaseRequest("/rest/v1/products?select=*&order=id.asc");
        res.json(Array.isArray(products) ? products : []);
    } catch (error) {
        console.error("Supabase products read error:", error);
        res.status(500).json({ message: "Failed to load products" });
    }
});

app.post("/products", requireAdmin, async (req, res) => {
    if (!requireSupabase(res)) return;

    const newProduct = {
        id: Date.now(),
        name: req.body.name || "",
        price: req.body.price || "",
        description: req.body.description || "",
        image: req.body.image || ""
    };

    try {
        const rows = await supabaseRequest("/rest/v1/products", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Prefer: "return=representation"
            },
            body: JSON.stringify(newProduct)
        });
        const product = Array.isArray(rows) && rows[0] ? rows[0] : newProduct;
        console.log("New product:", product);
        res.json({ message: "Product added successfully", product });
    } catch (error) {
        console.error("Supabase product insert error:", error);
        res.status(500).json({ message: "Failed to add product" });
    }
});

app.delete("/products/:id", requireAdmin, async (req, res) => {
    if (!requireSupabase(res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid product id" });

    try {
        await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { Prefer: "return=minimal" }
        });
        console.log("Delete product:", id);
        res.json({ message: "Product deleted successfully" });
    } catch (error) {
        console.error("Supabase product delete error:", error);
        res.status(500).json({ message: "Failed to delete product" });
    }
});

// ======================
// 页面接口
// ======================


// 后台页面

app.get(
"/admin.html",
(req,res)=>{


res.sendFile(

path.join(
__dirname,
"admin.html"
)

);


});







// 商品列表页面

app.get(
"/products.html",
(req,res)=>{


res.sendFile(

path.join(
__dirname,
"products.html"
)

);


});









// 商品详情页面

app.get(
"/product-detail.html",
(req,res)=>{


res.sendFile(

path.join(
__dirname,
"product-detail.html"
)

);


});









// Checkout 支付页面

app.get(
"/checkout.html",
(req,res)=>{


res.sendFile(

path.join(
__dirname,
"checkout.html"
)

);


});









// ======================
// Render健康检查
// ======================


app.get(
"/health",
(req,res)=>{


res.json({

status:"ok",

server:"SDSD Store",

persistence: SUPABASE_URL && SUPABASE_SECRET_KEY ? "supabase" : "not-configured"

});


});









// ======================
// 启动服务器
// ======================


app.listen(
PORT,
"0.0.0.0",
()=>{


console.log(
"SDSD Server running on port "
+
PORT
);


});





process.stdin.resume();