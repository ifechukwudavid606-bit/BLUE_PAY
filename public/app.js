const $ = id => document.getElementById(id);

let authMode = "signup";
let adminLoggedIn = false;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin"
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}

function post(url, body = {}) {
  return api(url, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function notify(message, type = "success") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPage(name) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.add("hidden");
  });

  const page = $(name + "Page");
  if (page) page.classList.remove("hidden");

  $("menu").classList.add("hidden");
}

function makeRecord(title, details, actions = []) {
  const record = document.createElement("div");
  record.className = "record";

  const heading = document.createElement("strong");
  heading.textContent = title;
  record.appendChild(heading);

  const text = document.createElement("p");
  text.textContent = details;
  record.appendChild(text);

  actions.forEach(action => {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.className = action.className || "";
    button.addEventListener("click", action.run);
    record.appendChild(button);
  });

  return record;
}

function renderRecords(containerId, items, getTitle, getDetails) {
  const container = $(containerId);
  container.replaceChildren();

  if (!items.length) {
    container.textContent = "No requests yet.";
    return;
  }

  items.forEach(item => {
    container.appendChild(makeRecord(
      getTitle(item),
      getDetails(item)
    ));
  });
}

async function refreshAccount() {
  try {
    const data = await api("/api/me");

    $("accountStatus").textContent =
      `${data.email} · Payment approval: ${data.approved ? "Approved" : "Pending"}`;

    $("logoutButton").classList.remove("hidden");

    renderRecords(
      "paymentsList",
      data.payments,
      p => `Payment · ₦${p.amount}`,
      p => `Reference: ${p.reference} | Status: ${p.status}`
    );

    renderRecords(
      "withdrawalsList",
      data.withdrawals,
      w => `Withdrawal · ₦${w.amount}`,
      w => `Status: ${w.status} | Request ID: ${w.id}`
    );
  } catch {
    $("accountStatus").textContent = "You are not logged in.";
    $("logoutButton").classList.add("hidden");
    $("paymentsList").textContent = "Log in to view your requests.";
    $("withdrawalsList").textContent = "Log in to view your requests.";
  }
}

$("menuButton").addEventListener("click", () => {
  $("menu").classList.toggle("hidden");
});

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

$("switchAuth").addEventListener("click", () => {
  authMode = authMode === "signup" ? "login" : "signup";
  $("authTitle").textContent =
    authMode === "signup" ? "Create account" : "Log in";
  $("authSubmit").textContent =
    authMode === "signup" ? "Sign up" : "Log in";
  $("switchAuth").textContent =
    authMode === "signup"
      ? "Already registered? Log in"
      : "Need an account? Sign up";
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await post(
      authMode === "signup" ? "/api/signup" : "/api/login",
      {
        email: $("email").value,
        password: $("password").value
      }
    );

    $("password").value = "";
    notify(result.message);
    await refreshAccount();
    showPage("account");
  } catch (error) {
    notify(error.message, "error");
  }
});

$("logoutButton").addEventListener("click", async () => {
  try {
    await post("/api/logout");
    $("withdrawFields").classList.add("hidden");
    notify("You have logged out.");
    await refreshAccount();
    showPage("account");
  } catch (error) {
    notify(error.message, "error");
  }
});

$("refreshButton").addEventListener("click", refreshAccount);

$("paymentForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await post("/api/payment", {
      amount: $("paymentAmount").value,
      reference: $("paymentReference").value
    });

    $("paymentForm").reset();
    notify(result.message);
    await refreshAccount();
  } catch (error) {
    notify(error.message, "error");
  }
});

$("bpcForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await post("/api/verify-bpc", {
      code: $("bpcCode").value
    });

    $("bpcCode").value = "";
    $("withdrawFields").classList.remove("hidden");
    notify(result.message);
  } catch (error) {
    $("withdrawFields").classList.add("hidden");
    notify(error.message, "error");
  }
});

$("withdrawForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await post("/api/withdrawal", {
      amount: $("withdrawAmount").value,
      method: $("withdrawMethod").value,
      account: $("withdrawAccount").value
    });

    $("withdrawForm").reset();
    $("withdrawFields").classList.add("hidden");
    notify(result.message);
    await refreshAccount();
  } catch (error) {
    notify(error.message, "error");
  }
});

