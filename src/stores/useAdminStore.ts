import { create } from 'zustand';
import {
  McpTowerService,
  SwarmWorker,
  TaskQueueJob,
  SchemaParityTable,
  LlmGatewayRoute,
  SecurityEventLog,
  SystemAuditRecord,
  CustomerRecord,
} from '../types';
import { adminService } from '../services/adminService';
import { toast } from './useToastStore';
import { logger } from '../utils/logger';

const MCP_SERVICES_KEY = 'supremeai_studio_mcp_services';
const SWARM_KEY = 'supremeai_studio_swarm_workers';
const QUEUE_KEY = 'supremeai_studio_queue_jobs';
const SCHEMA_KEY = 'supremeai_studio_schema_tables';
const GATEWAY_KEY = 'supremeai_studio_gateway_routes';
const SECURITY_KEY = 'supremeai_studio_security_events';
const BLOCKED_IPS_KEY = 'supremeai_studio_blocked_ips';
const AUDIT_KEY = 'supremeai_studio_audit_records';
const CUSTOMERS_KEY = 'supremeai_studio_customers';

interface BlockedIpRecord {
  ip: string;
  reason: string;
  date: string;
}

interface AdminState {
  mcpServices: McpTowerService[];
  isProbingCluster: boolean;
  swarmWorkers: SwarmWorker[];
  queueJobs: TaskQueueJob[];
  schemaTables: SchemaParityTable[];
  gatewayRoutes: LlmGatewayRoute[];
  securityEvents: SecurityEventLog[];
  blockedIps: BlockedIpRecord[];
  auditRecords: SystemAuditRecord[];
  customers: CustomerRecord[];

  // MCP & Central Sync Operations
  fetchMcpServices: (options?: { force?: boolean }) => Promise<void>;
  fetchAdminSync: () => Promise<void>;
  fetchAuditRecords: () => Promise<void>;
  rebootService: (serviceId: string) => Promise<void>;
  rebootAllServices: () => Promise<void>;
  probeCluster: () => Promise<void>;
  getMcpAlertCount: () => number;

  // Swarm & Tasks
  toggleSwarmWorker: (id: string) => void;
  scaleWorker: (id: string, delta: number) => void;
  retryQueueJob: (id: string) => void;
  retryAllDlq: () => void;
  clearCompletedJobs: () => void;

  // Schema & Gateway
  runParitySync: () => void;
  toggleFailover: (routeId: string) => void;
  updateGatewayPrice: (routeId: string, newPrice: number) => void;

  // Security & Audit
  addBlockedIp: (ip: string, reason: string) => void;
  removeBlockedIp: (ip: string) => void;

  // Customer Management
  addCustomer: (newCust: Omit<CustomerRecord, 'id' | 'joinedDate' | 'lastActive'>) => void;
  updateCustomer: (id: string, updates: Partial<CustomerRecord>) => void;
  deleteCustomer: (id: string) => void;
}

