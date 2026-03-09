const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
let cachedTransporter = null;

function hasRawSmtpConfig() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function hasBrevoConfig() {
  return !!process.env.BREVO_API_KEY;
}

function hasResendConfig() {
  return !!process.env.RESEND_API_KEY;
}

function hasEmailConfig() {
  return hasBrevoConfig() || hasResendConfig() || hasRawSmtpConfig();
}

function hasSmtpConfig() {
  // Kept for backward compatibility with existing callers in server/index.js.
  // Returns true when any email provider is configured.
  return hasEmailConfig();
}

function getFromAddress() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || "My Farms <no-reply@example.com>";
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 3),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 30000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 15000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 60000),
    tls: {
      rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") !== "false"
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function getTransporter() {
  if (!hasRawSmtpConfig()) return null;
  if (!cachedTransporter) {
    cachedTransporter = createTransporter();
  }
  return cachedTransporter;
}

function isTransientSmtpError(err) {
  const msg = String((err && err.message) || "").toUpperCase();
  const code = String((err && err.code) || "").toUpperCase();
  return (
    code === "ECONNRESET" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    msg.includes("ECONNRESET") ||
    msg.includes("ESOCKET") ||
    msg.includes("ECONNECTION") ||
    msg.includes("CONNECTION CLOSED") ||
    msg.includes("SOCKET HANG UP") ||
    msg.includes("TIMED OUT")
  );
}

function invalidateTransporter() {
  if (!cachedTransporter) return;
  try {
    cachedTransporter.close();
  } catch {
    // Ignore close errors; transporter will be recreated.
  }
  cachedTransporter = null;
}

async function sendWithRetry(transporter, mailOptions, retries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await transporter.sendMail(mailOptions);
    } catch (err) {
      if (attempt >= retries || !isTransientSmtpError(err)) throw err;
      attempt += 1;
      invalidateTransporter();
      transporter = getTransporter();
      const backoffMs = Math.min(5000, 800 * attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

function parseRecipients(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((v) => parseRecipients(v));
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveLogoUrl() {
  const explicit = String(process.env.EMAIL_LOGO_URL || "").trim();
  if (explicit) return explicit;
  const base = String(process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/resources/mailimage.png` : "";
}

function normalizeHtmlForApi(html) {
  const raw = String(html || "");
  if (!raw) return raw;
  const logoUrl = resolveLogoUrl();
  if (!logoUrl) {
    return raw.replace(/<img[^>]*cid:myfarms-logo[^>]*>/gi, "");
  }
  return raw.replace(/cid:myfarms-logo/gi, logoUrl);
}

async function sendViaResend(mailOptions) {
  const to = parseRecipients(mailOptions.to);
  if (!to.length) return;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: mailOptions.from || getFromAddress(),
      to,
      subject: mailOptions.subject || "",
      text: mailOptions.text || "",
      html: normalizeHtmlForApi(mailOptions.html || "")
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(`Resend API error (${response.status}): ${body || response.statusText}`);
    err.status = response.status;
    throw err;
  }
}

async function sendViaBrevo(mailOptions) {
  const to = parseRecipients(mailOptions.to).map((email) => ({ email }));
  if (!to.length) return;

  const fromRaw = String(mailOptions.from || getFromAddress());
  const fromMatch = fromRaw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  const sender = fromMatch
    ? { name: String(fromMatch[1] || "").trim() || "My Farms", email: String(fromMatch[2] || "").trim() }
    : { name: "My Farms", email: fromRaw.trim() };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      sender,
      to,
      subject: mailOptions.subject || "",
      textContent: mailOptions.text || "",
      htmlContent: normalizeHtmlForApi(mailOptions.html || "")
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(`Brevo API error (${response.status}): ${body || response.statusText}`);
    err.status = response.status;
    throw err;
  }
}

function isTransientBrevoError(err) {
  const status = Number(err && err.status);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String((err && err.message) || "").toUpperCase();
  return msg.includes("TIMED OUT") || msg.includes("ECONNRESET") || msg.includes("FETCH FAILED");
}

function isTransientResendError(err) {
  const status = Number(err && err.status);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String((err && err.message) || "").toUpperCase();
  return msg.includes("TIMED OUT") || msg.includes("ECONNRESET") || msg.includes("FETCH FAILED");
}

async function sendMailWithProvider(mailOptions, retries = 3) {
  if (hasBrevoConfig()) {
    let attempt = 0;
    while (true) {
      try {
        await sendViaBrevo(mailOptions);
        return;
      } catch (err) {
        if (attempt >= retries || !isTransientBrevoError(err)) throw err;
        attempt += 1;
        const backoffMs = Math.min(5000, 800 * attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  if (hasResendConfig()) {
    let attempt = 0;
    while (true) {
      try {
        await sendViaResend(mailOptions);
        return;
      } catch (err) {
        if (attempt >= retries || !isTransientResendError(err)) throw err;
        attempt += 1;
        const backoffMs = Math.min(5000, 800 * attempt);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  const transporter = getTransporter();
  if (!transporter) {
    throw new Error("No email provider configured");
  }
  await sendWithRetry(transporter, mailOptions, retries);
}

function getLogoAttachment() {
  const candidates = [
    path.join(__dirname, "..", "src", "main", "resources", "mailimage.png"),
    path.join(__dirname, "..", "public", "mailimage.png"),
    path.join(__dirname, "..", "public", "myfarmslogo.png"),
    path.join(__dirname, "..", "src", "main", "resources", "myfarmslogo.png")
  ];
  const logoPath = candidates.find((p) => fs.existsSync(p));
  if (!logoPath) return [];

  return [
    {
      filename: "myfarmslogo.png",
      path: logoPath,
      cid: "myfarms-logo"
    }
  ];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makeEmailLayout({ heading, introHtml, bodyHtml, closing }) {
  return `
  <div style="background:#f6f8f2;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif;color:#203126;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e0e8d7;border-radius:14px;overflow:hidden;">
      <div style="background:linear-gradient(90deg,#f3f8ea 0%,#eef6e0 100%);padding:18px 22px;border-bottom:1px solid #e0e8d7;">
        <div style="font-size:24px;font-weight:800;letter-spacing:0.2px;color:#0f5a2c;">My Farms</div>
        <div style="font-size:13px;color:#44634b;margin-top:3px;">Farm to home - fresh and natural</div>
      </div>
      <div style="padding:22px;">
        <h2 style="margin:0 0 12px 0;font-size:23px;line-height:1.3;color:#1f3827;">${heading}</h2>
        <div style="font-size:15px;line-height:1.65;color:#2d3f33;">${introHtml}</div>
        <div style="margin-top:14px;">${bodyHtml}</div>
        <p style="margin:18px 0 0 0;font-size:15px;line-height:1.6;color:#2d3f33;">${closing}</p>
      </div>
      <div style="padding:16px 22px;border-top:1px solid #e7eddc;background:#fbfdf7;text-align:center;">
        <img src="cid:myfarms-logo" alt="My Farms" style="height:58px;width:auto;display:block;margin:0 auto 8px auto;" />
        <div style="font-size:12px;color:#5f6f60;">Thank you for choosing My Farms.</div>
      </div>
    </div>
  </div>
  `;
}

async function sendOrderEmail(orderPayload) {
  const ownerEmailRaw = process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || "";
  const ownerEmails = ownerEmailRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!ownerEmails.length) {
    console.log("OWNER_EMAIL/ADMIN_EMAIL not set. Skipping owner email notification.");
    return;
  }

  const subject = `New My Farms Order #${orderPayload.orderId}`;
  const lines = buildOrderLines(orderPayload);
  const html = makeEmailLayout({
    heading: `New Order #${escapeHtml(orderPayload.orderId)}`,
    introHtml: `A new customer order has been placed and is ready for processing.`,
    bodyHtml: buildOrderDetailsHtml(orderPayload, { showCustomer: true }),
    closing: "Please review the order and update status from the admin panel."
  });

  if (!hasEmailConfig()) {
    console.log("Email provider config missing. Email content below:");
    console.log(lines.join("\n"));
    return;
  }

  await sendMailWithProvider({
    from: getFromAddress(),
    to: ownerEmails.join(","),
    subject,
    text: lines.join("\n"),
    html,
    attachments: getLogoAttachment()
  });
}

function buildOrderLines(orderPayload) {
  const lines = [
    `Order ID: ${orderPayload.orderId}`,
    `Customer: ${orderPayload.customerName}`,
    `Email: ${orderPayload.customerEmail}`,
    `Phone: ${orderPayload.customerPhone}`,
    `Payment Method: ${orderPayload.paymentMethod}`,
    `Delivery Address: ${orderPayload.address}`,
    "",
    "Items:"
  ];

  orderPayload.items.forEach((item) => {
    lines.push(`- ${item.name}${item.variant ? ` (${item.variant})` : ""} x ${item.quantity} = Rs.${item.subtotal}`);
  });

  lines.push("", `Subtotal: Rs.${Number(orderPayload.subtotalAmount || 0).toFixed(2)}`);
  if (Number(orderPayload.discountAmount || 0) > 0) {
    lines.push(`Promo (${orderPayload.promoCode || "MYFARMS10"}): -Rs.${Number(orderPayload.discountAmount).toFixed(2)}`);
  }
  lines.push(`Tax (5%): Rs.${Number(orderPayload.taxAmount || 0).toFixed(2)}`);
  lines.push(`Tip: Rs.${Number(orderPayload.tipAmount || 0).toFixed(2)}`);
  lines.push(`Total: Rs.${orderPayload.totalAmount}`);
  return lines;
}

function buildOrderDetailsHtml(orderPayload, { showCustomer }) {
  const itemRows = (orderPayload.items || [])
    .map(
      (item) => `
      <tr>
        <td style="padding:9px 10px;border-bottom:1px solid #eef2e8;">${escapeHtml(item.name)}${
          item.variant ? ` (${escapeHtml(item.variant)})` : ""
        }</td>
        <td style="padding:9px 10px;border-bottom:1px solid #eef2e8;text-align:center;">${escapeHtml(item.quantity)}</td>
        <td style="padding:9px 10px;border-bottom:1px solid #eef2e8;text-align:right;">Rs.${escapeHtml(item.subtotal)}</td>
      </tr>
    `
    )
    .join("");

  const customerHtml = showCustomer
    ? `
      <p style="margin:0 0 6px 0;"><strong>Customer:</strong> ${escapeHtml(orderPayload.customerName)}</p>
      <p style="margin:0 0 6px 0;"><strong>Email:</strong> ${escapeHtml(orderPayload.customerEmail)}</p>
      <p style="margin:0 0 10px 0;"><strong>Phone:</strong> ${escapeHtml(orderPayload.customerPhone)}</p>
    `
    : "";

  return `
    <div style="border:1px solid #e8eedf;border-radius:10px;padding:14px;background:#fcfef9;">
      ${customerHtml}
      <p style="margin:0 0 6px 0;"><strong>Payment:</strong> ${escapeHtml(orderPayload.paymentMethod)}</p>
      <p style="margin:0 0 12px 0;"><strong>Delivery Address:</strong> ${escapeHtml(orderPayload.address)}</p>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e7eddc;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f4f9ec;">
            <th style="text-align:left;padding:10px;font-size:13px;">Item</th>
            <th style="text-align:center;padding:10px;font-size:13px;">Qty</th>
            <th style="text-align:right;padding:10px;font-size:13px;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="margin-top:10px;text-align:right;color:#2a3f2d;font-size:14px;">
        <div>Subtotal: Rs.${escapeHtml(Number(orderPayload.subtotalAmount || 0).toFixed(2))}</div>
        ${
          Number(orderPayload.discountAmount || 0) > 0
            ? `<div>Promo (${escapeHtml(orderPayload.promoCode || "MYFARMS10")}): -Rs.${escapeHtml(
                Number(orderPayload.discountAmount).toFixed(2)
              )}</div>`
            : ""
        }
        <div>Tax (5%): Rs.${escapeHtml(Number(orderPayload.taxAmount || 0).toFixed(2))}</div>
        <div>Tip: Rs.${escapeHtml(Number(orderPayload.tipAmount || 0).toFixed(2))}</div>
      </div>
      <div style="margin-top:10px;text-align:right;font-size:17px;font-weight:800;color:#17341f;">
        Total: Rs.${escapeHtml(orderPayload.totalAmount)}
      </div>
    </div>
  `;
}

async function sendCustomerOrderEmail(orderPayload) {
  const customerEmail = orderPayload.customerEmail;

  if (!customerEmail) {
    return;
  }

  const subject = `My Farms Order Confirmation #${orderPayload.orderId}`;
  const lines = [
    `Hi ${orderPayload.customerName},`,
    "",
    "Thank you for your order with My Farms. Your order is confirmed.",
    "",
    ...buildOrderLines(orderPayload),
    "",
    "You will receive status updates (out for delivery, delivered) on this email."
  ];
  const html = makeEmailLayout({
    heading: `Order Confirmed #${escapeHtml(orderPayload.orderId)}`,
    introHtml: `Hi <strong>${escapeHtml(orderPayload.customerName)}</strong>, your order has been confirmed successfully.`,
    bodyHtml: buildOrderDetailsHtml(orderPayload, { showCustomer: false }),
    closing: "You will receive delivery status updates on this email. Thank you for shopping with us."
  });

  if (!hasEmailConfig()) {
    console.log(`Email provider config missing. Customer order email not sent to ${customerEmail}.`);
    console.log(lines.join("\n"));
    return;
  }

  await sendMailWithProvider({
    from: getFromAddress(),
    to: customerEmail,
    subject,
    text: lines.join("\n"),
    html,
    attachments: getLogoAttachment()
  });
}

async function sendPasswordResetEmail({ toEmail, resetLink, tokenForDev }) {
  const subject = "My Farms Password Reset";
  const text = [
    "You requested a password reset for your My Farms account.",
    `Reset link: ${resetLink}`,
    "This link expires in 15 minutes.",
    "If you did not request this, ignore this email."
  ].join("\n");
  const html = makeEmailLayout({
    heading: "Password Reset Request",
    introHtml:
      "You requested to reset your My Farms account password. Click the button below to continue.",
    bodyHtml: `
      <div style="text-align:center;padding:10px 0;">
        <a href="${escapeHtml(resetLink)}" style="display:inline-block;background:#2f7a45;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;">Reset Password</a>
      </div>
      <p style="margin:10px 0 0 0;font-size:13px;color:#58695c;word-break:break-all;">If button does not work, use this link: ${escapeHtml(
        resetLink
      )}</p>
      <p style="margin:10px 0 0 0;font-size:13px;color:#58695c;">This link will expire in 15 minutes.</p>
    `,
    closing: "If you did not request this, you can safely ignore this email."
  });

  if (!hasEmailConfig()) {
    console.log(`Password reset requested for ${toEmail}.`);
    console.log(`Reset link: ${resetLink}`);
    console.log(`Reset token (dev): ${tokenForDev}`);
    return;
  }

  await sendMailWithProvider({
    from: getFromAddress(),
    to: toEmail,
    subject,
    text,
    html,
    attachments: getLogoAttachment()
  });
}

async function sendOrderStatusEmail({ toEmail, customerName, orderId, status, cancelNote }) {
  if (!toEmail) return;

  const statusLabel =
    status === "OUT_FOR_DELIVERY"
      ? "Out for Delivery"
      : status === "ORDER_READY_FOR_PICKUP"
        ? "Order Ready for Pickup"
      : status === "CANCELED"
        ? "Canceled"
      : status === "DELIVERED"
        ? "Delivered"
        : status;

  const subject = `My Farms Order #${orderId} - ${statusLabel}`;
  const text = [
    `Hi ${customerName || "Customer"},`,
    "",
    `Your order #${orderId} status is now: ${statusLabel}.`,
    "",
    status === "OUT_FOR_DELIVERY"
      ? "Your order is on the way and will reach you soon."
      : status === "DELIVERED"
        ? "Your order has been delivered. Thank you for shopping with My Farms."
        : "Please check your account for latest updates.",
    "",
    "My Farms Team"
  ].join("\n");
  const statusMessage =
    status === "OUT_FOR_DELIVERY"
      ? "Good news! Your order is out for delivery and will reach you soon."
      : status === "ORDER_READY_FOR_PICKUP"
        ? "Your order is packed and ready for pickup. Please collect it at your selected location."
      : status === "CANCELED"
        ? `Your order has been canceled.${cancelNote ? ` Reason: ${cancelNote}` : ""}`
      : status === "DELIVERED"
        ? "Your order has been delivered successfully. We hope you enjoy our fresh products."
        : `Your order status is now: ${statusLabel}.`;
  const html = makeEmailLayout({
    heading: `Order Update - ${escapeHtml(statusLabel)}`,
    introHtml: `Hi <strong>${escapeHtml(customerName || "Customer")}</strong>, ${escapeHtml(statusMessage)}`,
    bodyHtml: `
      <div style="border:1px solid #e8eedf;border-radius:10px;padding:14px;background:#fcfef9;">
        <p style="margin:0 0 8px 0;"><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>
        <p style="margin:0;"><strong>Current Status:</strong> ${escapeHtml(statusLabel)}</p>
      </div>
    `,
    closing: "Thank you for trusting My Farms for your fresh groceries."
  });

  if (!hasEmailConfig()) {
    console.log(`Email provider config missing. Status email not sent to ${toEmail}.`);
    console.log(text);
    return;
  }

  await sendMailWithProvider({
    from: getFromAddress(),
    to: toEmail,
    subject,
    text,
    html,
    attachments: getLogoAttachment()
  });
}

async function sendComplaintCreatedEmails({ complaintId, orderNumber, issue, customerName, customerEmail }) {
  const ownerEmail = process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL;
  const ticketId = String(complaintId || "").slice(-6).toUpperCase();
  const safeOrderNumber = String(orderNumber || "").trim() || "N/A";

  const ownerSubject = `Complaint Received #${ticketId} | Order ${safeOrderNumber}`;
  const ownerText = [
    "New customer complaint received.",
    `Ticket: ${ticketId}`,
    `Order Number: ${safeOrderNumber}`,
    `Customer: ${customerName}`,
    `Email: ${customerEmail}`,
    "",
    "Issue:",
    issue
  ].join("\n");
  const ownerHtml = makeEmailLayout({
    heading: `Customer Complaint #${escapeHtml(ticketId)}`,
    introHtml: "A customer reported an order issue.",
    bodyHtml: `
      <div style="border:1px solid #e8eedf;border-radius:10px;padding:14px;background:#fcfef9;">
        <p style="margin:0 0 8px 0;"><strong>Order Number:</strong> ${escapeHtml(safeOrderNumber)}</p>
        <p style="margin:0 0 8px 0;"><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
        <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
        <p style="margin:0;"><strong>Issue:</strong><br/>${escapeHtml(issue)}</p>
      </div>
    `,
    closing: "Please review this complaint from the admin portal."
  });

  const customerSubject = `Complaint Received - Ticket #${ticketId}`;
  const customerText = [
    `Hi ${customerName},`,
    "",
    `Your complaint has been received for order ${safeOrderNumber}.`,
    `Ticket ID: ${ticketId}`,
    "",
    "Issue reported to customer representative. We will respond very shortly.",
    "",
    "My Farms Team"
  ].join("\n");
  const customerHtml = makeEmailLayout({
    heading: `Complaint Received #${escapeHtml(ticketId)}`,
    introHtml: `Hi <strong>${escapeHtml(customerName)}</strong>, we received your issue report.`,
    bodyHtml: `
      <div style="border:1px solid #e8eedf;border-radius:10px;padding:14px;background:#fcfef9;">
        <p style="margin:0 0 8px 0;"><strong>Order Number:</strong> ${escapeHtml(safeOrderNumber)}</p>
        <p style="margin:0 0 8px 0;"><strong>Ticket ID:</strong> ${escapeHtml(ticketId)}</p>
        <p style="margin:0;"><strong>Issue:</strong><br/>${escapeHtml(issue)}</p>
      </div>
    `,
    closing: "Issue reported to customer representative and we will respond very shortly."
  });

  if (!hasEmailConfig()) {
    console.log("Email provider config missing. Complaint emails not sent.");
    if (ownerEmail) console.log(`Owner email preview:\n${ownerText}`);
    console.log(`Customer email preview (${customerEmail}):\n${customerText}`);
    return;
  }

  const jobs = [];
  if (ownerEmail) {
    jobs.push(
      sendMailWithProvider({
        from: getFromAddress(),
        to: ownerEmail,
        subject: ownerSubject,
        text: ownerText,
        html: ownerHtml,
        attachments: getLogoAttachment()
      })
    );
  }
  jobs.push(
    sendMailWithProvider({
      from: getFromAddress(),
      to: customerEmail,
      subject: customerSubject,
      text: customerText,
      html: customerHtml,
      attachments: getLogoAttachment()
    })
  );

  await Promise.all(jobs);
}

async function sendComplaintClosedEmail({ toEmail, customerName, complaintId, orderNumber, closingNote }) {
  if (!toEmail) return;
  const ticketId = String(complaintId || "").slice(-6).toUpperCase();
  const safeOrderNumber = String(orderNumber || "").trim() || "N/A";
  const subject = `Complaint Closed #${ticketId}`;

  const text = [
    `Hi ${customerName || "Customer"},`,
    "",
    `Your complaint ticket #${ticketId} for order ${safeOrderNumber} has been closed.`,
    "",
    closingNote || "Our support team has reviewed and resolved your issue.",
    "",
    "My Farms Team"
  ].join("\n");

  const html = makeEmailLayout({
    heading: `Complaint Closed #${escapeHtml(ticketId)}`,
    introHtml: `Hi <strong>${escapeHtml(customerName || "Customer")}</strong>, your complaint has been closed.`,
    bodyHtml: `
      <div style="border:1px solid #e8eedf;border-radius:10px;padding:14px;background:#fcfef9;">
        <p style="margin:0 0 8px 0;"><strong>Order Number:</strong> ${escapeHtml(safeOrderNumber)}</p>
        <p style="margin:0 0 8px 0;"><strong>Ticket ID:</strong> ${escapeHtml(ticketId)}</p>
        <p style="margin:0;"><strong>Resolution Note:</strong><br/>${escapeHtml(
          closingNote || "Our support team has reviewed and resolved your issue."
        )}</p>
      </div>
    `,
    closing: "This ticket is now closed. Thank you for your patience."
  });

  if (!hasEmailConfig()) {
    console.log(`Email provider config missing. Complaint closed email not sent to ${toEmail}.`);
    console.log(text);
    return;
  }

  await sendMailWithProvider({
    from: getFromAddress(),
    to: toEmail,
    subject,
    text,
    html,
    attachments: getLogoAttachment()
  });
}

async function sendWelcomeEmail({ toEmail, customerName }) {
  if (!toEmail) return;

  const subject = "Welcome to My Farms";
  const text = [
    `Hi ${customerName || "Customer"},`,
    "",
    "Welcome to My Farms.",
    "Thank you for choosing My Farms for fresh products.",
    "",
    "My Farms Team"
  ].join("\n");
  const html = makeEmailLayout({
    heading: "Welcome to My Farms",
    introHtml: `Hi <strong>${escapeHtml(customerName || "Customer")}</strong>, thank you for creating your account.`,
    bodyHtml: `
      <div style="border:1px solid #e8eedf;border-radius:10px;padding:14px;background:#fcfef9;">
        <p style="margin:0;">Thank you for choosing My Farms. We are excited to deliver fresh farm products to your doorstep.</p>
      </div>
    `,
    closing: "Thank you for choosing My Farms."
  });

  if (!hasEmailConfig()) {
    console.log(`Email provider config missing. Welcome email not sent to ${toEmail}.`);
    return;
  }

  await sendMailWithProvider({
    from: getFromAddress(),
    to: toEmail,
    subject,
    text,
    html,
    attachments: getLogoAttachment()
  });
}

module.exports = {
  sendOrderEmail,
  sendCustomerOrderEmail,
  sendPasswordResetEmail,
  sendOrderStatusEmail,
  sendComplaintCreatedEmails,
  sendComplaintClosedEmail,
  sendWelcomeEmail,
  hasSmtpConfig
};
