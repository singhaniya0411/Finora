import mongoose from "mongoose";
import { z } from "zod";
import Expense, {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
} from "../models/Expense.js";
import { sendExpenseActivityEmail } from "../utils/emailService.js";

// Validation schemas
const createExpenseSchema = z.object({
  title: z
    .string({ required_error: "Expense title is required" })
    .trim()
    .min(1, "Expense title cannot be empty")
    .max(100, "Expense title must not exceed 100 characters"),
  amount: z.coerce
    .number({ required_error: "Amount is required" })
    .positive("Amount must be greater than 0"),
  category: z
    .string({ required_error: "Category is required" })
    .trim()
    .refine((val) => EXPENSE_CATEGORIES.includes(val), {
      message: `Invalid category. Must be one of: ${EXPENSE_CATEGORIES.join(", ")}`,
    }),
  date: z
    .string()
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : new Date())),
  paymentMethod: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || PAYMENT_METHODS.includes(val), {
      message: `Invalid payment method. Must be one of: ${PAYMENT_METHODS.join(", ")}`,
    }),
  notes: z
    .string()
    .trim()
    .max(500, "Notes cannot exceed 500 characters")
    .optional()
    .default(""),
});

const updateExpenseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Expense title cannot be empty")
    .max(100, "Expense title must not exceed 100 characters")
    .optional(),
  amount: z.coerce
    .number()
    .positive("Amount must be greater than 0")
    .optional(),
  category: z
    .string()
    .trim()
    .refine((val) => EXPENSE_CATEGORIES.includes(val), {
      message: `Invalid category. Must be one of: ${EXPENSE_CATEGORIES.join(", ")}`,
    })
    .optional(),
  date: z
    .string()
    .or(z.date())
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  paymentMethod: z
    .string()
    .trim()
    .refine((val) => !val || PAYMENT_METHODS.includes(val), {
      message: `Invalid payment method. Must be one of: ${PAYMENT_METHODS.join(", ")}`,
    })
    .optional(),
  notes: z
    .string()
    .trim()
    .max(500, "Notes cannot exceed 500 characters")
    .optional(),
});

