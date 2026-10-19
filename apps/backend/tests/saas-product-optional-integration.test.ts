import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { installHermeticBackend, serve, strictFake } from './helpers/hermetic-backend'

type Row = Record<string, any>
const T0 = new Date('2025-01-01T00:00:00.000Z')
let Decimal: typeof import('@prisma/client').Prisma.Decimal

// In-memory tables
const db = {
  products: new Map<string, Row>(),
  integrations: new Map<string, Row>(),
  resellers: new Map<string, Row>(),
  access: new Map<string, Row>(),
  accounts: new Map<string, Row>(),
  customers: new Map<string, Row>(),
  activations: new Map<string, Row>(),
  demos: new Map<string, Row>(),
  commissions: new Map<string, Row>(),
  audit: [] as Row[],
  integrationLogs: [] as Row[],
}

const USERS: Record<string, Row> = {
  'u-admin': {
    id: 'u-admin',
    email: 'admin@hexalyte.com',
    role: 'ADMIN',
    status: 'ACTIVE',
    emailVerified: null,
    resellerId: null,
    reseller: null,
  },
  'u-seller': {
    id: 'u-seller',
    email: 'seller@partner.com',
    role: 'SELLER',
    status: 'ACTIVE',
    emailVerified: new Date(),
    resellerId: 'reseller-1',
    reseller: { status: 'ACTIVE' },
  },
}

