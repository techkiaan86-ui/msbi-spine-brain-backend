import { FastifyRequest, FastifyReply } from 'fastify';
import { campaignsService } from '../services/campaigns.service';
import { CreateCampaignInput, UpdateCampaignInput, CreateTaskInput } from '../validators/campaigns.schema';
import { ResourceAuth } from '../utils/resource-auth';
import prisma from '../plugins/db';

export const getCampaignsHandler = async (
  request: FastifyRequest<{ Querystring: { status?: string } }>,
  reply: FastifyReply
) => {
  const campaigns = await campaignsService.getAllCampaigns(request.query.status);
  return reply.send({ success: true, data: campaigns });
};

export const getCampaignByIdHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const campaign = await campaignsService.getCampaignById(request.params.id);
  if (!campaign) {
    return reply.status(404).send({ success: false, message: 'Campaign not found' });
  }
  return reply.send({ success: true, data: campaign });
};

export const createCampaignHandler = async (
  request: FastifyRequest<{ Body: CreateCampaignInput }>,
  reply: FastifyReply
) => {
  const campaign = await campaignsService.createCampaign(request.body);
  return reply.status(201).send({ success: true, data: campaign });
};

export const updateCampaignHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateCampaignInput }>,
  reply: FastifyReply
) => {
  const { id } = request.params;
  const currentUser = request.user;

  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  // 1. Verify existence
  const existingCampaign = await prisma.campaign.findUnique({
    where: { id }
  });

  if (!existingCampaign) {
    return reply.status(404).send({ success: false, message: 'Campaign not found' });
  }

  // 2. Resource-Level Authorization & Ownership Check
  if (!ResourceAuth.canModifyCampaign(currentUser, existingCampaign.ownerId)) {
    return reply.status(403).send({
      success: false,
      message: 'Forbidden: You do not have permission to modify this campaign',
      code: 'FORBIDDEN_RESOURCE_ACCESS'
    });
  }

  try {
    const updated = await campaignsService.updateCampaign(id, request.body);
    return reply.send({ success: true, data: updated });
  } catch (err: any) {
    return reply.status(500).send({ success: false, message: err.message || 'Failed to update campaign' });
  }
};

export const getTasksHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const existingCampaign = await prisma.campaign.findUnique({
    where: { id: request.params.id }
  });

  if (!existingCampaign) {
    return reply.status(404).send({ success: false, message: 'Campaign not found' });
  }

  const tasks = await campaignsService.getCampaignTasks(request.params.id);
  return reply.send({ success: true, data: tasks });
};

export const addTaskHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: CreateTaskInput }>,
  reply: FastifyReply
) => {
  const existingCampaign = await prisma.campaign.findUnique({
    where: { id: request.params.id }
  });

  if (!existingCampaign) {
    return reply.status(404).send({ success: false, message: 'Campaign not found' });
  }

  const task = await campaignsService.addCampaignTask(request.params.id, request.body);
  return reply.status(201).send({ success: true, data: task });
};

export const getAllTasksHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const tasks = await campaignsService.getAllTasks();
  return reply.send({ success: true, data: tasks });
};

export const updateTaskStatusHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
  reply: FastifyReply
) => {
  const updated = await campaignsService.updateTaskStatus(request.params.id, request.body.status);
  return reply.send({ success: true, data: updated });
};

export const getAllAssetsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const assets = await campaignsService.getAllAssets();
  return reply.send({ success: true, data: assets });
};

export const downloadAssetHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const asset = await campaignsService.getAssetById(request.params.id);
  if (!asset) {
    return reply.status(404).send({ success: false, message: 'Asset not found' });
  }

  const path = require('path');
  const fs = require('fs');
  const filePath = path.join(process.cwd(), asset.fileUrl);

  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ success: false, message: 'Asset file not found on disk' });
  }

  const stream = fs.createReadStream(filePath);
  return reply
    .header('Content-Type', asset.mimeType || 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${asset.name}"`)
    .send(stream);
};