// GET /api/expenses
export const getExpenses = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { category, search, startDate, endDate, sortBy } = req.query;

    const filter = { user: userId };

    // Category filter
    if (category && category !== "all") {
      filter.category = category;
    }

    // Search query on title or notes
    if (search && search.trim()) {
      filter.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { notes: { $regex: search.trim(), $options: "i" } },
      ];
    }

    // Date range filter
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        filter.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        // Include the entire end day
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    // Sorting
    let sortOption = { date: -1, createdAt: -1 };
    if (sortBy === "date_asc") {
      sortOption = { date: 1, createdAt: 1 };
    } else if (sortBy === "amount_desc") {
      sortOption = { amount: -1, date: -1 };
    } else if (sortBy === "amount_asc") {
      sortOption = { amount: 1, date: -1 };
    } else if (sortBy === "title_asc") {
      sortOption = { title: 1 };
    }

    const expenses = await Expense.find(filter).sort(sortOption).lean();

    return res.status(200).json({
      success: true,
      count: expenses.length,
      expenses,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/expenses/summary
export const getExpenseSummary = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate } = req.query;

    // Date range for current calendar month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // Period match filter
    const periodMatch = { user: userId };
    if (startDate || endDate) {
      periodMatch.date = {};
      if (startDate) {
        periodMatch.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        periodMatch.date.$lte = end;
      }
    }

    // Run parallel aggregation
    const [overallStats, thisMonthStats, periodStats, categoryStats] =
      await Promise.all([
        // Overall Total & Count
        Expense.aggregate([
          { $match: { user: userId } },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),

        // This Month's Total & Count
        Expense.aggregate([
          {
            $match: {
              user: userId,
              date: { $gte: startOfMonth, $lte: endOfMonth },
            },
          },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]),

        // Selected Period Total, Count, & Average
        Expense.aggregate([
          { $match: periodMatch },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: "$amount" },
              count: { $sum: 1 },
              avgAmount: { $avg: "$amount" },
            },
          },
        ]),

        // Spending by Category in Selected Period
        Expense.aggregate([
          { $match: periodMatch },
          {
            $group: {
              _id: "$category",
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { total: -1 } },
        ]),
      ]);

    const overallTotalSpent = overallStats[0]?.totalSpent || 0;
    const overallTotalCount = overallStats[0]?.count || 0;

    const thisMonthSpent = thisMonthStats[0]?.totalSpent || 0;
    const thisMonthCount = thisMonthStats[0]?.count || 0;

    const periodTotalSpent = periodStats[0]?.totalSpent || 0;
    const periodTotalCount = periodStats[0]?.count || 0;
    const periodAvgAmount = periodStats[0]?.avgAmount || 0;

    const categoryBreakdown = categoryStats.map((item) => ({
      category: item._id,
      total: item.total,
      count: item.count,
      percentage:
        periodTotalSpent > 0
          ? ((item.total / periodTotalSpent) * 100).toFixed(1)
          : 0,
    }));

    const topCategory = categoryBreakdown[0] || null;

    return res.status(200).json({
      success: true,
      summary: {
        totalSpent: periodTotalSpent,
        totalCount: periodTotalCount,
        avgAmount: periodAvgAmount,
        overallTotalSpent,
        overallTotalCount,
        thisMonthSpent,
        thisMonthCount,
        categoryBreakdown,
        topCategory,
        isFiltered: Boolean(startDate || endDate),
        startDate: startDate || null,
        endDate: endDate || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/expenses/:id
export const getExpenseById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Safety fallback: if router falls through on outdated server instance
    if (id === "analytics") {
      return getExpenseAnalytics(req, res, next);
    }
    if (id === "summary") {
      return getExpenseSummary(req, res, next);
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid expense ID format.",
      });
    }

    const expense = await Expense.findOne({
      _id: id,
      user: req.user._id,
    }).lean();

    if (!expense) {
      return res.status(404).json({
        message: "Expense not found.",
      });
    }

    return res.status(200).json({
      success: true,
      expense,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/expenses
export const createExpense = async (req, res, next) => {
  try {
    const validation = createExpenseSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Validation failed.",
      });
    }

    const expenseData = {
      ...validation.data,
      user: req.user._id,
    };

    const expense = await Expense.create(expenseData);
    // Send notification without interrupting successful expense creation.

    sendExpenseActivityEmail(req.user, expense, "created").catch((err) => {
      console.error(
        "Expense email failed in background: ",
        err?.message || err,
      );
    });

    return res.status(201).json({
      success: true,
      message: "Expense created successfully.",
      expense,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/expenses/:id
export const updateExpense = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid expense ID format.",
      });
    }

    const validation = updateExpenseSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: validation.error.issues[0]?.message || "Validation failed.",
      });
    }

    const expense = await Expense.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!expense) {
      return res.status(404).json({
        message: "Expense not found.",
      });
    }
    const previousExpense = expense.toObject();
    // Apply allowed updates
    const updates = validation.data;
    if (updates.title !== undefined) expense.title = updates.title;
    if (updates.amount !== undefined) expense.amount = updates.amount;
    if (updates.category !== undefined) expense.category = updates.category;
    if (updates.date !== undefined) expense.date = updates.date;
    if (updates.paymentMethod !== undefined)
      expense.paymentMethod = updates.paymentMethod;
    if (updates.notes !== undefined) expense.notes = updates.notes;

    await expense.save();
    void sendExpenseActivityEmail({
      user: req.user,
      action: "updated",
      expense: expense.toObject(),
      previousExpense,
    });
    return res.status(200).json({
      success: true,
      message: "Expense updated successfully.",
      expense,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/expenses/:id
export const deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid expense ID format.",
      });
    }

    const expense = await Expense.findOneAndDelete({
      _id: id,
      user: req.user._id,
    });

    if (!expense) {
      return res.status(404).json({
        message: "Expense not found.",
      });
    }
    void sendExpenseActivityEmail({
      user: req.user,
      action: "deleted",
      previousExpense: expense.toObject(),
    });
    return res.status(200).json({
      success: true,
      message: "Expense deleted successfully.",
      deletedId: id,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/expenses/analytics?year=2026
export const getExpenseAnalytics = async (req, res, next) => {
  try {
    const rawUserId = req.user?._id;
    const userObjectId =
      rawUserId && mongoose.Types.ObjectId.isValid(rawUserId)
        ? new mongoose.Types.ObjectId(rawUserId)
        : rawUserId;

    const requestedYear = parseInt(req.query.year, 10);
    const currentYear = new Date().getFullYear();
    const year =
      !isNaN(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
        ? requestedYear
        : currentYear;

    const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const yearFilter = {
      user: userObjectId,
      date: { $gte: startOfYear, $lte: endOfYear },
    };

    const MONTH_NAMES = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const FULL_MONTH_NAMES = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    // Run parallel aggregation pipelines
    const [
      yearSummaryStats,
      monthlyCategoryStats,
      categoryStats,
      topExpenses,
      recentTransactions,
      yearsResult,
    ] = await Promise.all([
      // 1. Year total and transaction count
      Expense.aggregate([
        { $match: yearFilter },
        {
          $group: {
            _id: null,
            totalSpent: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),

      // 2. Month-by-month and category breakdown (for Stacked Bar Graph)
      Expense.aggregate([
        { $match: yearFilter },
        {
          $project: {
            month: { $month: { $toDate: "$date" } },
            category: "$category",
            amount: "$amount",
          },
        },
        {
          $group: {
            _id: { month: "$month", category: "$category" },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.month": 1, total: -1 } },
      ]),

      // 3. Yearly Category Totals (for Pie Chart)
      Expense.aggregate([
        { $match: yearFilter },
        {
          $group: {
            _id: "$category",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),

      // 4. Top Expenses in Year (for Visual Highlight & Leaderboard)
      Expense.find(yearFilter).sort({ amount: -1, date: -1 }).limit(5).lean(),

      // 5. Recent Transactions
      Expense.find({ user: userObjectId })
        .sort({ date: -1, createdAt: -1 })
        .limit(6)
        .lean(),

      // 6. Distinct years with user data
      Expense.aggregate([
        { $match: { user: userObjectId } },
        { $project: { year: { $year: { $toDate: "$date" } } } },
        { $group: { _id: "$year" } },
        { $sort: { _id: -1 } },
      ]),
    ]);

    const yearTotalSpent =
      Math.round((yearSummaryStats[0]?.totalSpent || 0) * 100) / 100;
    const yearTotalCount = yearSummaryStats[0]?.count || 0;

    // Build 12 months array for stacked bar chart
    const monthlyMap = new Map();
    for (let i = 1; i <= 12; i += 1) {
      monthlyMap.set(i, {
        month: i,
        monthIndex: i - 1,
        name: MONTH_NAMES[i - 1],
        fullName: FULL_MONTH_NAMES[i - 1],
        total: 0,
        categories: [],
        byCategory: {},
      });
    }

    monthlyCategoryStats.forEach((item) => {
      const monthNum = item._id.month;
      const category = item._id.category;
      const total = Math.round(item.total * 100) / 100;
      const count = item.count;

      const monthData = monthlyMap.get(monthNum);
      if (monthData) {
        monthData.total = Math.round((monthData.total + total) * 100) / 100;
        monthData.categories.push({
          category,
          total,
          count,
        });
        monthData.byCategory[category] = total;
      }
    });

    const monthlyTrends = Array.from(monthlyMap.values()).map((m) => {
      const categoriesWithPercent = m.categories.map((c) => ({
        ...c,
        percentage:
          m.total > 0 ? Math.round((c.total / m.total) * 1000) / 10 : 0,
      }));
      return {
        ...m,
        categories: categoriesWithPercent,
      };
    });

    // Peak spending month
    let peakMonth = null;
    monthlyTrends.forEach((m) => {
      if (!peakMonth || m.total > peakMonth.total) {
        peakMonth = m;
      }
    });

    // Yearly category breakdown with percentages
    const categoryBreakdown = categoryStats.map((item) => {
      const total = Math.round(item.total * 100) / 100;
      return {
        category: item._id,
        total,
        count: item.count,
        percentage:
          yearTotalSpent > 0
            ? Math.round((total / yearTotalSpent) * 1000) / 10
            : 0,
      };
    });

    // Top expense visual
    const peakExpense = topExpenses[0]
      ? {
          ...topExpenses[0],
          percentageOfYear:
            yearTotalSpent > 0
              ? Math.round((topExpenses[0].amount / yearTotalSpent) * 1000) / 10
              : 0,
        }
      : null;

    // Available years list
    let availableYears = yearsResult
      .map((y) => y._id)
      .filter((y) => typeof y === "number" && !isNaN(y));
    if (!availableYears.includes(year)) availableYears.push(year);
    if (!availableYears.includes(currentYear)) availableYears.push(currentYear);
    availableYears.sort((a, b) => b - a);

    const activeMonthsCount = monthlyTrends.filter((m) => m.total > 0).length;
    const avgMonthlySpent =
      activeMonthsCount > 0
        ? Math.round((yearTotalSpent / activeMonthsCount) * 100) / 100
        : Math.round((yearTotalSpent / 12) * 100) / 100;

    return res.status(200).json({
      success: true,
      year,
      availableYears,
      summary: {
        yearTotalSpent,
        yearTotalCount,
        avgMonthlySpent,
        activeMonthsCount,
        peakMonth: peakMonth && peakMonth.total > 0 ? peakMonth : null,
        topCategory: categoryBreakdown[0] || null,
      },
      monthlyTrends,
      categoryBreakdown,
      peakExpense,
      topExpenses: topExpenses.map((exp) => ({
        ...exp,
        percentageOfYear:
          yearTotalSpent > 0
            ? Math.round((exp.amount / yearTotalSpent) * 1000) / 10
            : 0,
      })),
      recentTransactions,
    });
  } catch (error) {
    next(error);
  }
};
