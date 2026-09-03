import { FastifyRequest, FastifyReply } from 'fastify';
import { budgetService } from '../services/budget.service';
import { CreateExpenseInput, AdjustBudgetInput } from '../validators/budget.schema';

export const getBudgetOverviewHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const budgets = await budgetService.getBudgetOverview();
  return reply.send({ success: true, data: budgets });
};

export const getPlannedVsActualHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const data = await budgetService.getPlannedVsActual();
  return reply.send({ success: true, data });
};

export const getVendorSpendingHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const data = await budgetService.getVendorSpending();
  return reply.send({ success: true, data });
};

export const createExpenseHandler = async (
  request: FastifyRequest<{ Body: CreateExpenseInput }>,
  reply: FastifyReply
) => {
  const expense = await budgetService.addExpense(request.body);
  return reply.status(201).send({ success: true, data: expense });
};

export const adjustBudgetHandler = async (
  request: FastifyRequest<{ Body: AdjustBudgetInput }>,
  reply: FastifyReply
) => {
  const updated = await budgetService.adjustBudget(request.body);
  return reply.send({ success: true, data: updated });
};