export const useAdminStore = create<AdminState>((set, get) => {
  // Helpers to read from localStorage with fallbacks
  const getInitialStorage = <T>(key: string, fallback: T): T => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return JSON.parse(saved);
    } catch (error) {
      logger.debug('useAdminStore: suppressed non-fatal error', error);
    }
    return fallback;
  };

  const initialMcpServices = getInitialStorage<McpTowerService[]>(MCP_SERVICES_KEY, []);
  const initialSwarmWorkers = getInitialStorage<SwarmWorker[]>(SWARM_KEY, []);
  const initialQueueJobs = getInitialStorage<TaskQueueJob[]>(QUEUE_KEY, []);
  const initialSchemaTables = getInitialStorage<SchemaParityTable[]>(SCHEMA_KEY, []);
  const initialGatewayRoutes = getInitialStorage<LlmGatewayRoute[]>(GATEWAY_KEY, []);
  const initialSecurityLogs = getInitialStorage<SecurityEventLog[]>(SECURITY_KEY, []);
  const initialBlockedIps = getInitialStorage<BlockedIpRecord[]>(BLOCKED_IPS_KEY, []);
  const initialAuditRecords = getInitialStorage<SystemAuditRecord[]>(AUDIT_KEY, []);
  const initialCustomers = getInitialStorage<CustomerRecord[]>(CUSTOMERS_KEY, []);

  return {
    mcpServices: initialMcpServices,
    isProbingCluster: false,
    swarmWorkers: initialSwarmWorkers,
    queueJobs: initialQueueJobs,
    schemaTables: initialSchemaTables,
    gatewayRoutes: initialGatewayRoutes,
    securityEvents: initialSecurityLogs,
    blockedIps: initialBlockedIps,
    auditRecords: initialAuditRecords,
    customers: initialCustomers,

    fetchMcpServices: async (options) => {
      try {
        const services = await adminService.fetchMcpServices(options);
        if (services && services.length > 0) {
          localStorage.setItem(MCP_SERVICES_KEY, JSON.stringify(services));
          set({ mcpServices: services });
        }
      } catch (err) {
        logger.warn('MCP tower fetch failed, using cached/mock telemetry:', err);
      }
    },

    fetchAuditRecords: async () => {
      try {
        const records = await adminService.fetchAuditRecords();
        if (records && records.length > 0) {
          localStorage.setItem(AUDIT_KEY, JSON.stringify(records));
          set({ auditRecords: records });
        }
      } catch (error) {
        logger.debug('useAdminStore: suppressed non-fatal error', error);
      }
    },

    fetchAdminSync: async () => {
      try {
        // বাংলা মন্তব্য: একটি এন্ডপয়েন্ট ব্যর্থ হলেও যাতে অন্য ৭টি অ্যাডমিন ট্যাবের ডেটা লোড হয়, তাই allSettled ব্যবহার করা হয়েছে।
        const [
          customersRes,
          blockedIpsRes,
          auditRecordsRes,
          swarmWorkersRes,
          queueJobsRes,
          schemaTablesRes,
          gatewayPayloadRes,
          securityEventsRes,
        ] = await Promise.allSettled([
          adminService.fetchCustomers(),
          adminService.fetchBlockedIps(),
          adminService.fetchAuditRecords(),
          adminService.fetchSwarmWorkers(),
          adminService.fetchQueueJobs(),
          adminService.fetchSchemaParity(),
          adminService.fetchLlmGatewayRoutes(),
          adminService.fetchSecurityEvents(),
        ]);
        if (customersRes.status === 'fulfilled' && Array.isArray(customersRes.value)) {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customersRes.value));
          set({ customers: customersRes.value });
        }
        if (blockedIpsRes.status === 'fulfilled' && Array.isArray(blockedIpsRes.value)) {
          localStorage.setItem(BLOCKED_IPS_KEY, JSON.stringify(blockedIpsRes.value));
          set({ blockedIps: blockedIpsRes.value });
        }
        if (auditRecordsRes.status === 'fulfilled' && Array.isArray(auditRecordsRes.value)) {
          localStorage.setItem(AUDIT_KEY, JSON.stringify(auditRecordsRes.value));
          set({ auditRecords: auditRecordsRes.value });
        }
        if (swarmWorkersRes.status === 'fulfilled' && Array.isArray(swarmWorkersRes.value)) {
          localStorage.setItem(SWARM_KEY, JSON.stringify(swarmWorkersRes.value));
          set({ swarmWorkers: swarmWorkersRes.value });
        }
        if (queueJobsRes.status === 'fulfilled' && Array.isArray(queueJobsRes.value)) {
          localStorage.setItem(QUEUE_KEY, JSON.stringify(queueJobsRes.value));
          set({ queueJobs: queueJobsRes.value });
        }
        if (schemaTablesRes.status === 'fulfilled' && Array.isArray(schemaTablesRes.value)) {
          localStorage.setItem(SCHEMA_KEY, JSON.stringify(schemaTablesRes.value));
          set({ schemaTables: schemaTablesRes.value });
        }
        if (
          gatewayPayloadRes.status === 'fulfilled' &&
          Array.isArray(gatewayPayloadRes.value?.routes)
        ) {
          localStorage.setItem(GATEWAY_KEY, JSON.stringify(gatewayPayloadRes.value.routes));
          set({ gatewayRoutes: gatewayPayloadRes.value.routes });
        }
        if (securityEventsRes.status === 'fulfilled' && Array.isArray(securityEventsRes.value)) {
          localStorage.setItem(SECURITY_KEY, JSON.stringify(securityEventsRes.value));
          set({ securityEvents: securityEventsRes.value });
        }
      } catch (err) {
        logger.warn('Admin central sync failed, keeping local cache:', err);
      }
    },

    rebootService: async (serviceId: string) => {
      set((state) => ({
        mcpServices: state.mcpServices.map((s) =>
          s.id === serviceId ? { ...s, status: 'rebooting' } : s
        ),
      }));

      try {
        const rebooted = await adminService.rebootMcpService(serviceId);
        if (rebooted) {
          set((state) => {
            const updated = state.mcpServices.map((s) => (s.id === serviceId ? rebooted : s));
            localStorage.setItem(MCP_SERVICES_KEY, JSON.stringify(updated));
            return { mcpServices: updated };
          });
          toast.success('Service Rebooted', `${serviceId} successfully recovered.`);
          return;
        }
        throw new Error('Reboot returned no service');
      } catch (err) {
        logger.warn('Backend reboot failed:', err);
        // Restore truthful state from backend instead of faking success.
        try {
          await get().fetchMcpServices({ force: true });
        } catch (error) {
          logger.debug('useAdminStore: suppressed non-fatal error', error);
        }
        toast.error(
          'Reboot Failed',
          `${serviceId} could not be restarted: ${(err as Error)?.message || err}`
        );
      }
    },

    rebootAllServices: async () => {
      set((state) => ({
        mcpServices: state.mcpServices.map((s) =>
          s.status === 'unhealthy' || s.status === 'degraded' ? { ...s, status: 'rebooting' } : s
        ),
      }));

      try {
        const services = await adminService.rebootAllMcpServices();
        if (services && services.length > 0) {
          localStorage.setItem(MCP_SERVICES_KEY, JSON.stringify(services));
          set({ mcpServices: services });
          toast.success('Cluster Recovered', 'All degraded services brought back online.');
          return;
        }
        throw new Error('Cluster reboot returned no services');
      } catch (err) {
        logger.warn('Backend cluster reboot failed:', err);
        try {
          await get().fetchMcpServices({ force: true });
        } catch (error) {
          logger.debug('useAdminStore: suppressed non-fatal error', error);
        }
        toast.error('Cluster Reboot Failed', (err as Error)?.message || String(err));
      }
    },

    probeCluster: async () => {
      set({ isProbingCluster: true });
      try {
        const services = await adminService.probeMcpCluster();
        if (services && services.length > 0) {
          localStorage.setItem(MCP_SERVICES_KEY, JSON.stringify(services));
          set({ mcpServices: services });
          toast.info('Cluster Health Probed', 'Active ping latency and memory stats updated.');
        }
      } catch (err) {
        logger.warn('Probe failed:', err);
        toast.error('Probe Failed', (err as Error)?.message || String(err));
      } finally {
        setTimeout(() => set({ isProbingCluster: false }), 500);
      }
    },

    getMcpAlertCount: () => {
      const { mcpServices } = get();
      return mcpServices.filter((s) => s.status === 'unhealthy' || s.status === 'degraded').length;
    },

    toggleSwarmWorker: (id: string) => {
      set((state) => {
        const updated = state.swarmWorkers.map((w) =>
          w.id === id
            ? { ...w, status: w.status === 'active' ? ('paused' as const) : ('active' as const) }
            : w
        );
        localStorage.setItem(SWARM_KEY, JSON.stringify(updated));
        return { swarmWorkers: updated };
      });
      adminService.toggleSwarmWorker(id).catch(() => {});
      toast.info('Swarm Worker Updated', 'Worker state modified.');
    },

    scaleWorker: (id: string, delta: number) => {
      set((state) => {
        const updated = state.swarmWorkers.map((w) =>
          w.id === id
            ? { ...w, cpuPercent: Math.max(1, Math.min(95, Math.round(w.cpuPercent + delta * 4))) }
            : w
        );
        localStorage.setItem(SWARM_KEY, JSON.stringify(updated));
        return { swarmWorkers: updated };
      });
      adminService.scaleSwarmWorker(id, delta).catch(() => {});
    },

    retryQueueJob: (id: string) => {
      set((state) => {
        const updated = state.queueJobs.map((j) =>
          j.id === id
            ? { ...j, status: 'active' as const, attempts: 1, errorDetails: undefined }
            : j
        );
        localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
        return { queueJobs: updated };
      });
      adminService.retryQueueJob(id).catch(() => {});
      toast.info('Job Re-queued', 'Task moved back to active ingestion queue.');
    },

    retryAllDlq: () => {
      set((state) => {
        const updated = state.queueJobs.map((j) =>
          j.status === 'dlq'
            ? { ...j, status: 'active' as const, attempts: 1, errorDetails: undefined }
            : j
        );
        localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
        return { queueJobs: updated };
      });
      adminService
        .flushDlq()
        .then(() => get().fetchAuditRecords())
        .catch(() => {});
      toast.success('DLQ Reprocessed', 'All dead-letter jobs moved to active execution.');
    },

    clearCompletedJobs: () => {
      set((state) => {
        const updated = state.queueJobs.filter((j) => j.status !== 'completed');
        localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
        return { queueJobs: updated };
      });
      adminService.clearCompletedQueueJobs().catch(() => {});
      toast.info('Queue Cleaned', 'Completed tasks purged from history.');
    },

    runParitySync: async () => {
      try {
        const res = await adminService.syncSchemaParity();
        if (Array.isArray(res?.tables)) {
          localStorage.setItem(SCHEMA_KEY, JSON.stringify(res.tables));
          set({ schemaTables: res.tables });
          get().fetchAuditRecords();
        }
        toast.success(
          'Schema Parity Reached',
          'Database schemas aligned across dev and production.'
        );
      } catch (err) {
        toast.error(
          'Schema Sync Failed',
          err instanceof Error ? err.message : 'Unable to sync schema parity.'
        );
      }
    },

    toggleFailover: async (routeId: string) => {
      try {
        const routes = await adminService.toggleGatewayFailover(routeId);
        if (Array.isArray(routes) && routes.length > 0) {
          localStorage.setItem(GATEWAY_KEY, JSON.stringify(routes));
          set({ gatewayRoutes: routes });
          get().fetchAuditRecords();
        }
      } catch (err) {
        toast.error(
          'Failover Toggle Failed',
          err instanceof Error ? err.message : 'Unable to update route failover.'
        );
      }
    },

    updateGatewayPrice: async (routeId: string, newPrice: number) => {
      try {
        const routes = await adminService.updateGatewayPrice(routeId, newPrice);
        if (Array.isArray(routes) && routes.length > 0) {
          localStorage.setItem(GATEWAY_KEY, JSON.stringify(routes));
          set({ gatewayRoutes: routes });
          get().fetchAuditRecords();
        }
        toast.info('Route Updated', `Gateway route price updated to $${newPrice}/1M.`);
      } catch (err) {
        toast.error(
          'Price Update Failed',
          err instanceof Error ? err.message : 'Unable to update route price.'
        );
      }
    },

    addBlockedIp: (ip: string, reason: string) => {
      set((state) => {
        const updated = [{ ip, reason, date: 'Just now' }, ...state.blockedIps];
        localStorage.setItem(BLOCKED_IPS_KEY, JSON.stringify(updated));
        return { blockedIps: updated };
      });
      adminService
        .blockIp(ip, reason)
        .then((blockedIps) => {
          localStorage.setItem(BLOCKED_IPS_KEY, JSON.stringify(blockedIps));
          set({ blockedIps });
          get().fetchAuditRecords();
        })
        .catch(() => {});
      toast.warning('IP Blocked', `${ip} has been added to Gateway WAF blacklist.`);
    },

    removeBlockedIp: (ip: string) => {
      set((state) => {
        const updated = state.blockedIps.filter((b) => b.ip !== ip);
        localStorage.setItem(BLOCKED_IPS_KEY, JSON.stringify(updated));
        return { blockedIps: updated };
      });
      adminService
        .unblockIp(ip)
        .then((blockedIps) => {
          localStorage.setItem(BLOCKED_IPS_KEY, JSON.stringify(blockedIps));
          set({ blockedIps });
          get().fetchAuditRecords();
        })
        .catch(() => {});
      toast.info('IP Unblocked', `${ip} removed from WAF blacklist.`);
    },

    addCustomer: (newCust) => {
      const prevCustomers = get().customers;
      const customer: CustomerRecord = {
        ...newCust,
        id: `cust_${String(Date.now()).slice(-4)}`,
        joinedDate: new Date().toISOString().slice(0, 10),
        lastActive: 'Just now',
      };
      set((state) => {
        const updated = [customer, ...state.customers];
        localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
        return { customers: updated };
      });
      adminService
        .createCustomer(newCust)
        .then((customers) => {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
          set({ customers });
          get().fetchAuditRecords();
          toast.success('Customer Created', `${customer.name} added to workspace.`);
        })
        .catch((err) => {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(prevCustomers));
          set({ customers: prevCustomers });
          toast.error(
            'Customer Create Failed',
            err instanceof Error ? err.message : 'Unable to create customer.'
          );
        });
    },

    updateCustomer: (id: string, updates: Partial<CustomerRecord>) => {
      const prevCustomers = get().customers;
      set((state) => {
        const updated = state.customers.map((c) => (c.id === id ? { ...c, ...updates } : c));
        localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
        return { customers: updated };
      });
      adminService
        .updateCustomer(id, updates)
        .then((customers) => {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
          set({ customers });
          get().fetchAuditRecords();
          toast.info('Customer Updated', 'Profile changes saved.');
        })
        .catch((err) => {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(prevCustomers));
          set({ customers: prevCustomers });
          toast.error(
            'Customer Update Failed',
            err instanceof Error ? err.message : 'Unable to update customer.'
          );
        });
    },

    deleteCustomer: (id: string) => {
      const prevCustomers = get().customers;
      set((state) => {
        const updated = state.customers.filter((c) => c.id !== id);
        localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
        return { customers: updated };
      });
      adminService
        .deleteCustomer(id)
        .then((customers) => {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
          set({ customers });
          get().fetchAuditRecords();
          toast.info('Customer Removed', 'Account purged from workspace.');
        })
        .catch((err) => {
          localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(prevCustomers));
          set({ customers: prevCustomers });
          toast.error(
            'Customer Delete Failed',
            err instanceof Error ? err.message : 'Unable to delete customer.'
          );
        });
    },
  };
});
