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
// 图片上传
// ======================


const imageFolder =
path.join(
    __dirname,
    "images"
);



// 创建图片目录
if(!fs.existsSync(imageFolder)){

    fs.mkdirSync(
        imageFolder,
        {
            recursive:true
        }
    );

}




const storage =
multer.diskStorage({


destination:function(req,file,cb){


    cb(
        null,
        imageFolder
    );


},



filename:function(req,file,cb){
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif"];
    const safeExt = allowed.includes(ext) ? ext : ".jpg";
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;
    cb(null, filename);
}



});






const upload =
multer({

storage:storage

});






// ======================
// 上传图片接口
// ======================


app.post(
"/upload-image",
requireAdmin,
upload.single("image"),
(req,res)=>{


if(!req.file){


return res.status(400).json({

message:"No image uploaded"

});


}




const imagePath = "images/" + req.file.filename;

res.json({
    success: true,
    message: "Image upload successful",
    image: imagePath,
    path: imagePath,
    url: "/" + imagePath,
    filename: req.file.filename
});


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

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
}

function loadAdminAuth() {
    if (!fs.existsSync(adminAuthFile)) {
        const salt = crypto.randomBytes(16).toString("hex");
        const auth = { username: DEFAULT_ADMIN_USER, salt, passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD, salt) };
        fs.writeFileSync(adminAuthFile, JSON.stringify(auth, null, 2));
        return auth;
    }
    try { return JSON.parse(fs.readFileSync(adminAuthFile, "utf8")); }
    catch { return null; }
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
    // 直接从请求 Cookie 读取，确保在所有受保护接口中都能拿到登录状态
    // （包括 /upload-image 这种在 Cookie 解析中间件之前注册的接口）。
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

// 读取 cookie（不依赖额外 npm 包）
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
    if (!validSession(req.cookies?.admin_session)) return res.redirect("/admin-login.html");
    res.sendFile(path.join(__dirname, "admin.html"));
});

app.post("/admin-login", (req, res) => {
    const auth = loadAdminAuth();
    if (!auth || req.body.username !== auth.username || !crypto.timingSafeEqual(Buffer.from(hashPassword(String(req.body.password || ""), auth.salt)), Buffer.from(auth.passwordHash))) {
        return res.status(401).json({ message: "账号或密码错误" });
    }
    res.setHeader("Set-Cookie", `admin_session=${makeSession(auth.username)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
    res.json({ success: true });
});

app.post("/admin-change-password", requireAdmin, (req, res) => {
    const auth = loadAdminAuth();
    const oldPassword = String(req.body.oldPassword || "");
    const newPassword = String(req.body.newPassword || "");
    if (!auth || hashPassword(oldPassword, auth.salt) !== auth.passwordHash) return res.status(400).json({ message: "原密码错误" });
    if (newPassword.length < 8) return res.status(400).json({ message: "新密码至少 8 位" });
    const salt = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(adminAuthFile, JSON.stringify({ username: auth.username, salt, passwordHash: hashPassword(newPassword, salt) }, null, 2));
    res.json({ success: true, message: "密码修改成功，请重新登录" });
});

app.post("/admin-logout", (req, res) => {
    res.setHeader("Set-Cookie", "admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
    res.json({ success: true });
});

app.get("/admin-status", requireAdmin, (req, res) => res.json({ success: true }));

// ======================
// 支付设置
// ======================


let paymentSettings={


paypal:"",

cashapp:"",

stripe:"",

bank:""


};







app.get(
"/payment-settings",
(req,res)=>{


res.json(paymentSettings);


});








app.post(
"/payment-settings",
requireAdmin,
(req,res)=>{


paymentSettings={


paypal:req.body.paypal || "",


cashapp:req.body.cashapp || "",


stripe:req.body.stripe || "",


bank:req.body.bank || ""


};




console.log(
"Payment settings updated:"
);


console.log(paymentSettings);




res.json({

message:"Saved successfully"

});


});






// ======================
// 商品系统
// ======================


const productFile =
path.join(
__dirname,
"products.json"
);








// 读取商品

function loadProducts(){



if(!fs.existsSync(productFile)){


fs.writeFileSync(
productFile,
"[]"
);


}




let data =
fs.readFileSync(
productFile,
"utf8"
);




try{


return JSON.parse(data);


}catch(error){


return [];


}


}








// 保存商品


function saveProducts(products){



fs.writeFileSync(

productFile,

JSON.stringify(
products,
null,
2
)

);


}









// 获取全部商品


app.get(
"/products",
(req,res)=>{


let products =
loadProducts();



res.json(products);



});










// 添加商品


app.post(
"/products",
requireAdmin,
(req,res)=>{


let products =
loadProducts();




let newProduct={


id:Date.now(),


name:req.body.name || "",


price:req.body.price || "",


description:req.body.description || "",


image:req.body.image || ""


};






products.push(newProduct);



saveProducts(products);






console.log(
"New product:"
);


console.log(newProduct);







res.json({

message:"Product added successfully",

product:newProduct

});



});











// 删除商品


app.delete(
"/products/:id",
requireAdmin,
(req,res)=>{


let products =
loadProducts();




let id =
Number(req.params.id);







let newProducts =
products.filter(product=>{


return product.id !== id;


});






saveProducts(newProducts);






console.log(
"Delete product:",
id
);






res.json({

message:"Product deleted successfully"

});



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

server:"SDSD Store"

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