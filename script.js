let timeRequired = 0;  // in ms
let cost = 0;

function calculate() {
  let current = Number(document.getElementById("current").value);
  let required = Number(document.getElementById("required").value);

  if (
    isNaN(current) || isNaN(required) ||
    current < 0 || current > 99 ||
    required <= current ||
    required > 100
  ) {
    alert("⚠ Please enter valid percentages.");
    return;
  }

  // Simple prototype formula: each 1% battery = 1 min charging & ₹2
  let percentNeeded = required - current;
  let minutes = percentNeeded; 
  timeRequired = minutes * 60 * 1000; // in ms
  cost = percentNeeded * 2;

  document.getElementById("result").innerText = 
    `Estimated Time: ${minutes} min | Cost: ₹${cost}`;
  document.getElementById("payBtn").style.display = "inline-block";
}

  // ====================== REAL PAYMENT INTEGRATION ======================
let currentOrderId = null;
const BACKEND = "http://localhost:3000"; // change to your deployed backend URL

async function goToPayment() {
  document.getElementById("payAmount").innerText = `Amount to Pay: ₹${cost}`;
  document.getElementById("status").innerText = "Creating order...";
  document.getElementById("startPaymentBtn").style.display = "none";

  //call backend to create order
  const res = await fetch(`${BACKEND}/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: cost, timeMs: timeRequired })
  });
  const data = await res.json();

  if (data.error) {
    document.getElementById("status").innerText = "❌ " + data.error;
    return;
  }

  currentOrderId = data.orderId;
  document.getElementById("status").innerText = "Order created. Opening payment window...";

  //open Razorpay payment checkout
  const options = {
    key: data.razorpayKey,
    amount: Math.round(cost * 100),
    currency: "INR",
    name: "EV Charging",
    description: "EV Charging Payment",
    order_id: data.orderId,
    handler: function (response) {
      document.getElementById("status").innerText = "✅ Payment complete. Verifying...";
      pollPaymentStatus(data.orderId);
    },
    modal: {
      ondismiss: function () {
        document.getElementById("status").innerText = "Payment cancelled.";
      }
    }
  };

  const rzp = new Razorpay(options);
  rzp.open();
}

// Poll backend to check payment status
async function pollPaymentStatus(orderId, attempt = 0) {
  const maxTries = 60;
  const res = await fetch(`${BACKEND}/check-status/${orderId}`);
  const data = await res.json();

  if (data.paid) {
    document.getElementById("status").innerText = "✅ Payment verified. Charging started automatically.";
    return;
  }

  if (attempt < maxTries) {
    setTimeout(() => pollPaymentStatus(orderId, attempt + 1), 5000);
  } else {
    document.getElementById("status").innerText = "❌ Payment verification timeout.";
  }
}