const fakePrisma = strictFake('prisma', {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => USERS[where.id] ?? null,
  },
  saasProduct: {
    findUnique: async ({ where, select }: { where: { id?: string; code?: string }; select?: Row }) => {
      let p: Row | undefined
      if (where.id) p = db.products.get(where.id)
      else if (where.code) p = Array.from(db.products.values()).find((x) => x.code === where.code)
      if (!p) return null

      const integration = db.integrations.get(p.id) ?? null
      const full: Row = {
        ...p,
        integration,
        _count: {
          resellerAccess: Array.from(db.access.values()).filter((a) => a.productId === p.id && a.status === 'ACTIVE').length,
          accounts: Array.from(db.accounts.values()).filter((a) => a.productId === p.id).length,
        },
      }
      if (select?.resellerAccess) {
        full.resellerAccess = Array.from(db.access.values()).filter((a) => a.productId === p.id && (!select.resellerAccess.where?.resellerId || a.resellerId === select.resellerAccess.where.resellerId))
      }
      if (!select) return full
      const result: Row = {}
      for (const k of Object.keys(select)) {
        if (k === 'integration') result.integration = integration
        else if (k === '_count') result._count = full._count
        else if (k === 'resellerAccess') result.resellerAccess = full.resellerAccess
        else if (k in full) result[k] = full[k]
      }
      return result
    },
    findMany: async ({ where, select }: { where?: Row; select?: Row } = {}) => {
      let list = Array.from(db.products.values())
      if (where?.status) list = list.filter((p) => p.status === where.status)
      return list.map((p) => {
        const integration = db.integrations.get(p.id) ?? null
        const full: Row = {
          ...p,
          integration,
          _count: {
            resellerAccess: Array.from(db.access.values()).filter((a) => a.productId === p.id && a.status === 'ACTIVE').length,
            accounts: Array.from(db.accounts.values()).filter((a) => a.productId === p.id).length,
          },
        }
        if (!select) return full
        const res: Row = {}
        for (const k of Object.keys(select)) {
          if (k === 'integration') res.integration = integration
          else if (k === '_count') res._count = full._count
          else if (k in full) res[k] = full[k]
        }
        return res
      })
    },
    create: async ({ data, select }: { data: Row; select?: Row }) => {
      const id = data.id ?? `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const integrationData = data.integration?.create
      const productRow: Row = {
        id,
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        monthlyPrice: new Decimal(String(data.monthlyPrice)),
        currency: data.currency ?? 'LKR',
        status: data.status ?? 'INACTIVE',
        trialAvailable: Boolean(data.trialAvailable),
        trialDays: data.trialDays ?? null,
        integrationStatus: data.integrationStatus ?? 'CONFIGURED',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      db.products.set(id, productRow)
      if (integrationData) {
        db.integrations.set(id, {
          id: `cfg-${id}`,
          productId: id,
          provider: integrationData.provider,
          baseUrl: integrationData.baseUrl ?? null,
          apiKeyEncrypted: integrationData.apiKeyEncrypted ?? null,
          signingSecretEncrypted: integrationData.signingSecretEncrypted ?? null,
          lastCheckedAt: null,
          lastCheckOk: null,
          lastError: null,
          updatedById: integrationData.updatedById,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      if (select) {
        const res: Row = {}
        for (const k of Object.keys(select)) res[k] = productRow[k]
        return res
      }
      return productRow
    },
    update: async ({ where, data, select }: { where: { id: string }; data: Row; select?: Row }) => {
      const existing = db.products.get(where.id)
      if (!existing) throw new Error(`Product ${where.id} not found`)
      const updated = { ...existing, ...data, updatedAt: new Date() }
      db.products.set(where.id, updated)
      if (data.integration?.update) {
        const existingCfg = db.integrations.get(where.id) ?? { id: `cfg-${where.id}`, productId: where.id, createdAt: new Date() }
        db.integrations.set(where.id, { ...existingCfg, ...data.integration.update, updatedAt: new Date() })
      }
      const full = { ...updated, integration: db.integrations.get(where.id) ?? null }
      if (select) {
        const res: Row = {}
        for (const k of Object.keys(select)) res[k] = full[k]
        return res
      }
      return full
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0
      for (const [id, p] of db.products.entries()) {
        if (where.id && p.id !== where.id) continue
        if (where.status && p.status !== where.status) continue
        if (where.updatedAt && p.updatedAt.getTime() !== where.updatedAt.getTime()) continue
        db.products.set(id, { ...p, ...data, updatedAt: new Date() })
        count++
      }
      return { count }
    },
  },
  saasIntegrationConfig: {
    findUnique: async ({ where }: { where: { productId: string } }) => db.integrations.get(where.productId) ?? null,
    upsert: async ({ where, create, update }: { where: { productId: string }; create: Row; update: Row }) => {
      const existing = db.integrations.get(where.productId)
      const now = new Date()
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: now }
        db.integrations.set(where.productId, updated)
        return updated
      }
      const created = { id: `cfg-${where.productId}`, ...create, createdAt: now, updatedAt: now }
      db.integrations.set(where.productId, created)
      return created
    },
  },
  reseller: {
    findUnique: async ({ where, select }: { where: { id: string }; select?: Row }) => {
      const r = db.resellers.get(where.id)
      if (!r) return null
      if (select) {
        const res: Row = {}
        for (const k of Object.keys(select)) res[k] = r[k]
        return res
      }
      return r
    },
    count: async () => db.resellers.size,
  },
  resellerProductAccess: {
    findUnique: async ({ where }: { where: { resellerId_productId: { resellerId: string; productId: string } } }) => {
      const key = `${where.resellerId_productId.resellerId}:${where.resellerId_productId.productId}`
      return db.access.get(key) ?? null
    },
    upsert: async ({ where, create, update }: { where: { resellerId_productId: { resellerId: string; productId: string } }; create: Row; update: Row }) => {
      const key = `${where.resellerId_productId.resellerId}:${where.resellerId_productId.productId}`
      const existing = db.access.get(key)
      if (existing) {
        const updated = { ...existing, ...update }
        db.access.set(key, updated)
        return updated
      }
      const created = { id: `acc-${Date.now()}`, ...create }
      db.access.set(key, created)
      return created
    },
    count: async ({ where }: { where?: Row } = {}) => {
      let count = 0
      for (const a of db.access.values()) {
        if (where?.productId && a.productId !== where.productId) continue
        if (where?.status && a.status !== where.status) continue
        count++
      }
      return count
    },
  },
  customerAccount: {
    findUnique: async ({ where }: { where: { id?: string; customerId_productId?: { customerId: string; productId: string } } }) => {
      if (where.id) return db.accounts.get(where.id) ?? null
      if (where.customerId_productId) {
        return (
          Array.from(db.accounts.values()).find(
            (a) => a.customerId === where.customerId_productId!.customerId && a.productId === where.customerId_productId!.productId,
          ) ?? null
        )
      }
      return null
    },
    count: async ({ where }: { where?: Row } = {}) => {
      let count = 0
      for (const a of db.accounts.values()) {
        if (where?.productId && a.productId !== where.productId) continue
        if (where?.status && a.status !== where.status) continue
        count++
      }
      return count
    },
    groupBy: async ({ by, where }: { by: string[]; where?: Row }) => {
      const counts = new Map<string, number>()
      for (const a of db.accounts.values()) {
        if (where?.productId && a.productId !== where.productId) continue
        const val = a[by[0]]
        counts.set(val, (counts.get(val) ?? 0) + 1)
      }
      return Array.from(counts.entries()).map(([k, count]) => ({ [by[0]]: k, _count: { _all: count } }))
    },
  },
  customer: {
    findUnique: async ({ where }: { where: { id: string } }) => db.customers.get(where.id) ?? null,
    findFirst: async ({ where }: { where: Row }) => Array.from(db.customers.values()).find((c) => (!where.customerCode || c.customerCode === where.customerCode) && (!where.resellerId || c.resellerId === where.resellerId)) ?? null,
  },
  activationRequest: {
    count: async ({ where }: { where?: Row } = {}) => {
      let count = 0
      for (const r of db.activations.values()) {
        if (where?.productId && r.productId !== where.productId) continue
        count++
      }
      return count
    },
    findFirst: async () => null,
  },
  demoRequest: {
    count: async () => db.demos.size,
    groupBy: async () => [],
    findFirst: async () => null,
  },
  commission: {
    count: async () => db.commissions.size,
    groupBy: async () => [],
  },
  integrationLog: {
    create: async ({ data }: { data: Row }) => {
      const entry = { id: `log-${Date.now()}`, ...data, createdAt: new Date() }
      db.integrationLogs.push(entry)
      return entry
    },
  },
  auditLog: {
    create: async ({ data }: { data: Row }) => {
      const entry = { id: `aud-${Date.now()}`, ...data, createdAt: new Date() }
      db.audit.push(entry)
      return entry
    },
  },
  $transaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    return fn(fakePrisma)
  },
})

describe('SaaS Product Optional Integration & Independent Enable/Disable', () => {
  let api: Awaited<ReturnType<typeof serve>>
  let signAccessToken: typeof import('../src/utils/jwt')['signAccessToken']
  let resellerAccessService: typeof import('../src/modules/products/reseller-access.service')['resellerAccessService']
  let trialService: typeof import('../src/modules/trials/trial.service')['trialService']
  let activationService: typeof import('../src/modules/activations/activation.service')['activationService']

  const adminToken = () => signAccessToken({ userId: 'u-admin', email: USERS['u-admin'].email, role: 'ADMIN', resellerId: null })
  const sellerToken = () => signAccessToken({ userId: 'u-seller', email: USERS['u-seller'].email, role: 'SELLER', resellerId: 'reseller-1' })

  before(async () => {
    installHermeticBackend(fakePrisma)
    ;({ signAccessToken } = await import('../src/utils/jwt'))
    ;({ Prisma: { Decimal } } = await import('@prisma/client'))
    ;({ resellerAccessService } = await import('../src/modules/products/reseller-access.service'))
    ;({ trialService } = await import('../src/modules/trials/trial.service'))
    ;({ activationService } = await import('../src/modules/activations/activation.service'))

    const { errorHandler } = await import('../src/middleware/error.middleware')
    const { adminProductsRouter, resellerAccessRouter } = await import('../src/modules/products/products.routes')

    const app = express()
    app.use(express.json())
    app.use('/admin/saas-products', adminProductsRouter)
    app.use('/admin/resellers/:resellerId/product-access', resellerAccessRouter)
    app.use(errorHandler)
    api = await serve(app)
  })

  after(async () => {
    await api?.close()
  })

  beforeEach(() => {
    db.products.clear()
    db.integrations.clear()
    db.resellers.clear()
    db.access.clear()
    db.accounts.clear()
    db.customers.clear()
    db.activations.clear()
    db.demos.clear()
    db.commissions.clear()
    db.audit.length = 0
    db.integrationLogs.length = 0

    // Seed default partner
    db.resellers.set('reseller-1', {
      id: 'reseller-1',
      code: 'RES-001',
      businessName: 'Top Partner Ltd',
      status: 'ACTIVE',
    })
  })

  // 1. Create a product without integration
  it('1. creates a product without API integration, defaulting to manual fulfillment', async () => {
    const res = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'MANUAL_ERP',
        name: 'Manual ERP Solution',
        description: 'Standard ERP with manual provisioning',
        monthlyPrice: 6000,
        status: 'ACTIVE',
        trialAvailable: false,
      },
    })

    assert.equal(res.status, 201, JSON.stringify(res.json))
    assert.equal(res.json.data.code, 'MANUAL_ERP')
    assert.equal(res.json.data.integrationStatus, 'CONFIGURED')
    assert.equal(res.json.data.integration.provider, 'MANUAL')
    assert.equal(res.json.data.integration.requiresCredentials, false)
    assert.equal(res.json.data.integration.baseUrl, null)
    assert.equal(res.json.data.integration.hasApiKey, false)
    assert.equal(res.json.data.integration.hasSigningSecret, false)
    assert.equal(res.json.data.integration.readiness.state, 'MANUAL_FULFILMENT')
  })

  // 2. Create a product with integration enabled
  it('2. creates a product with integration enabled and stores encrypted credentials safely', async () => {
    const apiKey = 'test-api-key-16-chars-long'
    const signingSecret = 'test-signing-secret-length-32-chars-long-minimum'

    const res = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'API_SHOP',
        name: 'Connected Mobile Shop',
        monthlyPrice: 8500,
        status: 'ACTIVE',
        trialAvailable: true,
        trialDays: 14,
        integration: {
          provider: 'MOBILE_SHOP',
          enabled: true,
          baseUrl: 'https://shop.api.example.com',
          apiKey,
          signingSecret,
        },
      },
    })

    assert.equal(res.status, 201, JSON.stringify(res.json))
    const productId = res.json.data.id
    assert.equal(res.json.data.code, 'API_SHOP')
    assert.equal(res.json.data.integrationStatus, 'CONFIGURED')
    assert.equal(res.json.data.integration.provider, 'MOBILE_SHOP')
    assert.equal(res.json.data.integration.hasApiKey, true)
    assert.equal(res.json.data.integration.hasSigningSecret, true)

    // Verify stored in DB is encrypted
    const storedConfig = db.integrations.get(productId)!
    assert.ok(storedConfig.apiKeyEncrypted)
    assert.ok(storedConfig.signingSecretEncrypted)
    assert.notEqual(storedConfig.apiKeyEncrypted, apiKey)
    assert.notEqual(storedConfig.signingSecretEncrypted, signingSecret)

    // Verify audit log never leaks plaintext secrets
    const audit = db.audit.find((a) => a.action === 'SAAS_PRODUCT_CREATED')
    assert.ok(audit)
    const auditStr = JSON.stringify(audit)
    assert.equal(auditStr.includes(apiKey), false)
    assert.equal(auditStr.includes(signingSecret), false)
  })

  // 3. Configure integration after product creation
  it('3. allows configuring API integration later after the product has been created', async () => {
    // First create manual product
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'SALON_LATER',
        name: 'Hexalyte Salon',
        monthlyPrice: 5500,
        status: 'ACTIVE',
      },
    })
    assert.equal(createRes.status, 201)
    const productId = createRes.json.data.id
    assert.equal(createRes.json.data.integration.provider, 'MANUAL')

    // Now configure integration later
    const configureRes = await api.call('PUT', `/admin/saas-products/${productId}/integration`, {
      token: adminToken(),
      body: {
        provider: 'SALON',
        enabled: true,
        baseUrl: 'https://salon.api.example.com',
        apiKey: 'salon-api-key-16chars',
        signingSecret: 'salon-signing-secret-32-chars-long-minimum',
      },
    })

    assert.equal(configureRes.status, 200, JSON.stringify(configureRes.json))
    assert.equal(configureRes.json.data.integrationStatus, 'CONFIGURED')
    assert.equal(configureRes.json.data.integration.provider, 'SALON')
    assert.equal(configureRes.json.data.integration.baseUrl, 'https://salon.api.example.com')
    assert.equal(configureRes.json.data.integration.hasApiKey, true)
    assert.equal(configureRes.json.data.integration.hasSigningSecret, true)
  })

  // 4. Disable and re-enable integration without losing encrypted configuration
  it('4. disables and re-enables integration without losing encrypted credentials', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'DIS_INT',
        name: 'Disable Test Product',
        monthlyPrice: 6500,
        status: 'ACTIVE',
        integration: {
          provider: 'MOBILE_SHOP',
          enabled: true,
          baseUrl: 'https://mobile.api.example.com',
          apiKey: 'key-test-16-chars-min',
          signingSecret: 'secret-test-32-chars-minimum-length',
        },
      },
    })
    const productId = createRes.json.data.id
    const originalEncryptedKey = db.integrations.get(productId)!.apiKeyEncrypted
    const originalEncryptedSecret = db.integrations.get(productId)!.signingSecretEncrypted

    // Disable integration
    const disableRes = await api.call('PUT', `/admin/saas-products/${productId}/integration`, {
      token: adminToken(),
      body: {
        provider: 'MOBILE_SHOP',
        enabled: false,
      },
    })
    assert.equal(disableRes.status, 200)
    assert.equal(disableRes.json.data.integrationStatus, 'DISABLED')
    assert.equal(disableRes.json.data.integration.hasApiKey, true)
    assert.equal(disableRes.json.data.integration.hasSigningSecret, true)

    // Stored credentials must still be present and unchanged in the database
    const disabledConfig = db.integrations.get(productId)!
    assert.equal(disabledConfig.apiKeyEncrypted, originalEncryptedKey)
    assert.equal(disabledConfig.signingSecretEncrypted, originalEncryptedSecret)

    // Re-enable integration without re-entering credentials
    const enableRes = await api.call('PUT', `/admin/saas-products/${productId}/integration`, {
      token: adminToken(),
      body: {
        provider: 'MOBILE_SHOP',
        enabled: true,
      },
    })
    assert.equal(enableRes.status, 200)
    assert.equal(enableRes.json.data.integrationStatus, 'CONFIGURED')
    assert.equal(enableRes.json.data.integration.hasApiKey, true)
    assert.equal(enableRes.json.data.integration.hasSigningSecret, true)

    const reEnabledConfig = db.integrations.get(productId)!
    assert.equal(reEnabledConfig.apiKeyEncrypted, originalEncryptedKey)
    assert.equal(reEnabledConfig.signingSecretEncrypted, originalEncryptedSecret)
  })

  // 5. Prevent integration calls when integration is disabled
  it('5. prevents connection tests and integration calls when integration is disabled', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'BLOCKED_CALLS',
        name: 'Blocked Calls Product',
        monthlyPrice: 5000,
        status: 'ACTIVE',
        integration: {
          provider: 'MOBILE_SHOP',
          enabled: false,
          baseUrl: 'https://mobile.api.example.com',
          apiKey: 'key-test-16-chars-min',
          signingSecret: 'secret-test-32-chars-minimum-length',
        },
      },
    })
    const productId = createRes.json.data.id

    // Health check call rejected
    const testRes = await api.call('POST', `/admin/saas-products/${productId}/integration/test`, {
      token: adminToken(),
    })
    assert.equal(testRes.status, 400)
    assert.match(testRes.json.message, /Integration is disabled for this product/i)
  })

  // 6. Disable and re-enable a product
  it('6. retires (disables) a product with reason and restores (enables) it', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'PROD_LIFECYCLE',
        name: 'Lifecycle Test Product',
        monthlyPrice: 5000,
        status: 'ACTIVE',
      },
    })
    const productId = createRes.json.data.id
    const p1 = db.products.get(productId)!

    // Retire product (disabling it)
    const retireRes = await api.call('POST', `/admin/saas-products/${productId}/retire`, {
      token: adminToken(),
      body: {
        reason: 'Product undergoing major version upgrade',
        expectedUpdatedAt: p1.updatedAt.toISOString(),
      },
    })
    assert.equal(retireRes.status, 200, JSON.stringify(retireRes.json))
    assert.equal(retireRes.json.data.status, 'INACTIVE')

    const p2 = db.products.get(productId)!
    assert.equal(p2.status, 'INACTIVE')

    // Restore product (enabling it)
    const restoreRes = await api.call('POST', `/admin/saas-products/${productId}/restore`, {
      token: adminToken(),
      body: {
        note: 'Upgrade complete, product restored to active catalogue',
        expectedUpdatedAt: p2.updatedAt.toISOString(),
      },
    })
    assert.equal(restoreRes.status, 200, JSON.stringify(restoreRes.json))
    assert.equal(restoreRes.json.data.status, 'ACTIVE')
    assert.equal(db.products.get(productId)!.status, 'ACTIVE')
  })

  // 7. Prevent new trials, access grants, and activation requests for disabled products
  it('7. blocks new access grants, trials, and activation requests when a product is disabled (INACTIVE)', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'INACTIVE_BLOCKED',
        name: 'Inactive Guarded Product',
        monthlyPrice: 5000,
        status: 'INACTIVE',
      },
    })
    const productId = createRes.json.data.id
    const dummyReq = { user: { userId: 'u-admin', role: 'ADMIN' } } as any

    // 7a. Block granting active reseller access
    await assert.rejects(
      async () => resellerAccessService.set('reseller-1', productId, { status: 'ACTIVE' }, dummyReq),
      (err: any) => {
        assert.equal(err.statusCode, 400)
        assert.match(err.message, /Cannot grant access to an inactive product/i)
        return true
      },
    )

    // 7b. Block assertCanSell check
    await assert.rejects(
      async () => resellerAccessService.assertCanSell('reseller-1', productId),
      (err: any) => {
        assert.equal(err.statusCode, 400)
        assert.match(err.message, /This product is not available/i)
        return true
      },
    )

    // 7c. Block creating new trial request
    const sellerReq = { user: { userId: 'u-seller', role: 'SELLER', resellerId: 'reseller-1' } } as any
    await assert.rejects(
      async () =>
        trialService.create(
          {
            productId,
            owner: {
              businessName: 'Customer Shop',
              contactName: 'Shop Owner',
              contactEmail: 'owner@shop.example',
              contactPhone: '0771234567',
              password: 'Password123!',
            },
          },
          sellerReq,
        ),
      (err: any) => {
        assert.equal(err.statusCode, 400)
        assert.match(err.message, /This product is not available/i)
        return true
      },
    )

    // 7d. Block creating new activation request
    await assert.rejects(
      async () =>
        activationService.create(
          {
            productId,
            customerId: 'cus-1',
            periodMonth: '2025-02',
            amount: 5000,
            payerName: 'Shop Owner',
            payerBank: 'Commercial Bank',
            transactionRef: 'TX12345',
            transferDate: '2025-01-15',
          },
          { buffer: Buffer.from('%PDF-1.4 test slip'), originalname: 'slip.pdf', size: 100 } as any,
          sellerReq,
        ),
      (err: any) => {
        assert.equal(err.statusCode, 400)
        assert.match(err.message, /This product is not available/i)
        return true
      },
    )
  })

  // 8. Preserve existing customer records and historical records when product is disabled
  it('8. preserves customer accounts, partner access, and historical records when product is retired', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'PRESERVE_DATA',
        name: 'Preserve Data Product',
        monthlyPrice: 5000,
        status: 'ACTIVE',
      },
    })
    const productId = createRes.json.data.id

    // Seed existing access and customer account
    db.access.set(`reseller-1:${productId}`, {
      id: 'acc-1',
      resellerId: 'reseller-1',
      productId,
      status: 'ACTIVE',
    })
    db.accounts.set('cust-acc-1', {
      id: 'cust-acc-1',
      customerId: 'cus-1',
      productId,
      resellerId: 'reseller-1',
      status: 'ACTIVE',
      externalTenantId: 'tenant-123',
    })

    const p = db.products.get(productId)!
    const retireRes = await api.call('POST', `/admin/saas-products/${productId}/retire`, {
      token: adminToken(),
      body: {
        reason: 'Routine archiving',
        expectedUpdatedAt: p.updatedAt.toISOString(),
      },
    })
    assert.equal(retireRes.status, 200)

    // Customer accounts and access records remain untouched
    assert.ok(db.accounts.has('cust-acc-1'))
    assert.equal(db.accounts.get('cust-acc-1')!.status, 'ACTIVE')
    assert.ok(db.access.has(`reseller-1:${productId}`))
    assert.equal(db.access.get(`reseller-1:${productId}`)!.status, 'ACTIVE')
  })

  // 9. Reject unauthorized product and integration updates
  it('9. rejects unauthorized requests from non-admin users or unauthenticated clients', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'AUTH_TEST',
        name: 'Auth Test Product',
        monthlyPrice: 5000,
        status: 'ACTIVE',
      },
    })
    const productId = createRes.json.data.id

    // Unauthenticated
    const noAuth = await api.call('POST', '/admin/saas-products', {
      body: { code: 'NO_AUTH', name: 'No Auth', monthlyPrice: 5000 },
    })
    assert.equal(noAuth.status, 401)

    // Non-admin attempting create
    const sellerCreate = await api.call('POST', '/admin/saas-products', {
      token: sellerToken(),
      body: { code: 'SELLER_PROD', name: 'Seller Prod', monthlyPrice: 5000 },
    })
    assert.equal(sellerCreate.status, 403)

    // Non-admin attempting update integration
    const sellerInt = await api.call('PUT', `/admin/saas-products/${productId}/integration`, {
      token: sellerToken(),
      body: { provider: 'MANUAL', enabled: true },
    })
    assert.equal(sellerInt.status, 403)

    // Non-admin attempting retire
    const sellerRetire = await api.call('POST', `/admin/saas-products/${productId}/retire`, {
      token: sellerToken(),
      body: { reason: 'Sneaky retire', expectedUpdatedAt: new Date().toISOString() },
    })
    assert.equal(sellerRetire.status, 403)
  })

  // 10. Validate integration credentials without exposing them
  it('10. validates credentials strictly on the server and never returns them in responses', async () => {
    // Missing required credentials for remote provider when enabled
    const invalidRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'INVALID_CRED',
        name: 'Invalid Credentials Product',
        monthlyPrice: 5000,
        integration: {
          provider: 'MOBILE_SHOP',
          enabled: true,
          baseUrl: 'https://shop.example.com',
          apiKey: 'too-short', // less than 16 chars
          signingSecret: 'short', // less than 32 chars
        },
      },
    })
    assert.equal(invalidRes.status, 422)

    // Successfully configure and verify response does not contain secrets
    const validRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'VALID_CRED',
        name: 'Valid Credentials Product',
        monthlyPrice: 5000,
        integration: {
          provider: 'MOBILE_SHOP',
          enabled: true,
          baseUrl: 'https://shop.example.com',
          apiKey: 'valid-api-key-16-chars',
          signingSecret: 'valid-signing-secret-32-chars-long-minimum',
        },
      },
    })
    assert.equal(validRes.status, 201)
    const jsonStr = JSON.stringify(validRes.json)
    assert.equal(jsonStr.includes('valid-api-key-16-chars'), false)
    assert.equal(jsonStr.includes('valid-signing-secret-32-chars-long-minimum'), false)
    assert.equal(validRes.json.data.integration.hasApiKey, true)
    assert.equal(validRes.json.data.integration.hasSigningSecret, true)
  })

  // 11. Preserve Manual fulfillment behavior
  it('11. preserves manual fulfillment without requiring base URL or API credentials', async () => {
    const res = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'MANUAL_STAY',
        name: 'Manual Pure Product',
        monthlyPrice: 4000,
        status: 'ACTIVE',
        integration: {
          provider: 'MANUAL',
          enabled: true,
        },
      },
    })
    assert.equal(res.status, 201)
    assert.equal(res.json.data.integration.provider, 'MANUAL')
    assert.equal(res.json.data.integration.baseUrl, null)
    assert.equal(res.json.data.integrationStatus, 'CONFIGURED')

    // Health check on manual provider succeeds cleanly
    const testRes = await api.call('POST', `/admin/saas-products/${res.json.data.id}/integration/test`, {
      token: adminToken(),
    })
    assert.equal(testRes.status, 200)
    assert.equal(testRes.json.data.ok, true)
    assert.equal(testRes.json.data.integrationStatus, 'CONFIGURED')
  })

  // 12. Handle integration connection failures safely
  it('12. handles connection test failures safely without corrupting product data', async () => {
    const createRes = await api.call('POST', '/admin/saas-products', {
      token: adminToken(),
      body: {
        code: 'FAIL_TEST',
        name: 'Connection Failure Product',
        monthlyPrice: 5000,
        status: 'ACTIVE',
        integration: {
          provider: 'MOBILE_SHOP',
          enabled: true,
          baseUrl: 'https://unreachable.invalid',
          apiKey: 'valid-api-key-16-chars',
          signingSecret: 'valid-signing-secret-32-chars-long-minimum',
        },
      },
    })
    const productId = createRes.json.data.id

    // Test connection against unreachable upstream
    const testRes = await api.call('POST', `/admin/saas-products/${productId}/integration/test`, {
      token: adminToken(),
    })
    // Health check returns 200 HTTP response with result { ok: false, ... }
    assert.equal(testRes.status, 200)
    assert.equal(testRes.json.data.ok, false)
    assert.equal(testRes.json.data.integrationStatus, 'ERROR')

    // Verify product status is untouched and config recorded the error
    const product = db.products.get(productId)!
    assert.equal(product.status, 'ACTIVE')
    assert.equal(product.integrationStatus, 'ERROR')
    const config = db.integrations.get(productId)!
    assert.equal(config.lastCheckOk, false)
    assert.ok(config.lastCheckedAt)
  })
})