$("adminToggle").addEventListener("click", () => {
  showPage("admin");
});

$("adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await post("/api/admin/login", {
      key: $("adminKey").value
    });

    $("adminKey").value = "";
    adminLoggedIn = true;
    $("adminDashboard").classList.remove("hidden");
    notify("Admin login successful.");
    await refreshAdmin();
  } catch (error) {
    notify(error.message, "error");
  }
});

async function adminAction(url, body) {
  try {
    const result = await post(url, body);
    notify(result.message);
    await refreshAdmin();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function refreshAdmin() {
  try {
    const data = await api("/api/admin/data");
    adminLoggedIn = true;
    $("adminDashboard").classList.remove("hidden");

    const payments = $("adminPayments");
    payments.replaceChildren();

    data.payments.forEach(payment => {
      const user = data.users.find(u => u.id === payment.userId);
      const title = `₦${payment.amount} · ${payment.status}`;

      const record = makeRecord(
        title,
        `Customer: ${user ? user.email : "Unknown"} | Reference: ${payment.reference}`,
        [
          {
            label: "Approve",
            run: () => adminAction(
              `/api/admin/payment/${payment.id}`,
              { status: "approved" }
            )
          },
          {
            label: "Decline",
            run: () => adminAction(
              `/api/admin/payment/${payment.id}`,
              { status: "declined" }
            )
          }
        ]
      );

      payments.appendChild(record);
    });

    const users = $("adminUsers");
    users.replaceChildren();

    data.users.forEach(user => {
      const record = makeRecord(
        user.email,
        `Approved: ${user.approved} | BPC issued: ${user.hasBpc}`,
        [
          {
            label: "Issue new BPC",
            run: async () => {
              try {
                const result = await post(
                  `/api/admin/issue-bpc/${user.id}`
                );

                const code = result.code;
                const codeBox = document.createElement("div");
                codeBox.className = "record";

                const message = document.createElement("p");
                message.textContent =
                  "Copy this new code now. It will not be shown again:";
                codeBox.appendChild(message);

                const codeText = document.createElement("strong");
                codeText.textContent = code;
                codeBox.appendChild(codeText);

                const copy = document.createElement("button");
                copy.textContent = "Copy BPC";
                copy.addEventListener("click", async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                    notify("BPC copied.");
                  } catch {
                    notify("Select and copy the code manually.", "error");
                  }
                });
                codeBox.appendChild(copy);

                record.appendChild(codeBox);
                notify(result.message);
              } catch (error) {
                notify(error.message, "error");
              }
            }
          }
        ]
      );

      users.appendChild(record);
    });

    const withdrawals = $("adminWithdrawals");
    withdrawals.replaceChildren();

    data.withdrawals.forEach(withdrawal => {
      const user = data.users.find(u => u.id === withdrawal.userId);

      withdrawals.appendChild(makeRecord(
        `₦${withdrawal.amount} · ${withdrawal.status}`,
        `Customer: ${user ? user.email : "Unknown"} | Method: ${withdrawal.method} | Details: ${withdrawal.account}`,
        [
          {
            label: "Approve",
            run: () => adminAction(
              `/api/admin/withdrawal/${withdrawal.id}`,
              { status: "approved" }
            )
          },
          {
            label: "Mark paid",
            run: () => adminAction(
              `/api/admin/withdrawal/${withdrawal.id}`,
              { status: "paid" }
            )
          },
          {
            label: "Decline",
            run: () => adminAction(
              `/api/admin/withdrawal/${withdrawal.id}`,
              { status: "declined" }
            )
          }
        ]
      ));
    });
  } catch (error) {
    adminLoggedIn = false;
    $("adminDashboard").classList.add("hidden");
    notify(error.message, "error");
  }
}

$("clearDisplayButton").addEventListener("click", refreshAdmin);

$("adminLogout").addEventListener("click", async () => {
  try {
    await post("/api/admin/logout");
    adminLoggedIn = false;
    $("adminDashboard").classList.add("hidden");
    notify("Admin logged out.");
  } catch (error) {
    notify(error.message, "error");
  }
});

refreshAccount();
showPage("home");
