import prisma from '../plugins/db';
import { 
  CreateVendorInput, 
  CreateContactInput, 
  CreateContractInput, 
  CreateInvoiceInput 
} from '../validators/vendors.schema';

export class VendorsService {
  async getAllVendors() {
    return prisma.vendor.findMany({
      include: {
        contacts: true,
        contracts: true,
        invoices: true,
        expenses: true,
      },
      orderBy: { name: 'asc' }
    });
  }

  async getVendorById(id: string) {
    return prisma.vendor.findUnique({
      where: { id },
      include: {
        contacts: true,
        contracts: true,
        invoices: true,
        expenses: true,
      },
    });
  }

  async createVendor(data: CreateVendorInput) {
    return prisma.vendor.create({
      data: {
        name: data.name,
        category: data.category,
        performanceScore: data.performanceScore,
      },
      include: {
        contacts: true,
        contracts: true,
        invoices: true,
        expenses: true,
      }
    });
  }

  async getUpcomingRenewals() {
    // Get contracts renewing in the next 90 days
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    return prisma.contract.findMany({
      where: {
        renewalDate: {
          lte: ninetyDaysFromNow,
          gte: new Date()
        }
      },
      include: { vendor: true },
      orderBy: { renewalDate: 'asc' }
    });
  }

  async getVendorContracts(vendorId: string) {
    return prisma.contract.findMany({
      where: { vendorId },
      orderBy: { startDate: 'desc' }
    });
  }

  async getVendorInvoices(vendorId: string) {
    return prisma.invoice.findMany({
      where: { vendorId },
      orderBy: { dueDate: 'desc' }
    });
  }

  async createContact(vendorId: string, data: CreateContactInput) {
    return prisma.vendorContact.create({
      data: {
        vendorId,
        name: data.name,
        email: data.email,
        phone: data.phone,
      }
    });
  }

  async createContract(vendorId: string, data: CreateContractInput) {
    return prisma.contract.create({
      data: {
        vendorId,
        value: data.value,
        startDate: new Date(data.startDate),
        renewalDate: new Date(data.renewalDate),
        documentUrl: data.documentUrl,
      }
    });
  }

  async createInvoice(vendorId: string, data: CreateInvoiceInput) {
    return prisma.invoice.create({
      data: {
        vendorId,
        amount: data.amount,
        status: data.status,
        dueDate: new Date(data.dueDate),
        documentUrl: data.documentUrl,
      }
    });
  }

  async updateInvoiceStatus(invoiceId: string, status: string) {
    return prisma.invoice.update({
      where: { id: invoiceId },
      data: { status }
    });
  }
}

export const vendorsService = new VendorsService();
