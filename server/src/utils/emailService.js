import nodemailer from "nodemailer";

/**
 * Finora Email Service
 *
 * Required environment variables:
 * SMTP_HOST=smtp.gmail.com
 * SMTP_PORT=465
 * SMTP_SECURE=true
 * SMTP_USER=your-email@gmail.com
 * SMTP_PASS=your-google-app-password
 * EMAIL_FROM=Finora <your-email@gmail.com>
 */

let transporter;

/* -------------------------------------------------------------------------- */
/*                              Helper Functions                              */
/* -------------------------------------------------------------------------- */

/**
 * Escape HTML to prevent HTML injection in email templates.
 */
const escapeHtml = (value = "") => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

/**
 * Format amounts using the project's INR (₹) currency.
 */
const formatCurrency = (amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value)) {
    return "₹0.00";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(value);
};

/**
 * Format a date for email display.
 */
const formatDate = (date) => {
  if (!date) return "Not specified";

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Not specified";
  }

  return parsedDate.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

/**
 * Get a configured SMTP transporter.
 * The transporter is created only once and reused.
 */
const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  const { SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT, SMTP_SECURE } =
    process.env;

  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error(
      "Email configuration missing. Check SMTP_USER and SMTP_PASS.",
    );
  }

  const isGmail = !SMTP_HOST || SMTP_HOST.includes("gmail");

  transporter = nodemailer.createTransport(
    isGmail
      ? {
          service: "gmail",
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
          },
          connectionTimeout: 10000, // 10s max
          greetingTimeout: 10000,
          socketTimeout: 15000,
        }
      : {
          host: SMTP_HOST,
          port: Number(SMTP_PORT || 587),
          secure: SMTP_SECURE === "true",
          auth: {
            user: SMTP_USER,
            pass: SMTP_PASS,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        },
  );

  return transporter;
};

/* -------------------------------------------------------------------------- */
/*                             Email HTML Template                            */
/* -------------------------------------------------------------------------- */

const createEmailTemplate = ({
  title,
  greeting = "Hello!",
  message,
  details = [],
  footerMessage = "Thank you for using Finora.",
}) => {
  const detailsHtml = details.length
    ? `
      <div style="
        margin-top: 24px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        overflow: hidden;
      ">
        ${details
          .map(
            ({ label, value }) => `
              <div style="
                display: flex;
                justify-content: space-between;
                gap: 16px;
                padding: 13px 16px;
                border-bottom: 1px solid #e5e7eb;
              ">
                <span style="color: #6b7280;">
                  ${escapeHtml(label)}
                </span>
                <strong style="color: #111827; text-align: right;">
                  ${escapeHtml(value)}
                </strong>
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
      </head>

      <body style="
        margin: 0;
        padding: 0;
        background-color: #f3f4f6;
        font-family: Arial, Helvetica, sans-serif;
        color: #111827;
      ">
        <div style="
          max-width: 600px;
          margin: 30px auto;
          padding: 0 16px;
        ">
          <div style="
            background-color: #ffffff;
            border-radius: 14px;
            overflow: hidden;
            border: 1px solid #e5e7eb;
          ">
            <div style="
              background-color: #111827;
              padding: 25px 30px;
              text-align: center;
            ">
              <h1 style="
                margin: 0;
                color: #ffffff;
                font-size: 27px;
                letter-spacing: 1px;
              ">
                Finora
              </h1>

              <p style="
                margin: 8px 0 0;
                color: #d1d5db;
                font-size: 13px;
              ">
                Your personal finance companion
              </p>
            </div>

            <div style="padding: 30px;">
              <h2 style="
                margin: 0 0 18px;
                font-size: 21px;
                color: #111827;
              ">
                ${escapeHtml(title)}
              </h2>

              <p style="
                margin: 0 0 14px;
                font-size: 15px;
                line-height: 1.7;
                color: #374151;
              ">
                ${escapeHtml(greeting)}
              </p>

              <p style="
                margin: 0;
                font-size: 15px;
                line-height: 1.7;
                color: #4b5563;
              ">
                ${escapeHtml(message)}
              </p>

              ${detailsHtml}

              <p style="
                margin: 26px 0 0;
                font-size: 14px;
                line-height: 1.6;
                color: #6b7280;
              ">
                ${escapeHtml(footerMessage)}
              </p>
            </div>

            <div style="
              background-color: #f9fafb;
              border-top: 1px solid #e5e7eb;
              padding: 18px 25px;
              text-align: center;
            ">
              <p style="
                margin: 0;
                font-size: 12px;
                color: #9ca3af;
              ">
                This is an automated notification from Finora.
                Please do not reply to this email.
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};

