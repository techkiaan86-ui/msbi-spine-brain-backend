import prisma from '../plugins/db';
import { CreateExpenseInput, AdjustBudgetInput } from '../validators/budget.schema';

export class BudgetService {
  async getBudgetOverview() {
    return prisma.budget.findMany({
      include: {
        expenses: true,
      },
    });
  }

  async getPlannedVsActual(query: { startDate?: string; endDate?: string } = {}) {
    const { startDate, endDate } = query.startDate && query.endDate 
      ? { startDate: new Date(query.startDate), endDate: new Date(query.endDate) }
      : { startDate: new Date(0), endDate: new Date('9999-12-31') };

    const budgets = await prisma.budget.findMany();
    
    // Fetch paid ad spend within the date range
    const adMetrics = await prisma.campaignMetricSnapshot.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { campaign: true }
    });
    
    const adSpendByYearMonthCurrency: Record<string, { google: number, meta: number, currency: string }> = {};
    
    adMetrics.forEach(m => {
      const year = m.date.getFullYear();
      const month = m.date.getMonth() + 1; // 1-12
      const currency = m.currencyCode || 'USD';
      
      const key = `${year}-${month}-${currency}`;
      if (!adSpendByYearMonthCurrency[key]) {
        adSpendByYearMonthCurrency[key] = { google: 0, meta: 0, currency };
      }
      
      if (m.campaign.platform === 'google_ads') {
        adSpendByYearMonthCurrency[key].google += Number(m.spend);
      } else if (m.campaign.platform === 'meta') {
        adSpendByYearMonthCurrency[key].meta += Number(m.spend);
      }
    });

    const expenses = await prisma.expense.findMany({
      where: { date: { gte: startDate, lte: endDate } }
    });

    return budgets.map(b => {
      const currencies: Record<string, { googleAdsSpend: number, metaAdsSpend: number }> = {};
      
      if (b.month) {
        Object.keys(adSpendByYearMonthCurrency).forEach(k => {
          if (k.startsWith(`${b.year}-${b.month}-`)) {
            const data = adSpendByYearMonthCurrency[k];
            if (!currencies[data.currency]) currencies[data.currency] = { googleAdsSpend: 0, metaAdsSpend: 0 };
            currencies[data.currency].googleAdsSpend += data.google;
            currencies[data.currency].metaAdsSpend += data.meta;
          }
        });
      } else {
        // annual
        Object.keys(adSpendByYearMonthCurrency).forEach(k => {
          if (k.startsWith(`${b.year}-`)) {
            const data = adSpendByYearMonthCurrency[k];
            if (!currencies[data.currency]) currencies[data.currency] = { googleAdsSpend: 0, metaAdsSpend: 0 };
            currencies[data.currency].googleAdsSpend += data.google;
            currencies[data.currency].metaAdsSpend += data.meta;
          }
        });
      }
      
      // Calculate actual expenses for this budget in the date range
      const budgetExpenses = expenses.filter(e => e.budgetId === b.id);
      const manualExpenses = budgetExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
      
      return {
        id: b.id,
        year: b.year,
        month: b.month,
        planned: Number(b.totalPlanned),
        manualExpenses, // Separate from automated ad spend to avoid double count
        adSpendCurrencies: currencies,
        variance: Number(b.totalPlanned) - manualExpenses
      };
    });
  }

  async getVendorSpending() {
    const expenses = await prisma.expense.findMany({
      include: { vendor: true }
    });
    
    const vendorMap: Record<string, number> = {};
    expenses.forEach(ex => {
      const vendorName = ex.vendor ? ex.vendor.name : 'Unknown Vendor';
      vendorMap[vendorName] = (vendorMap[vendorName] || 0) + Number(ex.amount);
    });

    return Object.entries(vendorMap).map(([vendor, totalSpend]) => ({
      vendor,
      totalSpend
    })).sort((a, b) => b.totalSpend - a.totalSpend);
  }

  async addExpense(data: CreateExpenseInput) {
    const expense = await prisma.expense.create({
      data: {
        budgetId: data.budgetId,
        category: data.category,
        amount: data.amount,
        vendorId: data.vendorId,
        date: new Date(data.date),
        description: data.description,
      },
    });

    // Automatically update the budget's total actual
    await prisma.budget.update({
      where: { id: data.budgetId },
      data: { totalActual: { increment: data.amount } }
    });

    return expense;
  }

  async adjustBudget(data: AdjustBudgetInput) {
    return prisma.budget.update({
      where: { id: data.budgetId },
      data: { totalPlanned: data.totalPlanned }
    });
  }
}

export const budgetService = new BudgetService();
