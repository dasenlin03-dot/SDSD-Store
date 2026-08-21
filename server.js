const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
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
app.use(express.static(__dirname));




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


    let filename =
    Date.now()
    +
    "-"
    +
    file.originalname.replace(/\s+/g,"-");



    cb(
        null,
        filename
    );


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
upload.single("image"),
(req,res)=>{


if(!req.file){


return res.status(400).json({

message:"No image uploaded"

});


}




res.json({

message:"Image upload successful",

image:
"images/"+req.file.filename


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