/* -------------------------------------------------------------------------- */
/*                           Generic Email Function                           */
/* -------------------------------------------------------------------------- */

/**
 * Send an email using the configured SMTP account.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email body
 * @param {string} options.text - Plain text email body
 */

export const sendFinoraEmail = async ({
  to,
  subject,
  heading,
  intro,
  details = [],
  html,
  text,
  attachments = [],
}) => {
  try {
    if (!to || typeof to !== "string") {
      throw new Error("A valid recipient email address is          required.");
    }

    if (!subject) {
      throw new Error("Email subject is required.");
    }

    // Build the HTML template and fallback text
    const emailHtml =
      html ||
      createEmailTemplate({
        title: heading || subject,
        greeting: intro || "Hello!",
        message:
          "Your requested Finora PDF statement is             attached to this email.",
        details,
        footerMessage: "Thank you for using Finora.",
      });

    const emailText =
      text ||
      (intro
        ? `${intro}\n\n${details
            .map(
              (d) => `${d.label}: 
            ${d.value}`,
            )
            .join("\n")}`
        : "Hello! Your requested Finora PDF statement is             attached");

    // 1. Send via Resend HTTP API (works seamlessly on          Render Free Tier)
    const apiKey = (process.env.RESEND_API_KEY || "").trim();

    if (apiKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Finora <onboarding@resend.dev>",
          to: [to],
          subject: subject,
          html: emailHtml,
          text: emailText,
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content)
              ? a.content.toString("base64")
              : Buffer.from(a.content).toString("base64"),
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || JSON.stringify(data));
      }

      console.log(
        "Email sent successfully via Resend!             ID:",
        data.id,
      );
      return {
        sent: true,
        messageId: data.id,
      };
    }

    // 2. Fallback to Nodemailer SMTP (for local        development)
    const mailTransporter = getTransporter();

    const result = await mailTransporter.sendMail({
      from:
        process.env.EMAIL_FROM ||
        `Finora            
          <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: emailText,
      html: emailHtml,
      attachments,
    });

    return {
      sent: true,
      messageId: result.messageId,
    };
  } catch (error) {
    console.error("Email send error:", error.message);

    return {
      sent: false,
      error: error.message,
    };
  }
};

/* -------------------------------------------------------------------------- */
/*                       Expense Activity Notifications                       */
/* -------------------------------------------------------------------------- */

/**
 * Send an email when an expense is created, updated or deleted.
 *
 * @param {Object} user - Logged-in user object
 * @param {Object} expense - Expense document or expense data
 * @param {string} action - created, updated or deleted
 */
export const sendExpenseActivityEmail = async (user, expense, action) => {
  try {
    if (!user?.email) {
      return {
        sent: false,
        reason: "User email address is not available.",
      };
    }

    if (!expense) {
      return {
        sent: false,
        reason: "Expense information is not available.",
      };
    }

    const actionLabels = {
      created: "Expense Added",
      updated: "Expense Updated",
      deleted: "Expense Deleted",
    };

    const actionMessages = {
      created: "A new expense has been added to your Finora account.",
      updated: "An expense in your Finora account has been updated.",
      deleted: "An expense has been deleted from your Finora account.",
    };

    const normalizedAction = String(action).toLowerCase();

    const title = actionLabels[normalizedAction] || "Expense Activity";

    const message =
      actionMessages[normalizedAction] ||
      "There has been an expense activity in your Finora account.";

    const amount = formatCurrency(expense.amount);

    const details = [
      {
        label: "Expense",
        value: expense.title || expense.name || "Expense",
      },
      {
        label: "Amount",
        value: amount,
      },
      {
        label: "Category",
        value: expense.category || "Uncategorized",
      },
      {
        label: "Date",
        value: formatDate(expense.date || expense.createdAt || new Date()),
      },
    ];

    if (expense.description) {
      details.push({
        label: "Description",
        value: expense.description,
      });
    }

    const html = createEmailTemplate({
      title,
      greeting: `Hello ${user.name || "Finora user"},`,
      message,
      details,
      footerMessage:
        "You can log in to your Finora account to view your latest expense activity.",
    });

    const text = [
      title,
      "",
      message,
      "",
      ...details.map(({ label, value }) => `${label}: ${value}`),
      "",
      "Thank you for using Finora.",
    ].join("\n");

    return await sendFinoraEmail({
      to: user.email,
      subject: `${title} | Finora`,
      html,
      text,
    });
  } catch (error) {
    console.error("Expense activity email error:", error.message);

    return {
      sent: false,
      error: error.message,
    };
  }
};

/* -------------------------------------------------------------------------- */
/*                          Budget Notification Email                         */
/* -------------------------------------------------------------------------- */

/**
 * Send a reusable budget notification.
 *
 * Example:
 * sendBudgetNotificationEmail(user, {
 *   title: "Budget Alert",
 *   message: "You have used 80% of your monthly budget.",
 *   budget: 1000,
 *   spent: 800,
 *   remaining: 200
 * });
 */
export const sendBudgetNotificationEmail = async (
  user,
  {
    title = "Budget Update",
    message = "There is an update to your budget.",
    budget,
    spent,
    remaining,
  } = {},
) => {
  try {
    if (!user?.email) {
      return {
        sent: false,
        reason: "User email address is not available.",
      };
    }

    const details = [];

    if (budget !== undefined) {
      details.push({
        label: "Total Budget",
        value: formatCurrency(budget),
      });
    }

    if (spent !== undefined) {
      details.push({
        label: "Amount Spent",
        value: formatCurrency(spent),
      });
    }

    if (remaining !== undefined) {
      details.push({
        label: "Remaining Budget",
        value: formatCurrency(remaining),
      });
    }

    const html = createEmailTemplate({
      title,
      greeting: `Hello ${user.name || "Finora user"},`,
      message,
      details,
      footerMessage:
        "Review your budget in Finora to keep track of your spending.",
    });

    const text = [
      title,
      "",
      message,
      "",
      ...details.map(({ label, value }) => `${label}: ${value}`),
    ].join("\n");

    return await sendFinoraEmail({
      to: user.email,
      subject: `${title} | Finora`,
      html,
      text,
    });
  } catch (error) {
    console.error("Budget notification email error:", error.message);

    return {
      sent: false,
      error: error.message,
    };
  }
};

/* -------------------------------------------------------------------------- */
/*                              SMTP Verification                              */
/* -------------------------------------------------------------------------- */

/**
 * Optional: verify SMTP credentials and server connection.
 * Useful for testing during development.
 */
export const verifyEmailConnection = async () => {
  try {
    const mailTransporter = getTransporter();

    await mailTransporter.verify();

    console.log("Finora SMTP connection verified successfully.");

    return {
      success: true,
      message: "SMTP connection verified successfully.",
    };
  } catch (error) {
    console.error("Finora SMTP verification failed:", error.message);

    return {
      success: false,
      error: error.message,
    };
  }
};
