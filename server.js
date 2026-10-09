const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_ACCESS_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_KEY || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error("Set ADMIN_ACCESS_KEY and SESSION_SECRET in Render.");
}

app.use(helmet());
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 150 }));

app.use(session({
  name: "bluepay.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 1000
  }
}));

const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "bluepay.json");
fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, JSON.stringify({
    users: [],
    payments: [],
    withdrawals: []
  }, null, 2));
}

function readData() {
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function saveData(data) {
  const temp = dataFile + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, dataFile);
}

function id() {
  return crypto.randomUUID();
}

function hashCode(code) {
  return crypto.createHash("sha256")
    .update(code + SESSION_SECRET)
    .digest("hex");
}

function requireUser(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

app.post("/api/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email." });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: "Password must be 8–128 characters."
      });
    }

    const data = readData();
    if (data.users.some(u => u.email === email)) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const user = {
      id: id(),
      email,
      passwordHash: await bcrypt.hash(password, 12),
      approved: false,
      bpcHash: null,
      createdAt: new Date().toISOString()
    };

    data.users.push(user);
    saveData(data);
    req.session.userId = user.id;

    res.json({ message: "Account created.", email });
  } catch {
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const data = readData();
    const user = data.users.find(u => u.email === email);

    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    req.session.userId = user.id;
    res.json({ message: "Logged in.", email: user.email });
  } catch {
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("bluepay.sid");
    res.json({ message: "Logged out." });
  });
});

app.get("/api/me", requireUser, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "Account not found." });

  res.json({
    email: user.email,
    approved: user.approved,
    payments: data.payments.filter(p => p.userId === user.id)
      .map(({ id, amount, status, reference, createdAt }) =>
        ({ id, amount, status, reference, createdAt })),
    withdrawals: data.withdrawals.filter(w => w.userId === user.id)
      .map(({ id, amount, status, createdAt }) =>
        ({ id, amount, status, createdAt }))
  });
});

app.post("/api/payment", requireUser, (req, res) => {
  const amount = Number(req.body.amount);
  const reference = String(req.body.reference || "").trim();

  if (!Number.isFinite(amount) || amount < 1 || amount > 10000000) {
    return res.status(400).json({ error: "Invalid payment amount." });
  }
  if (reference.length < 4 || reference.length > 100) {
    return res.status(400).json({ error: "Enter your transfer reference." });
  }

  const data = readData();
  const payment = {
    id: id(),
    userId: req.session.userId,
    amount,
    reference,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  data.payments.push(payment);
  saveData(data);
  res.json({ message: "Payment submitted for manual review." });
});

app.post("/api/verify-bpc", requireUser, (req, res) => {
  const code = String(req.body.code || "").trim();
  const data = readData();
  const user = data.users.find(u => u.id === req.session.userId);

  if (!user || !user.approved || !user.bpcHash ||
      !crypto.timingSafeEqual(
        Buffer.from(hashCode(code)),
        Buffer.from(user.bpcHash)
      )) {
    return res.status(403).json({ error: "Invalid code or account not approved." });
  }

  req.session.bpcVerifiedAt = Date.now();
  res.json({ message: "Code verified. You may submit a withdrawal request." });
});

app.post("/api/withdrawal", requireUser, (req, res) => {
  if (!req.session.bpcVerifiedAt ||
      Date.now() - req.session.bpcVerifiedAt > 5 * 60 * 1000) {
    return res.status(403).json({ error: "Verify your BPC code first." });
  }

  const amount = Number(req.body.amount);
  const method = String(req.body.method || "");
  const account = String(req.body.account || "").trim();

  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    return res.status(400).json({ error: "Invalid amount." });
  }
  if (!["bank", "paypal"].includes(method) || account.length < 3 || account.length > 200) {
    return res.status(400).json({ error: "Enter valid payout details." });
  }

  const data = readData();
  const user = data.users.find(u => u.id === req.session.userId);

  if (!user || !user.approved) {
    return res.status(403).json({ error: "Account is not approved." });
  }

  data.withdrawals.push({
    id: id(),
    userId: user.id,
    amount,
    method,
    account,
    status: "pending",
    createdAt: new Date().toISOString()
  });

  saveData(data);
  req.session.bpcVerifiedAt = null;
  res.json({ message: "Withdrawal request submitted for review." });
});

app.post("/api/admin/login", (req, res) => {
  const key = String(req.body.key || "");
  const a = Buffer.from(key);
  const b = Buffer.from(ADMIN_KEY);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid admin key." });
  }

  req.session.isAdmin = true;
  res.json({ message: "Admin logged in." });
});

app.get("/api/admin/data", requireAdmin, (req, res) => {
  const data = readData();
  res.json({
    users: data.users.map(u => ({
      id: u.id,
      email: u.email,
      approved: u.approved,
      hasBpc: Boolean(u.bpcHash),
      createdAt: u.createdAt
    })),
    payments: data.payments,
    withdrawals: data.withdrawals
  });
});

app.post("/api/admin/payment/:id", requireAdmin, (req, res) => {
  const status = String(req.body.status || "");
  if (!["approved", "declined"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const data = readData();
  const payment = data.payments.find(p => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found." });

  payment.status = status;
  if (status === "approved") {
    const user = data.users.find(u => u.id === payment.userId);
    if (user) user.approved = true;
  }
  saveData(data);
  res.json({ message: `Payment ${status}.` });
});

app.post("/api/admin/issue-bpc/:userId", requireAdmin, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.params.userId);

  if (!user || !user.approved) {
    return res.status(400).json({ error: "Approve the user's payment first." });
  }

  const code = crypto.randomBytes(8).toString("hex").toUpperCase();
  user.bpcHash = hashCode(code);
  saveData(data);

  res.json({
    message: "New BPC code issued. Copy it now; it will not be shown again.",
    code
  });
});

app.post("/api/admin/withdrawal/:id", requireAdmin, (req, res) => {
  const status = String(req.body.status || "");
  if (!["approved", "declined", "paid"].includes(status)) {
    return res.status(400).json({ error: "Invalid withdrawal status." });
  }

  const data = readData();
  const withdrawal = data.withdrawals.find(w => w.id === req.params.id);
  if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found." });

  withdrawal.status = status;
  saveData(data);
  res.json({ message: `Withdrawal marked ${status}.` });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.isAdmin = false;
  res.json({ message: "Admin logged out." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`BLUEPAY running on port ${PORT}`);
});
