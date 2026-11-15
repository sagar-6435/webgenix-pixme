import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import {
  InvoiceStatus,
  PlanInterval,
  SubscriptionStatus,
  events,
  invoices,
  plans,
  studioMembers,
  studios,
  subscriptions,
  photos,
} from '../db/schema';
import { DrizzleService } from '../db/drizzle.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomToken } from '../common/utils/crypto.util';
import { paginate } from '../common/utils/pagination.util';
import type { AuthUser, StudioContext } from '../common/types/auth.types';
import type { ChangePlanDto, InvoiceListQueryDto } from './dto/billing.dto';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface PlanView {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  maxEvents: number;
  maxPhotosPerEvent: number;
  maxStorageGb: number;
  maxTeamMembers: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}

function addInterval(date: Date, interval: PlanInterval): Date {
  const next = new Date(date);
  if (interval === PlanInterval.YEARLY) next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly database: DrizzleService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private planView(plan: typeof plans.$inferSelect): PlanView {
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      priceMonthly: Number(plan.priceMonthly),
      priceYearly: Number(plan.priceYearly),
      currency: plan.currency,
      maxEvents: plan.maxEvents,
      maxPhotosPerEvent: plan.maxPhotosPerEvent,
      maxStorageGb: plan.maxStorageGb,
      maxTeamMembers: plan.maxTeamMembers,
      features: Array.isArray(plan.features)
        ? plan.features.filter((feature): feature is string => typeof feature === 'string')
        : [],
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    };
  }

  async plans(includeInactive = false): Promise<PlanView[]> {
    const rows = await this.database.db
      .select()
      .from(plans)
      .where(includeInactive ? undefined : eq(plans.isActive, true))
      .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly));
    return rows.map((plan) => this.planView(plan));
  }

  async subscription(studio: StudioContext) {
    const subscription = await this.database.db.query.subscriptions.findFirst({
      where: eq(subscriptions.studioId, studio.id),
      with: { plan: true },
    });
    if (!subscription) throw new NotFoundException('No subscription found for this studio');
    return {
      id: subscription.id,
      status: subscription.status,
      interval: subscription.interval,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt,
      plan: this.planView(subscription.plan),
    };
  }

  async overview(studio: StudioContext) {
    const [subscription, invoiceRows, usage, eventRows, memberRows] = await Promise.all([
      this.subscription(studio),
      this.database.db
        .select()
        .from(invoices)
        .where(eq(invoices.studioId, studio.id))
        .orderBy(desc(invoices.createdAt))
        .limit(5),
      this.database.db
        .select({ storageUsedBytes: studios.storageUsedBytes })
        .from(studios)
        .where(eq(studios.id, studio.id))
        .limit(1),
      this.database.db
        .select({ value: count() })
        .from(events)
        .where(eq(events.studioId, studio.id)),
      this.database.db
        .select({ value: count() })
        .from(studioMembers)
        .where(eq(studioMembers.studioId, studio.id)),
    ]);

    const price =
      subscription.interval === PlanInterval.YEARLY
        ? subscription.plan.priceYearly
        : subscription.plan.priceMonthly;

    return {
      subscription,
      nextInvoice: {
        amount: price,
        currency: subscription.plan.currency,
        dueAt: subscription.currentPeriodEnd,
      },
      invoices: invoiceRows.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        description: invoice.description,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
      })),
      usage: {
        events: Number(eventRows[0]?.value ?? 0),
        eventsLimit: subscription.plan.maxEvents,
        members: Number(memberRows[0]?.value ?? 0),
        membersLimit: subscription.plan.maxTeamMembers,
        storageBytes: usage[0]?.storageUsedBytes ?? 0,
        storageLimitBytes: subscription.plan.maxStorageGb * 1024 * 1024 * 1024,
      },
    };
  }

  async changePlan(
    studio: StudioContext,
    user: AuthUser,
    dto: ChangePlanDto,
    meta: RequestMeta,
  ) {
    const [planRows, current, eventRows, maxPhotos, memberRows, studioRows] = await Promise.all([
      this.database.db
        .select()
        .from(plans)
        .where(and(eq(plans.id, dto.planId), eq(plans.isActive, true)))
        .limit(1),
      this.database.db.query.subscriptions.findFirst({
        where: eq(subscriptions.studioId, studio.id),
        with: { plan: true },
      }),
      this.database.db
        .select({ value: count() })
        .from(events)
        .where(eq(events.studioId, studio.id)),
      this.database.db
        .select({ eventId: events.id, value: count() })
        .from(events)
        .leftJoin(photos, eq(photos.eventId, events.id))
        .where(eq(events.studioId, studio.id))
        .groupBy(events.id),
      this.database.db
        .select({ value: count() })
        .from(studioMembers)
        .where(eq(studioMembers.studioId, studio.id)),
      this.database.db
        .select({ storageUsedBytes: studios.storageUsedBytes })
        .from(studios)
        .where(eq(studios.id, studio.id))
        .limit(1),
    ]);

    const plan = planRows[0];
    if (!plan) throw new NotFoundException('Plan not found');
    if (!current) throw new NotFoundException('No subscription found for this studio');
    if (current.planId === plan.id && current.interval === dto.interval) {
      throw new BadRequestException('You are already on this plan and billing interval');
    }

    let largestGallery = 0;
    for (const group of maxPhotos) {
      largestGallery = Math.max(largestGallery, Number(group.value));
    }
    const storageBytes = studioRows[0]?.storageUsedBytes ?? 0;
    const eventCount = Number(eventRows[0]?.value ?? 0);
    const memberCount = Number(memberRows[0]?.value ?? 0);
    const violations: string[] = [];
    if (eventCount > plan.maxEvents) {
      violations.push(`You have ${eventCount} events; this plan allows ${plan.maxEvents}`);
    }
    if (largestGallery > plan.maxPhotosPerEvent) {
      violations.push(
        `Your largest gallery has ${largestGallery} photographs; this plan allows ${plan.maxPhotosPerEvent} per event`,
      );
    }
    if (storageBytes > plan.maxStorageGb * 1024 * 1024 * 1024) {
      violations.push(`Your stored files exceed ${plan.maxStorageGb} GB`);
    }
    if (memberCount > plan.maxTeamMembers) {
      violations.push(`You have ${memberCount} team members; this plan allows ${plan.maxTeamMembers}`);
    }
    if (violations.length) {
      throw new ConflictException({
        code: 'PLAN_LIMITS_EXCEEDED',
        message: 'This plan is smaller than your current usage. Reduce usage before switching.',
        violations,
      });
    }

    const now = new Date();
    const amount =
      dto.interval === PlanInterval.YEARLY ? plan.priceYearly : plan.priceMonthly;
    const periodEnd = addInterval(now, dto.interval);
    const keepTrial =
      current.status === SubscriptionStatus.TRIALING &&
      current.trialEndsAt != null &&
      current.trialEndsAt.getTime() > now.getTime();

    const result = await this.database.db.transaction(async (tx) => {
      const [subscription] = await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          interval: dto.interval,
          status: keepTrial ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        })
        .where(eq(subscriptions.studioId, studio.id))
        .returning();
      if (!subscription) throw new NotFoundException('No subscription found for this studio');

      let invoice: typeof invoices.$inferSelect | null = null;
      if (Number(amount) > 0) {
        [invoice] = await tx
          .insert(invoices)
          .values({
            number: `PX-${now.getUTCFullYear()}-${randomToken(4).slice(0, 8).toUpperCase()}`,
            subscriptionId: subscription.id,
            studioId: studio.id,
            amount,
            currency: plan.currency,
            status: InvoiceStatus.OPEN,
            description: `${plan.name} · ${dto.interval.toLowerCase()} plan`,
            periodStart: now,
            periodEnd,
          })
          .returning();
      }
      return { subscription, invoice };
    });

    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'SUBSCRIPTION_PLAN_CHANGED',
      entity: 'subscription',
      entityId: result.subscription.id,
      metadata: {
        fromPlan: current.plan.slug,
        toPlan: plan.slug,
        interval: dto.interval,
        invoiceId: result.invoice?.id ?? null,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.notifications.create({
      studioId: studio.id,
      userId: user.id,
      type: 'SUBSCRIPTION',
      title: 'Plan updated',
      body: `Your studio is now on ${plan.name} (${dto.interval.toLowerCase()}).`,
      data: { planId: plan.id, interval: dto.interval },
    });

    return {
      subscription: {
        status: result.subscription.status,
        interval: result.subscription.interval,
        currentPeriodStart: result.subscription.currentPeriodStart,
        currentPeriodEnd: result.subscription.currentPeriodEnd,
        plan: this.planView(plan),
      },
      invoice: result.invoice
        ? {
            id: result.invoice.id,
            number: result.invoice.number,
            amount: Number(result.invoice.amount),
            currency: result.invoice.currency,
            status: result.invoice.status,
            dueAt: result.invoice.periodEnd,
          }
        : null,
      message: `Plan changed to ${plan.name}`,
    };
  }

  async cancel(studio: StudioContext, user: AuthUser, meta: RequestMeta) {
    const subscription = await this.database.db.query.subscriptions.findFirst({
      where: eq(subscriptions.studioId, studio.id),
      with: { plan: true },
    });
    if (!subscription) throw new NotFoundException('No subscription found for this studio');
    if (subscription.cancelAtPeriodEnd) {
      return {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: subscription.currentPeriodEnd,
        message: 'Your subscription is already scheduled to end',
      };
    }
    if (
      subscription.status === SubscriptionStatus.CANCELED ||
      subscription.status === SubscriptionStatus.EXPIRED
    ) {
      throw new BadRequestException('This subscription is already inactive');
    }

    const [updated] = await this.database.db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true, canceledAt: new Date() })
      .where(eq(subscriptions.studioId, studio.id))
      .returning();
    if (!updated) throw new NotFoundException('No subscription found for this studio');
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'SUBSCRIPTION_CANCELED',
      entity: 'subscription',
      entityId: subscription.id,
      metadata: { atPeriodEnd: true },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    this.notifications
      .create({
        studioId: studio.id,
        userId: user.id,
        type: 'SUBSCRIPTION',
        title: 'Subscription ending',
        body: `Your ${subscription.plan.name} plan will end on ${updated.currentPeriodEnd.toLocaleDateString('en-US', { dateStyle: 'medium' })}. Your galleries stay available until then.`,
        data: { currentPeriodEnd: updated.currentPeriodEnd },
      })
      .catch(() => undefined);

    return {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: updated.currentPeriodEnd,
      message: 'Your subscription will end at the close of the current billing period',
    };
  }

  async resume(studio: StudioContext, user: AuthUser, meta: RequestMeta) {
    const subscription = await this.database.db.query.subscriptions.findFirst({
      where: eq(subscriptions.studioId, studio.id),
      with: { plan: true },
    });
    if (!subscription) throw new NotFoundException('No subscription found for this studio');
    if (!subscription.cancelAtPeriodEnd) {
      throw new BadRequestException('This subscription is not scheduled to end');
    }
    if (subscription.currentPeriodEnd.getTime() < Date.now()) {
      throw new ForbiddenException('This subscription has already ended. Choose a plan to restart.');
    }
    const [updated] = await this.database.db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: false, canceledAt: null })
      .where(eq(subscriptions.studioId, studio.id))
      .returning();
    if (!updated) throw new NotFoundException('No subscription found for this studio');
    await this.audit.record({
      studioId: studio.id,
      actorId: user.id,
      action: 'SUBSCRIPTION_RESUMED',
      entity: 'subscription',
      entityId: subscription.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: updated.currentPeriodEnd,
      message: `Your ${subscription.plan.name} plan will continue`,
    };
  }

  async invoices(studio: StudioContext, query: InvoiceListQueryDto) {
    const where = and(
      eq(invoices.studioId, studio.id),
      query.status ? eq(invoices.status, query.status) : undefined,
    );
    const [invoiceRows, totalRows] = await Promise.all([
      this.database.db
        .select()
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.database.db.select({ value: count() }).from(invoices).where(where),
    ]);
    return paginate(
      invoiceRows.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        status: invoice.status,
        description: invoice.description,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
      })),
      Number(totalRows[0]?.value ?? 0),
      query.page,
      query.limit,
    );
  }

  async invoice(studio: StudioContext, invoiceId: string) {
    const invoice = await this.database.db.query.invoices.findFirst({
      where: and(eq(invoices.id, invoiceId), eq(invoices.studioId, studio.id)),
      with: { subscription: { with: { plan: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return {
      id: invoice.id,
      number: invoice.number,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      status: invoice.status,
      description: invoice.description,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
      plan: this.planView(invoice.subscription.plan),
    };
  }

  async markInvoicePaid(invoiceId: string) {
    const invoice = await this.database.db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      with: { subscription: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID) return { id: invoice.id, status: invoice.status };
    const updated = await this.database.db.transaction(async (tx) => {
      const [paid] = await tx
        .update(invoices)
        .set({ status: InvoiceStatus.PAID, paidAt: new Date() })
        .where(eq(invoices.id, invoiceId))
        .returning();
      if (!paid) throw new NotFoundException('Invoice not found');
      if (invoice.subscription.status === SubscriptionStatus.PAST_DUE) {
        await tx
          .update(subscriptions)
          .set({ status: SubscriptionStatus.ACTIVE })
          .where(eq(subscriptions.id, invoice.subscriptionId));
      }
      return paid;
    });
    return { id: updated.id, status: updated.status, paidAt: updated.paidAt };
  }
}
