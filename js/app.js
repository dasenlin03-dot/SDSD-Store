let cart = JSON.parse(localStorage.getItem("cart")) || [];


// 添加商品
function addToCart(name, price) {

    let product = {
        name: name,
        price: price
    };


    cart.push(product);


    localStorage.setItem(
        "cart",
        JSON.stringify(cart)
    );


    alert(name + " added to cart!");
}


// 显示购物车
function showCart() {

    let cartBox = document.getElementById("cartItems");

    let totalBox = document.getElementById("totalPrice");


    if (!cartBox) {
        return;
    }


    cartBox.innerHTML = "";


    let total = 0;


    cart.forEach(function(item, index){


        total += item.price;


        cartBox.innerHTML += `

        <div class="card">

        <h3>${item.name}</h3>

        <p>$${item.price}</p>


        <button onclick="removeCart(${index})">

        Remove

        </button>


        </div>

        `;


    });


    totalBox.innerHTML =
    "Total: $" + total.toFixed(2);

}


// 删除商品
function removeCart(index){

    cart.splice(index,1);


    localStorage.setItem(
        "cart",
        JSON.stringify(cart)
    );


    showCart();

}


// 清空购物车
function clearCart(){

    cart = [];


    localStorage.removeItem("cart");


    showCart();

}


// 页面加载自动显示购物车
window.onload = function(){

    showCart();

};