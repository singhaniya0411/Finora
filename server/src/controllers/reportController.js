import {
  parseReportQuery,
  buildReportData,
  buildReportFileName,
} from "../utils/reportData.js";
import { buildCsvReport } from "../utils/csvReport.js";
import { buildPdfReport } from "../utils/pdfReport.js";
import { sendFinoraEmail } from "../utils/emailService.js";
// Shared helper: validates the query and builds the report data
const prepareReport = async (req, res) => {
  const validation = parseReportQuery(req.query);

  if (!validation.success) {
    res.status(400).json({
      message: validation.error.issues[0]?.message || "Invalid report filters.",
    });
    return null;
  }

  return buildReportData({
    user: req.user,
    query: validation.data,
  });
};

// Handles expected errors (like "too many records") with a clean message
const handleReportError = (error, res, next) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  return next(error);
};

// GET /api/reports/csv
export const downloadCsvReport = async (req, res, next) => {
  try {
    const data = await prepareReport(req, res);
    if (!data) return;

    const csv = buildCsvReport(data);
    const fileName = buildReportFileName(data, "csv");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(csv);
  } catch (error) {
    return handleReportError(error, res, next);
  }
};

// GET /api/reports/pdf
export const downloadPdfReport = async (req, res, next) => {
  try {
    const data = await prepareReport(req, res);
    if (!data) return;

    const pdfBuffer = await buildPdfReport(data);
    const fileName = buildReportFileName(data, "pdf");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).end(pdfBuffer);
  } catch (error) {
    return handleReportError(error, res, next);
  }
};

// POST /api/reports/email
export const emailPdfReport = async (req, res, next) => {
  try {
    const data = await prepareReport(req, res);
    if (!data) return;

    const pdfBuffer = await buildPdfReport(data);
    const fileName = buildReportFileName(data, "pdf");

    const money = (amount) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: data.currency || "INR",
      }).format(Number(amount || 0));

    const result = await sendFinoraEmail({
      to: req.user.email,
      subject: `Finora: Your ${data.period.name} financial report`,
      heading: "Your financial report is ready",
      intro: `Hello ${req.user.name || "there"}, your requested Finora PDF report is attached to this email.`,
      details: [
        { label: "Report period", value: data.period.name },
        { label: "Date range", value: data.period.dateRangeText },
        { label: "Transactions", value: String(data.summary.count) },
        { label: "Total spending", value: money(data.summary.total) },
        { label: "Average transaction", value: money(data.summary.average) },
        {
          label: "Generated at",
          value: new Date(data.generatedAt).toLocaleString("en-US"),
        },
      ],
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    if (!result.sent) {
      return res.status(502).json({
        success: false,
        message:
          "Email sending is restricted on Render&apos free tier. Please use the 'Download PDF' button above to get your report instantly!",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Your PDF report was sent to ${req.user.email}.`,
    });
  } catch (error) {
    return handleReportError(error, res, next);
  }
};
