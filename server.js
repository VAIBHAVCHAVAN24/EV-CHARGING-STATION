// server.js
// Node.js + Express sample using Razorpay (sandbox/dev) to create orders & verify webhook.
// Replace placeholder env vars with your real values before use.

import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || "XYZ_RAZORPAY_KEY_ID";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "XYZ_RAZORPAY_KEY_SECRET";
const RZP_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "XYZ_WEBHOOK_SECRET";
const ESP32_IP = process.env.ESP32_IP || "192.168.1.45";

const razorpay = new Razorpay({
  key_id: RZP_KEY_ID,
  key_secret: RZP_KEY_SECRET,
});

// In-memory store for demo (replace with DB in production)
const ordersStore = {}; // { orderId: { amount, timeMs, paid: bool, razorpayOrderId } }

// Create order endpoint
app.post("/create-order", async (req, res) => {
  try {
    const { amount, timeMs, currency = "INR" } = req.body;
    if (!amount || !timeMs) return res.status(400).json({ error: "Missing amount/timeMs" });

    // Razorpay amount is in paise
    const options = {
      amount: Math.round(amount * 100), // ₹ -> pase
      currency,
      receipt: `rcpt_${Date.now()}`,
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    // Save in in-memory store
    ordersStore[order.id] = { amount, timeMs, paid: false, razorpayOrderId: order.id };

    return res.json({
      orderId: order.id,
      amount,
      timeMs,
      razorpayKey: RZP_KEY_ID,
    });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ error: "server_error", details: err.message });
  }
});

// Check status endpoint (frontend polling)
app.get("/check-status/:orderId", (req, res) => {
  const orderId = req.params.orderId;
  const order = ordersStore[orderId];
  if (!order) return res.status(404).json({ error: "order_not_found" });
  res.json({ paid: !!order.paid, order });
});

// Webhook endpoint (called by Razorpay on payment events)
app.post("/webhook", (req, res) => {
  const signature = req.headers["x-razorpay-signature"] || "";
  const payload = JSON.stringify(req.body);

  // verify signature
  const expected = crypto
    .createHmac("sha256", RZP_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  if (signature !== expected) {
    console.warn("Invalid webhook signature");
    return res.status(400).send("invalid signature");
  }

  // Handle the payload
  const event = req.body;
  // Example: payment.captured OR payment.authorized -> you may adapt per gateway docs
  if (event.event === "payment.captured" || event.event === "payment.authorized") {
    // get razorpay payment entity
    const payment = event.payload.payment.entity;
    const razorOrderId = payment.order_id;
    // mark paid and trigger esp
    if (ordersStore[razorOrderId]) {
      ordersStore[razorOrderId].paid = true;

      // Trigger ESP32 (backend calls ESP32 to avoid client-side reliance)
      const timeMs = ordersStore[razorOrderId].timeMs;
      triggerESP(razorOrderId, timeMs)
        .then(() => {
          console.log(`Triggered ESP32 for order ${razorOrderId}`);
        })
        .catch((err) => {
          console.error("Error triggering ESP32:", err);
        });
    } else {
      console.warn("Order not found in store for razorOrderId:", razorOrderId);
    }
  }

  res.status(200).send("ok");
});

async function triggerESP(orderId, timeMs) {
  // call esp32 endpoint
  const url = `http://${ESP32_IP}/start?time=${timeMs}&order=${orderId}`;
  console.log("Calling ESP32:", url);
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  console.log("ESP32 response:", text);
  return text;
}

// For convenience: endpoint to manually trigger ESP (admin)
app.post("/trigger-esp", async (req, res) => {
  const { orderId } = req.body;
  const order = ordersStore[orderId];
  if (!order) return res.status(404).json({ error: "order_not_found" });
  try {
    const result = await triggerESP(orderId, order.timeMs);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error("trigger-esp error:", err);
    return res.status(500).json({ error: "esp_error", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});
